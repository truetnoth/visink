import { describe, expect, it } from "vitest";
import { Story } from "inkjs/full";
import { MemoryFs, createCanvas, createCard, createProject, loadProject, saveProject, stableStringify, writeBuild } from "@visink/core";
import { buildProject, escapeInkText } from "@visink/compiler";
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
      dest.flow!.cards = [createCard("inside", "line", { speaker: "ent_narrator", text: "Внутри вложенности." })];
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
    const dean = p.canvases.dean;
    expect(dean.cards.map((c) => `${c.id}:${c.type}${c.entry ? `:${c.entry}` : ""}`)).toEqual(["l1:line:hello", "l2:line", "l3:line", "e2:ink"]);
    expect(dean.graveyard.sort()).toEqual(["e1", "s0"]);
    const r = checkProject(p);
    expect(r.diagnostics.filter((d) => d.severity === "error")).toEqual([]);
    const story = new Story(r.storyJson!);
    expect(story.ContinueMaximally()).toBe("ДЕКАН: Привет.\n");
    story.ChooseChoiceIndex(1);
    expect(story.ContinueMaximally()).toBe("ИГРОК: Конец игры.\n");

    await saveProject(fs, p);
    expect(await fs.listFiles("canvases")).toEqual(["canvases/dean.canvas.json"]);
    expect(await saveProject(fs, await loadProject(fs))).toEqual([]);
  });

  it("размер карточки и функции сохраняются и грузятся без изменений", async () => {
    const fs = new MemoryFs();
    const p = demoProject();
    p.canvases.dean.layout.c2 = { ...p.canvases.dean.layout.c2, w: 320, h: 140 };
    p.variables.functions.push({ name: "f", params: ["a"], body: "~ return a", external: true });
    await saveProject(fs, p);
    const loaded = await loadProject(fs);
    expect(loaded.canvases.dean.layout.c2).toMatchObject({ w: 320, h: 140 });
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
    const loaded = await loadProject(fs);
    const dean = loaded.canvases.dean;
    const card = (id: string) => dean.cards.find((x) => x.id === id)!;
    expect(card("n2").condition).toBe("x");
    // у стрелки было и условие — действие уходит в цель, а не в источник (иначе выполнится до проверки)
    expect(card("n1").action).toBeUndefined();
    expect(card("n2").action).toBe("x = false");
    expect(card("p1").condition).toBe("y");
    expect(card("p1").action).toBe("y = false");
    expect(dean.links.map((l) => [l.to, l.condition ?? "", l.action ?? ""])).toEqual([
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
  it("nested сохраняется, компилируется в родительский knot и запускается по entry", async () => {
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
    const nested = loaded.canvases.scene.cards[0].flow!;
    expect(nested.cards.map((x) => x.id)).toEqual(["inner_1", "inner_2"]);
    expect(await saveProject(fs, loaded)).toEqual([]);

    const r = checkProject(loaded);
    expect(r.diagnostics.filter((d) => d.severity === "error")).toEqual([]);
    const ink = r.build.files.get("scene.ink")!;
    expect(ink.match(/^=== scene ===$/gm)).toHaveLength(1);
    expect(ink).toContain("= entry_inner");
    expect(ink).toContain("= inner_1");
    expect(ink).not.toContain("=== scene_outer ===");
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
    box.flow!.cards = [createCard("nested_choice", "line", { speaker: "ent_player", text: "Ответ из вложенности.", menuText: "Вложенный вариант" })];
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
