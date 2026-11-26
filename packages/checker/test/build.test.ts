import { describe, expect, it } from "vitest";
import { Story } from "inkjs/full";
import { MemoryFs, createCanvas, createCard, createProject, loadProject, saveProject, stableStringify, writeBuild, canvasLocations } from "@visink/core";
import { buildProject, escapeInkText, resolveTarget } from "@visink/compiler";
import { checkProject } from "../src";
import { demoProject } from "./fixtures";

describe("сборка демо-проекта", () => {
  const result = checkProject(demoProject());

  it("компилируется inkjs без ошибок", () => {
    expect(result.diagnostics.filter((d) => d.severity === "error")).toEqual([]);
    expect(result.storyJson).toBeTruthy();
  });

  it("стабильный вывод", () => {
    for (const [file, text] of result.build.files) expect(text).toMatchSnapshot(file);
  });

  it("сохраняет разную семантику явных once, sticky и fallback", () => {
    const ink = result.build.files.get("advisor.ink")!;
    expect(ink).toContain("* [Спросить про архив.] -> a3");
    expect(ink).toContain("+ [Уйти.] -> a5");
    expect(ink).toContain("* -> a12");
    expect(ink.indexOf("* -> a12")).toBeGreaterThan(ink.indexOf("+ [Уйти.] -> a5"));
  });

  it("проходится от точки входа", () => {
    const story = new Story(result.storyJson!);
    story.ChoosePathString("dean.entry_first_meeting");
    expect(story.ContinueMaximally()).toBe("ДЕКАН: Садитесь.\nДЕКАН: Итак, ваша диссертация?\n");
    expect(story.currentTags).toEqual(["id: dean.c2", "speaker: ent_dean"]);
    expect(story.currentChoices.map((c) => c.text)).toEqual(["«Почти готова».", "«Я сменил тему».", "Промолчать."]);
    story.ChooseChoiceIndex(1);
    const text = story.ContinueMaximally();
    expect(text).toContain("ИГРОК: Я сменил тему.");
    expect(text).toContain("ДЕКАН: Посмотрим.");
    // переход на другой холст
    expect(text).toContain("НАУЧРУК: Ну что, был у декана? # не тег {не условие} [не выбор] // не комментарий -> не переход");
    expect(story.variablesState["thesis_changed"]).toBe(true);
    expect(story.currentChoices.map((c) => c.text)).toEqual(["Спросить про архив.", "Уйти."]);
  });

  it("холст запускается и по имени, без точки входа", () => {
    const story = new Story(result.storyJson!);
    story.ChoosePathString("dean");
    expect(story.ContinueMaximally()).toBe("ДЕКАН: Садитесь.\nДЕКАН: Итак, ваша диссертация?\n");
  });

  it("ветка без стрелок заканчивается DONE без предупреждения", () => {
    const story = new Story(result.storyJson!);
    story.ChoosePathString("dean.entry_first_meeting");
    story.ContinueMaximally();
    story.ChooseChoiceIndex(2); // «Промолчать.» → c7, дальше стрелок нет
    expect(story.ContinueMaximally()).toContain("Молчание — тоже ответ.");
    expect(story.canContinue).toBe(false);
    expect(story.currentChoices).toEqual([]);
    expect(result.diagnostics.filter((d) => d.card === "c7")).toEqual([]);
  });

  it("без текста на кнопке вариант показывает текст реплики", () => {
    const p = demoProject();
    p.canvases.dean.cards.find((c) => c.id === "c3")!.menuText = "";
    const story = new Story(checkProject(p).storyJson!);
    story.ChoosePathString("dean");
    story.ContinueMaximally();
    expect(story.currentChoices[0].text).toBe("Почти готова.");
  });

  it("ошибка компилятора попадает на карточку", () => {
    const p = demoProject();
    p.canvases.dean.cards.find((c) => c.id === "c4")!.condition = "not thesis_changd";
    const r = checkProject(p);
    const err = r.diagnostics.find((d) => d.severity === "error");
    expect(err).toMatchObject({ canvas: "dean", card: "c4" });
  });
});

describe("логика на стрелках", () => {
  const link = (p: ReturnType<typeof demoProject>, file: string, from: string, to: string) =>
    p.canvases[file].links.find((l) => l.from === from && l.to === to)!;

  it("условие и действие на стрелке к варианту игрока", () => {
    const p = demoProject();
    link(p, "dean", "c2", "c3").condition = "dean_trust > 0";
    link(p, "dean", "c2", "c5").action = "logic = 10";
    const story = new Story(checkProject(p).storyJson!);
    story.ChoosePathString("dean");
    story.ContinueMaximally();
    expect(story.currentChoices.map((c) => c.text)).toEqual(["«Я сменил тему».", "Промолчать."]);
    story.ChooseChoiceIndex(1);
    story.ContinueMaximally();
    expect(story.variablesState["logic"]).toBe(10);
    expect(story.variablesState["dean_trust"]).toBe(-1);
  });

  it("условие и действие на обычной ветке", () => {
    const p = demoProject();
    const dean = p.canvases.dean;
    dean.cards.push(createCard("cz", "line", { speaker: "ent_dean", text: "Смело." }));
    dean.links.push({ from: "c6", to: "cz", order: -1, kind: "divert", condition: "thesis_changed", action: "dean_trust += 2" });
    const r = checkProject(p);
    expect(r.diagnostics.filter((d) => d.severity === "error")).toEqual([]);
    const play = (choice: number) => {
      const story = new Story(r.storyJson!);
      story.ChoosePathString("dean");
      story.ContinueMaximally();
      story.ChooseChoiceIndex(choice);
      return { text: story.ContinueMaximally(), trust: story.variablesState["dean_trust"] };
    };
    expect(play(1)).toMatchObject({ trust: 2 });
    expect(play(1).text).toContain("ДЕКАН: Смело.");
    expect(play(0).text).not.toContain("Смело.");
    expect(play(0).trust).toBe(0);
  });

  it("действие на выходе «да» карточки-условия", () => {
    const p = demoProject();
    p.canvases.advisor.links.find((l) => l.from === "a8" && l.port === "yes")!.action = "logic = 99";
    const r = checkProject(p);
    expect(r.diagnostics.filter((d) => d.severity === "error")).toEqual([]);
    const story = new Story(r.storyJson!);
    story.variablesState["dean_trust"] = -1;
    story.ChoosePathString("advisor.entry_office");
    story.ContinueMaximally();
    story.ChooseChoiceIndex(1); // «Уйти.»
    expect(story.ContinueMaximally()).toContain("Декан на вас зол.");
    expect(story.variablesState["logic"]).toBe(99);
  });

  it("выходы «да» и «нет» поддерживают несколько вариантов с условиями и действиями", () => {
    const p = createProject("condition-branches");
    p.variables.vars.push(
      { name: "flag", type: "bool", default: true },
      { name: "allowed", type: "bool", default: false },
      { name: "logic", type: "int", default: 0 },
    );
    const c = createCanvas("scene", "Сцена");
    c.cards = [
      createCard("gate", "condition", { condition: "flag" }),
      createCard("yes_1", "line", { speaker: "ent_player", menuText: "Да, первый", text: "Первый да." }),
      createCard("yes_2", "line", { speaker: "ent_player", menuText: "Да, второй", text: "Второй да." }),
      createCard("no_1", "line", { speaker: "ent_player", menuText: "Нет, первый", text: "Первый нет." }),
      createCard("no_2", "line", { speaker: "ent_player", menuText: "Нет, второй", text: "Второй нет." }),
    ];
    c.layout = Object.fromEntries(c.cards.map((card, i) => [card.id, { x: i * 300, y: i * 200 }]));
    c.start = "gate";
    c.links = [
      { from: "gate", to: "yes_1", port: "yes", order: 0, kind: "divert" },
      { from: "gate", to: "yes_2", port: "yes", order: 1, kind: "divert", condition: "allowed", action: "logic = 99" },
      { from: "gate", to: "no_1", port: "no", order: 2, kind: "divert" },
      { from: "gate", to: "no_2", port: "no", order: 3, kind: "divert" },
    ];
    p.canvases = { scene: c };
    const r = checkProject(p);
    expect(r.diagnostics.filter((d) => d.severity === "error")).toEqual([]);

    const story = new Story(r.storyJson!);
    story.ChoosePathString("scene");
    story.ContinueMaximally();
    expect(story.currentChoices.map((choice) => choice.text)).toEqual(["Да, первый"]);

    const withSecond = new Story(r.storyJson!);
    withSecond.variablesState["allowed"] = true;
    withSecond.ChoosePathString("scene");
    withSecond.ContinueMaximally();
    expect(withSecond.currentChoices.map((choice) => choice.text)).toEqual(["Да, первый", "Да, второй"]);
    withSecond.ChooseChoiceIndex(1);
    expect(withSecond.ContinueMaximally()).toContain("Второй да.");
    expect(withSecond.variablesState["logic"]).toBe(99);

    const no = new Story(r.storyJson!);
    no.variablesState["flag"] = false;
    no.ChoosePathString("scene");
    no.ContinueMaximally();
    expect(no.currentChoices.map((choice) => choice.text)).toEqual(["Нет, первый", "Нет, второй"]);
  });

  it("ошибка в условии стрелки попадает на стрелку и карточку-источник", () => {
    const p = demoProject();
    link(p, "dean", "c2", "c3").condition = "dean_trst > 0";
    const err = checkProject(p).diagnostics.find((d) => d.severity === "error");
    expect(err).toMatchObject({ canvas: "dean", card: "c2", link: { from: "c2", to: "c3" } });
  });
});

