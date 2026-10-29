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

  it("две стрелки без условий: предупреждение, но ink собирается", () => {
    const p = demoProject();
    const dean = p.canvases.dean;
    dean.cards.push(createCard("cz", "line", { speaker: "ent_dean", text: "Вторая ветка." }));
    dean.links.push({ from: "c1", to: "cz", order: 1, kind: "divert" });
    const r = checkProject(p);
    expect(r.diagnostics.filter((d) => d.severity === "error")).toEqual([]);
    expect(r.diagnostics).toContainEqual(expect.objectContaining({ code: "unreachable-branch", card: "c1" }));
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