describe("функции", () => {
  it("функция вызывается из условия и действия", () => {
    const p = demoProject();
    p.variables.functions.push({ name: "clamp_trust", params: ["d"], body: "~ dean_trust = MAX(-2, MIN(2, dean_trust + d))\n~ return dean_trust" });
    p.variables.functions.push({ name: "is_bold", params: [], body: "~ return thesis_changed" });
    const dean = p.canvases.dean;
    dean.cards.find((c) => c.id === "c5")!.action = "~ temp t = clamp_trust(-5)";
    dean.links.find((l) => l.from === "c2" && l.to === "c3")!.condition = "not is_bold()";
    const r = checkProject(p);
    expect(r.diagnostics.filter((d) => d.severity === "error")).toEqual([]);
    const story = new Story(r.storyJson!);
    story.ChoosePathString("dean");
    story.ContinueMaximally();
    expect(story.currentChoices).toHaveLength(3);
    story.ChooseChoiceIndex(2);
    story.ContinueMaximally();
    expect(story.variablesState["dean_trust"]).toBe(-2);
  });

  it("внешняя функция: игра привязывает свою, без привязки работает запасное тело", () => {
    const p = demoProject();
    p.variables.functions.push({ name: "roll", params: ["sides"], body: "~ return 1", external: true, description: "бросок кубика" });
    p.canvases.dean.cards.find((c) => c.id === "c5")!.action = "dean_trust = roll(6)";
    const r = checkProject(p);
    expect(r.diagnostics.filter((d) => d.severity === "error")).toEqual([]);
    expect(r.build.files.get("globals.ink")).toContain("EXTERNAL roll(sides)");
    expect(r.build.manifest.externals).toEqual([{ name: "roll", params: ["sides"], description: "бросок кубика" }]);
    const play = (bind: boolean) => {
      const story = new Story(r.storyJson!);
      story.allowExternalFunctionFallbacks = true;
      if (bind) story.BindExternalFunction("roll", () => 6);
      story.ChoosePathString("dean");
      story.ContinueMaximally();
      story.ChooseChoiceIndex(2);
      story.ContinueMaximally();
      return story.variablesState["dean_trust"];
    };
    expect(play(false)).toBe(1);
    expect(play(true)).toBe(6);
  });

  it("ошибка в теле функции попадает на функцию", () => {
    const p = demoProject();
    p.variables.functions.push({ name: "broken", params: [], body: "~ return nonexistent_var" });
    const err = checkProject(p).diagnostics.find((d) => d.severity === "error");
    expect(err).toMatchObject({ func: "broken" });
  });
});

describe("проверки", () => {
  it("тупик, недостижимая карточка, смешанные стрелки", () => {
    const p = demoProject();
    const dean = p.canvases.dean;
    dean.cards.push(createCard("cx", "line", { speaker: "ent_dean", text: "Сирота." }));
    dean.cards.push(createCard("cy", "line", { speaker: "ent_dean", text: "Не игрок." }));
    dean.links.push({ from: "c2", to: "cy", order: 9, kind: "divert" });
    const codes = checkProject(p).diagnostics.map((d) => `${d.code}:${d.card}`);
    expect(codes).toContain("unreachable:cx");
    expect(codes.filter((c) => c.endsWith(":cy"))).toEqual([]);
    expect(codes).toContain("mixed-links:c2");
  });

  it("условная реплика NPC идёт до вариантов игрока", () => {
    const p = demoProject();
    const dean = p.canvases.dean;
    dean.cards.push(createCard("cy", "line", { speaker: "ent_dean", text: "Сначала ответьте.", condition: "thesis_changed" }));
    dean.links.push({ from: "c2", to: "cy", order: -1, kind: "divert" });
    const r = checkProject(p);
    expect(r.diagnostics.filter((d) => d.severity === "error")).toEqual([]);
    expect(r.build.canvases.dean.text).toContain("{thesis_changed: -> cy}");
    const story = new Story(r.storyJson!);
    story.ChoosePathString("dean");
    expect(story.ContinueMaximally()).toContain("Садитесь.");
    expect(story.currentChoices.length).toBeGreaterThan(0);
    const conditional = new Story(r.storyJson!);
    conditional.variablesState["thesis_changed"] = true;
    conditional.ChoosePathString("dean");
    expect(conditional.ContinueMaximally()).toContain("Сначала ответьте.");
  });

  it("две стрелки без условий: предупреждение, но ink собирается", () => {
    const p = demoProject();
    const dean = p.canvases.dean;
    dean.cards.push(createCard("cz", "line", { speaker: "ent_dean", text: "Вторая ветка." }));
    dean.links.push({ from: "c1", to: "cz", order: 1, kind: "divert" });
    const r = checkProject(p);
    expect(r.diagnostics.filter((d) => d.severity === "error")).toEqual([]);
    expect(r.diagnostics).toContainEqual(expect.objectContaining({ code: "unreachable-branch", card: "c1" }));
  });

  it.each([
    ["line", "Цель.\n"],
    ["hub", "Из хаба.\n"],
    ["flow", "Внутри вложенности.\n"],
  ] as const)("jump переходит к карточке типа %s в другом файле", (type, expected) => {
    const p = createProject("jump-target");
    const main = createCanvas("main_scene", "Начало");
    main.cards = [createCard("go", "jump", { target: "target.dest" })];
    main.layout.go = { x: 0, y: 0 };
    main.start = "go";

    const target = createCanvas("target", "Цели");
    const dest = createCard("dest", type, { speaker: "ent_narrator", text: "Цель." });
    if (type === "flow") {
      dest.flow = createCanvas("target_dest", "Внутри вложенности");
      dest.flow.cards = [createCard("inside", "line", { speaker: "ent_narrator", text: "Внутри вложенности." })];
      dest.flow!.layout.inside = { x: 0, y: 0 };
    }
    target.cards = [createCard("decoy", "line", { speaker: "ent_narrator", text: "Не туда." }), dest];
    target.layout = { decoy: { x: 0, y: 0 }, dest: { x: 300, y: 0 } };
    target.start = "decoy";
    if (type === "hub") {
      target.cards.push(createCard("after_hub", "line", { speaker: "ent_narrator", text: "Из хаба." }));
      target.layout.after_hub = { x: 600, y: 0 };
      target.links.push({ from: "dest", to: "after_hub", order: 0, kind: "divert" });
    }
    p.canvases = { main_scene: main, target };
    const r = checkProject(p);
    expect(r.diagnostics.filter((d) => d.severity === "error")).toEqual([]);
    const story = new Story(r.storyJson!);
    story.ChoosePathString("main_scene");
    expect(story.ContinueMaximally()).toBe(expected);
  });

  it("битый переход", () => {
    const p = demoProject();
    p.canvases.dean.cards.find((c) => c.id === "c8")!.target = "nowhere.x";
    expect(checkProject(p).diagnostics).toContainEqual(expect.objectContaining({ code: "broken-jump", card: "c8" }));
  });
});

describe("экранирование", () => {
  it.each([
    ["# тег", "\\# тег"],
    ["{x}", "\\{x\\}"],
    ["- тире в начале", "\\- тире в начале"],
    ["a // b", "a /\\/ b"],
    ["a -> b", "a \\-> b"],
    ["строка\nвторая", "строка вторая"],
  ])("%s", (input, expected) => expect(escapeInkText(input)).toBe(expected));
});

describe("файлы проекта", () => {
  it("старый проект с категориями, «Входом» и «Концом» открывается и играется так же", async () => {
    const fs = new MemoryFs();
    const P = "ent_player";
    await fs.writeText("project.json", stableStringify({ name: "старый", start: "dean.hello" }));
    await fs.writeText("entities.json", stableStringify(demoProject().entities));
    await fs.writeText(
      "canvases/characters/dean.canvas.json",
      stableStringify({
        id: "dean",
        title: "Декан",
        kind: "character",
        cards: [
          { id: "s0", type: "start", name: "hello" },
          { id: "l1", type: "line", speaker: "ent_dean", text: "Привет." },
          { id: "l2", type: "line", speaker: P, text: "Пока." },
          { id: "l3", type: "line", speaker: P, text: "Конец игры." },
          { id: "e1", type: "end", endKind: "done" },
          { id: "e2", type: "end", endKind: "end" },
        ],
        links: [
          { from: "s0", to: "l1", order: 0, kind: "divert" },
          { from: "l1", to: "l2", order: 0, kind: "divert" },
          { from: "l1", to: "l3", order: 1, kind: "divert" },
          { from: "l2", to: "e1", order: 0, kind: "divert" },
          { from: "l3", to: "e2", order: 0, kind: "divert" },
        ],
        layout: { s0: { x: 0, y: 0 }, l1: { x: 300, y: 0 }, l2: { x: 600, y: 0 }, l3: { x: 600, y: 150 }, e1: { x: 900, y: 0 }, e2: { x: 900, y: 150 } },
      }),
    );
    const p = await loadProject(fs);
    const dean = canvasLocations(p).find(({ canvas }) => canvas.id === "dean")!.canvas;
    expect(dean.cards.map((c) => `${c.id}:${c.type}${c.entry ? `:${c.entry}` : ""}`)).toEqual(["__entry:entry", "l1:line:hello", "l2:line", "l3:line", "e2:ink", "__exit:exit"]);
    expect(dean.graveyard.sort()).toEqual(["e1", "s0"]);
    const r = checkProject(p);
    expect(r.diagnostics.filter((d) => d.severity === "error")).toEqual([]);
    const story = new Story(r.storyJson!);
    expect(story.ContinueMaximally()).toBe("ДЕКАН: Привет.\n");
    story.ChooseChoiceIndex(1);
    expect(story.ContinueMaximally()).toBe("ИГРОК: Конец игры.\n");

    await saveProject(fs, p);
    expect(await fs.listFiles("canvases")).toEqual(["canvases/main.canvas.json"]);
    expect(await saveProject(fs, await loadProject(fs))).toEqual([]);
  });

  it("размер карточки и функции сохраняются и грузятся без изменений", async () => {
    const fs = new MemoryFs();
    const p = demoProject();
    p.canvases.dean.layout.c2 = { ...p.canvases.dean.layout.c2, w: 320, h: 140 };
    p.variables.functions.push({ name: "f", params: ["a"], body: "~ return a", external: true });
    await saveProject(fs, p);
    const loaded = await loadProject(fs);
    expect(canvasLocations(loaded).find(({ canvas }) => canvas.id === "dean")!.canvas.layout.c2).toMatchObject({ w: 320, h: 140 });
    expect(loaded.variables.functions).toEqual(p.variables.functions);
    expect(await saveProject(fs, loaded)).toEqual([]);
  });

  it("сборка удаляет свои устаревшие .ink, но не чужие", async () => {
    const fs = new MemoryFs();
    await fs.writeText("out/characters/dean.ink", "// Сгенерировано Visink — старое\n");
    await fs.writeText("out/old.ink", "// Сгенерировано Visink — старое\n");
    await fs.writeText("out/mine.ink", "// написано руками\n");
    await writeBuild(fs, "out", buildProject(demoProject()).files);
    const files = await fs.listFiles("out");
    expect(files).toContain("out/mine.ink");
    expect(files).toContain("out/dean.ink");
    expect(files).not.toContain("out/old.ink");
    expect(files).not.toContain("out/characters/dean.ink");
  });

  it("повторное сохранение без правок ничего не пишет", async () => {
    const fs = new MemoryFs();
    const first = await saveProject(fs, demoProject());
    expect(first.length).toBeGreaterThan(3);
    const loaded = await loadProject(fs);
    expect(await saveProject(fs, loaded)).toEqual([]);
    expect(buildProject(loaded).files).toEqual(buildProject(demoProject()).files);
  });
  it("логика со стрелок переезжает на пины, где это равносильно", async () => {
    const P = "ent_player";
    const N = "ent_narrator";
    const p = createProject("t");
    const c = createCanvas("dean", "Декан");
    c.cards = [
      createCard("n1", "line", { speaker: N, text: "Раз." }),
      createCard("n2", "line", { speaker: N, text: "Два." }),
      createCard("p1", "line", { speaker: P, text: "Да.", menuText: "Да" }),
      createCard("p2", "line", { speaker: P, text: "Нет.", menuText: "Нет" }),
      createCard("n3", "line", { speaker: N, text: "Три." }),
      createCard("n4", "line", { speaker: N, text: "Четыре." }),
    ];
    c.start = "n1";
    c.links = [
      { from: "n1", to: "n2", order: 0, kind: "divert", condition: "x", action: "x = false" },
      { from: "n2", to: "p1", order: 0, kind: "divert", condition: "y", action: "y = false" },
      // у p2 два входа — условие остаётся на стрелке
      { from: "n2", to: "p2", order: 1, kind: "divert", condition: "z" },
      { from: "n3", to: "p2", order: 0, kind: "divert" },
      // единственная стрелка без условия — действие в источник
      { from: "p2", to: "n4", order: 0, kind: "divert", action: "z = false" },
    ];
    p.canvases.dean = c;
    p.variables.vars = [
      { name: "x", type: "bool", default: true },
      { name: "y", type: "bool", default: true },
      { name: "z", type: "bool", default: true },
    ];
    const play = (proj: typeof p) => {
      const r = checkProject(proj);
      expect(r.diagnostics.filter((d) => d.severity === "error")).toEqual([]);
      const story = new Story(r.storyJson!);
      story.ChoosePathString("dean");
      const out = [story.ContinueMaximally(), story.currentChoices.map((ch) => ch.text).join("|")];
      story.ChooseChoiceIndex(0);
      out.push(story.ContinueMaximally(), String(story.variablesState["x"]), String(story.variablesState["y"]));
      const second = new Story(r.storyJson!);
      second.ChoosePathString("dean");
      second.ContinueMaximally();
      second.ChooseChoiceIndex(1);
      out.push(second.ContinueMaximally(), String(second.variablesState["z"]));
      return out;
    };
    const before = play(p);

    const fs = new MemoryFs();
    await saveProject(fs, p);
    const oldSettings = JSON.parse(fs.files.get("project.json")!);
    fs.files.set("project.json", JSON.stringify({ ...oldSettings, formatVersion: 3 }));
    const loaded = await loadProject(fs);
    const dean = canvasLocations(loaded).find(({ canvas }) => canvas.id === "dean")!.canvas;
    const card = (id: string) => dean.cards.find((x) => x.id === id)!;
    expect(card("n2").condition).toBe("x");
    // у стрелки было и условие — действие уходит в цель, а не в источник (иначе выполнится до проверки)
    expect(card("n1").action).toBeUndefined();
    expect(card("n2").action).toBe("x = false");
    expect(card("p1").condition).toBe("y");
    expect(card("p1").action).toBe("y = false");
    expect(dean.links.filter((link) => !["__entry", "__exit"].includes(link.from) && !["__entry", "__exit"].includes(link.to)).map((l) => [l.to, l.condition ?? "", l.action ?? ""])).toEqual([
      ["n2", "", ""],
      ["p1", "", ""],
      ["p2", "z", ""],
      ["p2", "", ""],
      ["n4", "", ""],
    ]);
    expect(card("p2").action).toBe("z = false");
    expect(play(loaded)).toEqual(before);
    // повторная загрузка ничего не меняет
    await saveProject(fs, loaded);
    expect(await saveProject(fs, await loadProject(fs))).toEqual([]);
  });
});

describe("вложенные потоки и свойства персонажей", () => {
  it("nested сохраняется, экспортируется отдельным knot и запускается по прежнему entry", async () => {
    const p = createProject("nested");
    const c = createCanvas("scene", "Сцена");
    const outer = createCard("outer", "line", { speaker: "ent_narrator", text: "Снаружи." });
    const inner = createCanvas("scene_outer", "Внутри");
    inner.cards = [
      createCard("inner_1", "line", { speaker: "ent_narrator", text: "Внутри.", entry: "inner" }),
      createCard("inner_2", "line", { speaker: "ent_narrator", text: "Конец." }),
    ];
    inner.links = [{ from: "inner_1", to: "inner_2", order: 0, kind: "divert" }];
    inner.layout = { inner_1: { x: 0, y: 0 }, inner_2: { x: 300, y: 0 } };
    inner.start = "inner_1";
    outer.flow = inner;
    c.cards = [outer];
    c.layout.outer = { x: 0, y: 0 };
    c.start = "outer";
    p.canvases.scene = c;

    const fs = new MemoryFs();
    await saveProject(fs, p);
    const loaded = await loadProject(fs);
    const scene = canvasLocations(loaded).find(({ canvas }) => canvas.id === "scene")!.canvas;
    const nested = scene.cards.find((card) => card.id === "outer")!.flow!;
    expect(nested.cards.filter((card) => card.type !== "entry" && card.type !== "exit").map((x) => x.id)).toEqual(["inner_1", "inner_2"]);
    expect(await saveProject(fs, loaded)).toEqual([]);

    const r = checkProject(loaded);
    expect(r.diagnostics.filter((d) => d.severity === "error")).toEqual([]);
    const ink = r.build.files.get("scene.ink")!;
    expect(ink.match(/^=== scene ===$/gm)).toHaveLength(1);
    expect(ink).toContain("= entry_inner");
    expect(ink).toContain("= inner_1");
    expect(r.build.files.get("scene_outer.ink")).toContain("=== scene_outer ===");
    const story = new Story(r.storyJson!);
    story.ChoosePathString("scene.entry_inner");
    expect(story.ContinueMaximally()).toBe("Внутри.\nКонец.\n");
  });

  it("карточка-вложенность автоматически входит внутрь и возвращается на свои выходы", () => {
    const p = createProject("flow");
    const c = createCanvas("scene", "Сцена");
    const box = createCard("box", "flow", { text: "Блок" });
    box.flow!.cards = [
      createCard("inner_1", "line", { speaker: "ent_narrator", text: "Внутри." }),
      createCard("inner_2", "line", { speaker: "ent_narrator", text: "Ещё внутри." }),
    ];
    box.flow!.links = [{ from: "inner_1", to: "inner_2", order: 0, kind: "divert" }];
    box.flow!.layout = { inner_1: { x: 0, y: 0 }, inner_2: { x: 300, y: 0 } };
    c.cards = [
      createCard("before", "line", { speaker: "ent_narrator", text: "До." }),
      box,
      createCard("after", "line", { speaker: "ent_narrator", text: "После." }),
    ];
    c.links = [
      { from: "before", to: "box", order: 0, kind: "divert" },
      { from: "box", to: "after", order: 0, kind: "divert" },
    ];
    c.layout = { before: { x: 0, y: 0 }, box: { x: 300, y: 0 }, after: { x: 600, y: 0 } };
    c.start = "before";
    p.canvases.scene = c;

    const r = checkProject(p);
    expect(r.diagnostics.filter((d) => d.severity === "error")).toEqual([]);
    const story = new Story(r.storyJson!);
    story.ChoosePathString("scene");
    expect(story.ContinueMaximally()).toBe("До.\nВнутри.\nЕщё внутри.\nПосле.\n");
  });

  it("вложенность с первой репликой игрока становится условным вариантом", () => {
    const p = createProject("nested-choice");
    p.variables.vars.push({ name: "allowed", type: "bool", default: false });
    const c = createCanvas("scene", "Сцена");
    const box = createCard("box", "flow", { text: "Блок", condition: "allowed" });
    box.flow = createCanvas("scene_box", "Блок");
    box.flow.cards = [createCard("nested_choice", "line", { speaker: "ent_player", text: "Ответ из вложенности.", menuText: "Вложенный вариант" })];
    box.flow!.layout.nested_choice = { x: 0, y: 0 };
    c.cards = [
      createCard("hub", "hub"),
      createCard("direct", "line", { speaker: "ent_player", text: "Обычный ответ.", menuText: "Обычный вариант" }),
      box,
      createCard("after", "line", { speaker: "ent_narrator", text: "Финал." }),
    ];
    c.links = [
      { from: "hub", to: "direct", order: 0, kind: "divert" },
      { from: "hub", to: "box", order: 1, kind: "divert" },
      { from: "direct", to: "after", order: 0, kind: "divert" },
      { from: "box", to: "after", order: 0, kind: "divert" },
    ];
    c.layout = { hub: { x: 0, y: 0 }, direct: { x: 300, y: 0 }, box: { x: 300, y: 200 }, after: { x: 600, y: 0 } };
    c.start = "hub";
    p.canvases.scene = c;

    const r = checkProject(p);
    expect(r.diagnostics.filter((d) => d.severity === "error")).toEqual([]);
    const closed = new Story(r.storyJson!);
    closed.ChoosePathString("scene");
    closed.ContinueMaximally();
    expect(closed.currentChoices.map((choice) => choice.text)).toEqual(["Обычный вариант"]);

    const open = new Story(r.storyJson!);
    open.variablesState["allowed"] = true;
    open.ChoosePathString("scene");
    open.ContinueMaximally();
    expect(open.currentChoices.map((choice) => choice.text)).toEqual(["Обычный вариант", "Вложенный вариант"]);
    open.ChooseChoiceIndex(1);
    expect(open.ContinueMaximally()).toBe("ИГРОК: Ответ из вложенности.\nФинал.\n");
  });

  it("одинаковые trust и can_start() у двух персонажей не конфликтуют", () => {
    const p = demoProject();
    p.variables.vars.push(
      { name: "trust", owner: "ent_dean", type: "int", default: 1 },
      { name: "trust", owner: "ent_advisor", type: "int", default: 2 },
    );
    p.variables.functions.push(
      { name: "can_start", owner: "ent_dean", params: [], body: "~ return trust > 0" },
      { name: "can_start", owner: "ent_advisor", params: [], body: "~ return trust > 1" },
    );
    p.canvases.dean.cards.find((c) => c.id === "c1")!.action = "ent_dean.trust = ent_dean.can_start()";
    p.canvases.advisor.cards.find((c) => c.id === "a1")!.action = "ent_advisor.trust = ent_advisor.can_start()";
    const r = checkProject(p);
    expect(r.diagnostics.filter((d) => d.severity === "error")).toEqual([]);
    const globals = r.build.files.get("globals.ink")!;
    expect(globals).toContain("VAR ent_dean__trust = 1");
    expect(globals).toContain("VAR ent_advisor__trust = 2");
    expect(globals).toContain("=== function ent_dean__can_start() ===");
    expect(globals).toContain("~ return ent_advisor__trust > 1");

    const first = new Story(r.storyJson!);
    first.ChoosePathString("dean");
    first.ContinueMaximally();
    expect(first.variablesState["ent_dean__trust"]).toBe(true);
    expect(first.variablesState["ent_advisor__trust"]).toBe(2);
    const second = new Story(r.storyJson!);
    second.ChoosePathString("advisor");
    second.ContinueMaximally();
    expect(second.variablesState["ent_dean__trust"]).toBe(1);
    expect(second.variablesState["ent_advisor__trust"]).toBe(true);
  });

  it("scoped EXTERNAL получает стабильное имя и сохраняет fallback", () => {
    const p = demoProject();
    p.variables.functions.push({ name: "can_start", owner: "ent_dean", params: [], body: "~ return true", external: true });
    p.canvases.dean.cards.find((c) => c.id === "c1")!.action = "thesis_changed = ent_dean.can_start()";
    const r = checkProject(p);
    expect(r.diagnostics.filter((d) => d.severity === "error")).toEqual([]);
    expect(r.build.manifest.externals).toContainEqual({ name: "ent_dean__can_start", params: [], owner: "ent_dean", sourceName: "can_start" });
    const story = new Story(r.storyJson!);
    story.allowExternalFunctionFallbacks = true;
    story.ChoosePathString("dean");
    story.ContinueMaximally();
    expect(story.variablesState["thesis_changed"]).toBe(true);
  });
});


describe("канвасы v4: границы, вложенные варианты и совместимость", () => {
  const link = (from: string, to: string, order = 0, extra: Partial<import("@visink/core").Link> = {}) => ({ from, to, order, kind: "divert" as const, ...extra });
  const place = (canvas: import("@visink/core").Canvas) => {
    canvas.cards.forEach((card, i) => { canvas.layout[card.id] = { x: i * 300, y: i * 180 }; });
    return canvas;
  };
  const errors = (p: ReturnType<typeof createProject>) => checkProject(p).diagnostics.filter((d) => d.severity === "error");

  it("собирает варианты из двух многоуровневых вложенностей в одном меню и исполняет действия только на выбранном маршруте", () => {
    const p = createProject("groups");
    p.variables.vars.push(
      { name: "allow_a", type: "bool", default: true },
      { name: "allow_b", type: "bool", default: true },
      { name: "show_b2", type: "bool", default: true },
      { name: "marks", type: "int", default: 0 },
    );
    const scene = createCanvas("scene", "Сцена");
    const hub = createCard("hub", "hub", { action: "marks += 1" });
    const after = createCard("after", "line", { speaker: "ent_narrator", text: "После." });
    const boxA = createCard("box_a", "flow", { text: "Одинаковое имя", action: "marks += 10" });
    const boxB = createCard("box_b", "flow", { text: "Одинаковое имя" });
    const inner = createCanvas("inner_a", "Внутренний уровень");
    const innerRouter = createCard("inner_router", "hub", { action: "marks += 100" });
    const a1 = createCard("a1", "line", { speaker: "ent_player", menuText: "A1", text: "Выбрано A1.", repeat: "once", action: "marks += 1000" });
    const a2 = createCard("a2", "line", { speaker: "ent_player", menuText: "A2", text: "Выбрано A2.", repeat: "sticky" });
    inner.cards = [innerRouter, a1, a2];
    inner.start = innerRouter.id;
    inner.links = [link(innerRouter.id, a1.id), link(innerRouter.id, a2.id, 1)];
    place(inner);
    const middle = createCard("middle", "flow", { text: "Средний уровень", action: "marks += 10000" });
    middle.flow = inner;
    const routerA = createCard("router_a", "hub");
    boxA.flow = createCanvas("group_a", "Группа A");
    boxA.flow.cards = [routerA, middle];
    boxA.flow.start = routerA.id;
    boxA.flow.links = [link(routerA.id, middle.id)];
    place(boxA.flow);
    const routerB = createCard("router_b", "hub");
    const fallback = createCard("b1", "line", { speaker: "ent_player", text: "Запасной B1.", repeat: "fallback", action: "marks = 777" });
    const b2 = createCard("b2", "line", { speaker: "ent_player", menuText: "B2", text: "Выбрано B2.", condition: "show_b2" });
    boxB.flow = createCanvas("group_b", "Группа B");
    boxB.flow.cards = [routerB, fallback, b2];
    boxB.flow.start = routerB.id;
    boxB.flow.links = [link(routerB.id, fallback.id), link(routerB.id, b2.id, 1)];
    place(boxB.flow);
    scene.cards = [hub, boxA, boxB, after];
    scene.start = hub.id;
    scene.links = [
      link(hub.id, boxA.id, 0, { condition: "allow_a", action: "marks += 100000" }),
      link(hub.id, boxB.id, 1, { condition: "allow_b" }),
      link(boxA.id, after.id), link(boxB.id, after.id), link(after.id, hub.id),
    ];
    place(scene);
    p.canvases = { scene };
    p.settings.start = "scene";
    const r = checkProject(p);
    expect(r.diagnostics.filter((d) => d.severity === "error")).toEqual([]);
    expect(r.build.files.has("group_a.ink")).toBe(true);
    expect(r.build.files.has("inner_a.ink")).toBe(true);
    expect(r.build.files.has("group_b.ink")).toBe(true);

    const story = new Story(r.storyJson!);
    story.ChoosePathString("scene");
    story.ContinueMaximally();
    expect(story.currentChoices.map((c) => c.text)).toEqual(["A1", "A2", "B2"]);
    expect(story.variablesState["marks"]).toBe(1);
    story.ChooseChoiceIndex(0);
    expect(story.ContinueMaximally()).toContain("Выбрано A1.\nПосле.");
    expect(story.variablesState["marks"]).toBe(1 + 10 + 100 + 10000 + 100000 + 1000 + 1);
    expect(story.currentChoices.map((c) => c.text)).toEqual(["A2", "B2"]);

    const closed = new Story(r.storyJson!);
    closed.variablesState["allow_a"] = false;
    closed.ChoosePathString("scene");
    closed.ContinueMaximally();
    expect(closed.currentChoices.map((c) => c.text)).toEqual(["B2"]);

    const fallbackOnly = new Story(r.storyJson!);
    fallbackOnly.variablesState["allow_a"] = false;
    fallbackOnly.variablesState["show_b2"] = false;
    fallbackOnly.ChoosePathString("scene");
    expect(fallbackOnly.ContinueMaximally()).toContain("Запасной B1.\nПосле.");
    expect(fallbackOnly.variablesState["marks"]).toBe(778);
  });

  it("реплика NPC внутри вложенности исполняется до её собственного меню", () => {
    const p = createProject("npc-first");
    const scene = createCanvas("scene", "Сцена");
    const hub = createCard("hub", "hub");
    const box = createCard("box", "flow", { text: "Блок" });
    box.flow = createCanvas("box_flow", "Блок");
    const npc = createCard("npc", "line", { speaker: "ent_narrator", text: "Сначала NPC." });
    const option = createCard("option", "line", { speaker: "ent_player", menuText: "Ответ", text: "Ответ игрока." });
    box.flow.cards = [npc, option];
    box.flow.start = npc.id;
    box.flow.links = [link(npc.id, option.id)];
    scene.cards = [hub, box];
    scene.start = hub.id;
    scene.links = [link(hub.id, box.id)];
    p.canvases = { scene };
    const r = checkProject(p);
    expect(r.diagnostics.filter((d) => d.severity === "error")).toEqual([]);
    const story = new Story(r.storyJson!);
    story.ChoosePathString("scene");
    expect(story.ContinueMaximally()).toBe("Сначала NPC.\n");
    expect(story.currentChoices.map((c) => c.text)).toEqual(["Ответ"]);
  });

  it("пустые вложенности и несколько выходов подряд возвращаются в родителя, корневой выход завершает поток", () => {
    const p = createProject("empty");
    const scene = createCanvas("scene", "Сцена");
    const before = createCard("before", "line", { speaker: "ent_narrator", text: "До." });
    const outer = createCard("outer", "flow", { text: "Пустая" });
    const inner = createCard("inner", "flow", { text: "Пустая внутри" });
    outer.flow = createCanvas("outer_flow", "Пустая");
    outer.flow.cards = [inner];
    outer.flow.start = inner.id;
    inner.flow = createCanvas("inner_flow", "Пустая внутри");
    const after = createCard("after", "line", { speaker: "ent_narrator", text: "После." });
    scene.cards = [before, outer, after];
    scene.start = before.id;
    scene.links = [link(before.id, outer.id), link(outer.id, after.id)];
    p.canvases = { scene };
    const r = checkProject(p);
    expect(r.diagnostics.filter((d) => d.severity === "error")).toEqual([]);
    const story = new Story(r.storyJson!);
    story.ChoosePathString("scene");
    expect(story.ContinueMaximally()).toBe("До.\nПосле.\n");
    expect(story.canContinue).toBe(false);
    expect(story.currentChoices).toEqual([]);
  });

  it("миграция сохраняет прямой старт игрока, старые карточки/entry и локальные ссылки raw Ink", () => {
    const p = createProject("legacy");
    p.variables.vars.push({ name: "turns", type: "int", default: -1 });
    const dialog = createCanvas("dialog", "Диалог");
    const box = createCard("box", "flow", { text: "Блок" });
    box.flow = createCanvas("legacy_box", "Блок");
    const inner = createCard("inner", "ink", { text: "~ turns = TURNS_SINCE(-> inner)\n-> tail" });
    box.flow.cards = [inner];
    box.flow.start = inner.id;
    const tail = createCard("tail", "line", { speaker: "ent_narrator", text: "Хвост.", entry: "intro" });
    const seen = createCard("seen", "ink", { text: "{READ_COUNT(-> dialog.inner) > 0:Seen|Missed}" });
    dialog.cards = [box, tail, seen];
    dialog.start = box.id;
    dialog.links = [link(box.id, tail.id), link(tail.id, seen.id)];
    p.canvases = { dialog };
    p.settings.start = "dialog";
    const r = checkProject(p);
    expect(r.diagnostics.filter((d) => d.severity === "error")).toEqual([]);
    const story = new Story(r.storyJson!);
    story.ChoosePathString("dialog.inner");
    expect(story.ContinueMaximally()).toBe("Хвост.\nSeen\n");
    expect(story.variablesState["turns"]).toBe(0);
    const entry = new Story(r.storyJson!);
    entry.ChoosePathString("dialog.entry_intro");
    expect(entry.ContinueMaximally()).toBe("Хвост.\nMissed\n");
    expect(r.build.manifest.lines["dialog.tail"]).toMatchObject({ canvas: "dialog", card: "tail", text: "Хвост." });

    const direct = createProject("direct-player");
    const c = createCanvas("dialog", "Диалог");
    c.cards = [createCard("player", "line", { speaker: "ent_player", text: "Старый прямой ответ.", entry: "intro" })];
    c.start = "player";
    direct.canvases = { dialog: c };
    direct.settings.start = "dialog";
    const directResult = checkProject(direct);
    for (const target of ["main", "dialog", "dialog.entry_intro"]) {
      const directStory = new Story(directResult.storyJson!);
      if (target !== "main") directStory.ChoosePathString(target);
      expect(directStory.ContinueMaximally()).toBe("ИГРОК: Старый прямой ответ.\n");
      expect(directStory.currentChoices).toEqual([]);
    }
  });

  it("v4 не восстанавливает намеренно удалённую связь входа и не смешивает одинаковые id старых файлов", async () => {
    const fs = new MemoryFs();
    for (const id of ["dialog", "other"]) {
      const c = createCanvas(id, id);
      c.cards = [createCard("c1", "line", { speaker: "ent_narrator", text: id, entry: "intro" })];
      c.start = "c1";
      await fs.writeText(`canvases/${id}.canvas.json`, stableStringify(c));
    }
    await fs.writeText("project.json", stableStringify({ name: "old", buildDir: "build", languages: ["ru"], start: "dialog.intro", formatVersion: 3 }));
    await fs.writeText("entities.json", stableStringify(createProject("x").entities));
    const loaded = await loadProject(fs);
    expect(loaded.canvases.main.legacyId).toBeUndefined();
    expect(canvasLocations(loaded).filter(({ canvas }) => canvas.id === "dialog" || canvas.id === "other")).toHaveLength(2);
    expect(checkProject(loaded).diagnostics.filter((d) => d.severity === "error")).toEqual([]);
    const main = loaded.canvases.main;
    const entry = main.cards.find((c) => c.type === "entry")!;
    main.links = main.links.filter((l) => l.from !== entry.id);
    await saveProject(fs, loaded);
    await fs.writeText("canvases/dialog.canvas.json", stableStringify(createCanvas("dialog", "stale")));
    const reopened = await loadProject(fs);
    expect(canvasLocations(reopened).filter(({ canvas }) => canvas.id === "dialog")).toHaveLength(1);
    expect(reopened.canvases.main.links.some((l) => l.from === entry.id)).toBe(false);
    expect(await saveProject(fs, reopened)).toEqual(["canvases/dialog.canvas.json"]);
    expect(await saveProject(fs, await loadProject(fs))).toEqual([]);
  });
});


describe("дополнительные регрессии совместимости", () => {
  it("обычный возврат на хаб не копирует one-shot меню", () => {
    const story = new Story(checkProject(demoProject()).storyJson!);
    story.ChoosePathString("advisor");
    story.ContinueMaximally();
    expect(story.currentChoices.map((c) => c.text)).toContain("Спросить про архив.");
    story.ChooseChoiceIndex(story.currentChoices.findIndex((c) => c.text === "Спросить про архив."));
    story.ContinueMaximally();
    expect(story.currentChoices.map((c) => c.text)).not.toContain("Спросить про архив.");
    expect(story.currentChoices.map((c) => c.text)).toContain("Уйти.");
  });

  it("карта main.ink учитывает INCLUDE, а ошибка общего варианта сохраняет исходный canvas", () => {
    const p = createProject("line-map");
    const main = p.canvases.main;
    const raw = createCard("broken", "ink", { text: "-> nowhere" });
    main.cards.push(raw);
    main.layout[raw.id] = { x: 0, y: 0 };
    const entry = main.cards.find((c) => c.type === "entry")!;
    main.links = [{ from: entry.id, to: raw.id, order: 0, kind: "divert" }];
    const nestedRoot = createCanvas("scene", "Сцена");
    nestedRoot.cards = [createCard("line", "line", { speaker: "ent_narrator", text: "Scene" })];
    nestedRoot.start = "line";
    p.canvases.scene = nestedRoot;
    const mainResult = checkProject(p);
    expect(mainResult.diagnostics).toContainEqual(expect.objectContaining({ code: "ink", canvas: "main", card: "broken" }));

    const groups = createProject("diagnostic-origin");
    const scene = createCanvas("scene", "Сцена");
    const hub = createCard("hub", "hub");
    const box = createCard("box", "flow", { text: "Блок" });
    box.flow = createCanvas("group", "Группа");
    const option = createCard("option", "line", { speaker: "ent_player", menuText: "Вариант", text: "Текст", condition: "missing_name" });
    box.flow.cards = [option];
    box.flow.start = option.id;
    scene.cards = [hub, box];
    scene.start = hub.id;
    scene.links = [{ from: hub.id, to: box.id, order: 0, kind: "divert" }];
    groups.canvases = { scene };
    const result = checkProject(groups);
    expect(result.diagnostics.filter((d) => d.card === "option" && d.severity === "error")).toEqual(expect.arrayContaining([
      expect.objectContaining({ canvas: "group" }),
    ]));
    expect(result.diagnostics.filter((d) => d.card === "option" && d.severity === "error").every((d) => d.canvas === "group")).toBe(true);
  });

  it.each(["var", "function"] as const)("глобальный %s main не конфликтует с главным knot и сохраняет текстовый id", (kind) => {
    const p = createProject("main-collision");
    if (kind === "var") p.variables.vars.push({ name: "main", type: "int", default: 1 });
    else p.variables.functions.push({ name: "main", params: [], body: "~ return 5" });
    p.variables.vars.push({ name: "result", type: "int", default: 0 });
    const main = p.canvases.main;
    const line = createCard("line", "line", { speaker: "ent_narrator", text: "Главный.", action: kind === "var" ? "main = 7" : "result = main()" });
    main.cards.push(line);
    main.layout[line.id] = { x: 0, y: 0 };
    const entry = main.cards.find((c) => c.type === "entry")!;
    const exit = main.cards.find((c) => c.type === "exit")!;
    main.links = [{ from: entry.id, to: line.id, order: 0, kind: "divert" }, { from: line.id, to: exit.id, order: 0, kind: "divert" }];
    const r = checkProject(p);
    expect(r.diagnostics.filter((d) => d.severity === "error")).toEqual([]);
    expect(r.build.files.get("main.ink")).toContain("=== __visink_main ===");
    expect(r.build.manifest.start).toBe("__visink_main");
    expect(r.build.manifest.lines["main.line"]).toBeDefined();
    const story = new Story(r.storyJson!);
    expect(story.ContinueMaximally()).toBe("Главный.\n");
    expect(story.currentTags).toContain("id: main.line");
    expect(story.variablesState[kind === "var" ? "main" : "result"]).toBe(kind === "var" ? 7 : 5);
    const byManifest = new Story(r.storyJson!);
    byManifest.ChoosePathString(r.build.manifest.start!);
    expect(byManifest.ContinueMaximally()).toBe("Главный.\n");
  });
});


describe("интерполяция текста через Ink", () => {
  it("вычисляет проектные и scoped выражения, сохраняя литералы и порядок действий", () => {
    const p = createProject("interpolation");
    p.variables.sets = [{ id: "quest", name: "quest" }];
    p.variables.vars.push(
      { name: "roll", type: "int", default: 0 },
      { name: "roll", owner: "quest", type: "int", default: 7 },
    );
    const main = p.canvases.main;
    const setup = createCard("setup", "hub");
    const line = createCard("line", "line", {
      speaker: "ent_narrator",
      text: "Бросок {roll}, +1 {roll + 1}, набор {quest.roll}, число {1 + 2}. Литералы: \\{roll}, {версия 2}, {заметка про roll}, {не условие}.",
    });
    const option = createCard("option", "line", { speaker: "ent_player", menuText: "Ход {roll + 1}", text: "Теперь {roll}" });
    main.cards.push(setup, line, option);
    Object.assign(main.layout, { setup: { x: 0, y: 0 }, line: { x: 300, y: 0 }, option: { x: 600, y: 0 } });
    const entry = main.cards.find((card) => card.type === "entry")!;
    const exit = main.cards.find((card) => card.type === "exit")!;
    main.links = [
      { from: entry.id, to: setup.id, order: 0, kind: "divert", direct: true },
      { from: setup.id, to: line.id, order: 0, kind: "divert", action: "roll = 4" },
      { from: line.id, to: option.id, order: 0, kind: "divert", action: "roll = 100" },
      { from: option.id, to: exit.id, order: 0, kind: "divert" },
    ];
    const result = checkProject(p);
    expect(result.diagnostics.filter((diagnostic) => diagnostic.severity === "error")).toEqual([]);
    expect(result.build.files.get("main.ink")).toContain("{quest__roll}");
    const story = new Story(result.storyJson!);
    story.ChoosePathString("main");
    const text = story.ContinueMaximally();
    expect(text).toContain("Бросок 4, +1 5, набор 7, число 3. Литералы: {roll}, {версия 2}, {заметка про roll}, {не условие}.");
    expect(story.currentChoices.map((choice) => choice.text)).toEqual(["Ход 5"]);
    story.ChooseChoiceIndex(0);
    expect(story.ContinueMaximally()).toContain("Теперь 100");
  });
});


describe("локальные входы карточек", () => {
  it("вычисляет аргументы в источнике и сбрасывает отсутствующие значения при повторном входе", () => {
    const p = createProject("inputs");
    p.variables.vars.push({ name: "base", type: "int", default: 5 }, { name: "visits", type: "int", default: 0 }, { name: "input_1", type: "int", default: 99 });
    const main = p.canvases.main;
    const first = createCard("first", "hub");
    const again = createCard("again", "hub");
    const target = createCard("target", "line", {
      speaker: "ent_narrator",
      text: "Локально {input_1}/{input_2}",
      action: "visits += 1",
      inputs: [{ name: "input_1", type: "int", default: 5 }, { name: "input_2", type: "string", default: "reset" }],
    });
    const unrelated = createCard("unrelated", "line", { speaker: "ent_narrator", text: "Глобально {input_1}" });
    main.cards.push(first, again, target, unrelated);
    Object.assign(main.layout, { first: { x: 0, y: 0 }, again: { x: 0, y: 150 }, target: { x: 300, y: 0 }, unrelated: { x: 300, y: 150 } });
    const entry = main.cards.find((card) => card.type === "entry")!;
    const exit = main.cards.find((card) => card.type === "exit")!;
    main.links = [
      { from: entry.id, to: first.id, order: 0, kind: "divert", direct: true },
      { from: first.id, to: target.id, order: 0, kind: "divert", args: { input_1: "base + 3", input_2: '"set"' } },
      { from: target.id, to: again.id, order: 0, kind: "divert", condition: "visits < 2" },
      { from: target.id, to: exit.id, order: 1, kind: "divert" },
      { from: again.id, to: target.id, order: 0, kind: "divert" },
    ];
    const result = checkProject(p);
    expect(result.diagnostics.filter((diagnostic) => diagnostic.severity === "error")).toEqual([]);
    expect(result.build.files.get("main.ink")).toContain("= __visink_inputs_target(__visink_target_input_1, __visink_target_input_2)");
    const story = new Story(result.storyJson!);
    story.ChoosePathString("main");
    expect(story.ContinueMaximally()).toBe("Локально 8/set\nЛокально 5/reset\n");
    const external = new Story(result.storyJson!);
    external.ChoosePathString("main.target");
    expect(external.ContinueMaximally()).toContain("Локально 5/reset");
    const global = new Story(result.storyJson!);
    global.ChoosePathString("main.unrelated");
    expect(global.ContinueMaximally()).toBe("Глобально 99\n");
  });

  it("использует одинаковые вычисленные значения в preview и после выбора без преждевременного действия", () => {
    const p = createProject("input-choice");
    p.variables.vars.push({ name: "roll", type: "int", default: 4 });
    const main = p.canvases.main;
    const source = createCard("source", "hub");
    const option = createCard("option", "line", {
      speaker: "ent_player",
      menuText: "Вариант {input_1}",
      text: "Выбрано {input_1}",
      inputs: [{ name: "input_1", type: "int", default: 2 }],
    });
    const second = createCard("second", "line", {
      speaker: "ent_player",
      menuText: "Второй {input_1}",
      text: "Второе {input_1}",
      inputs: [{ name: "input_1", type: "int", default: 3 }],
    });
    main.cards.push(source, option, second);
    Object.assign(main.layout, { source: { x: 0, y: 0 }, option: { x: 300, y: 0 }, second: { x: 600, y: 0 } });
    const entry = main.cards.find((card) => card.type === "entry")!;
    main.links = [
      { from: entry.id, to: source.id, order: 0, kind: "divert", direct: true },
      { from: source.id, to: option.id, order: 0, kind: "divert", args: { input_1: "roll + 1" }, action: "roll = 100" },
      { from: source.id, to: second.id, order: 1, kind: "divert", args: { input_1: "roll + 2" }, action: "roll = 100" },
    ];
    const result = checkProject(p);
    expect(result.diagnostics.filter((diagnostic) => diagnostic.severity === "error")).toEqual([]);
    const story = new Story(result.storyJson!);
    story.ChoosePathString("main");
    story.ContinueMaximally();
    expect(story.currentChoices.map((choice) => choice.text)).toEqual(["Вариант 5", "Второй 6"]);
    expect(story.variablesState["roll"]).toBe(4);
    story.ChooseChoiceIndex(1);
    expect(story.ContinueMaximally()).toContain("Второе 6");
    expect(story.variablesState["roll"]).toBe(100);
  });

  it("проверяет условие стрелки в источнике и условие входа в цели", () => {
    const project = createProject("input-gates");
    const canvas = project.canvases.main;
    const inputs = [{ name: "input_1", type: "int" as const, default: 0 }];
    canvas.cards.push(
      createCard("source", "line", { inputs, text: "Источник {input_1}" }),
      createCard("target", "line", { inputs, text: "Цель {input_1}", condition: "input_1 == 7" }),
    );
    canvas.links = [
      { from: "__entry", to: "source", order: 0, kind: "divert", direct: true, args: { input_1: "3" } },
      { from: "source", to: "target", order: 0, kind: "divert", condition: "input_1 == 3", args: { input_1: "input_1 + 4" } },
      { from: "target", to: "__exit", order: 0, kind: "divert" },
    ];
    const result = checkProject(project);
    expect(result.diagnostics.filter((diagnostic) => diagnostic.severity === "error")).toEqual([]);
    expect(new Story(result.storyJson!).ContinueMaximally()).toBe("Источник 3\nЦель 7\n");
  });
});
