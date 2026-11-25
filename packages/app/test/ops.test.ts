import { describe, expect, it } from "vitest";
import { Story } from "inkjs/full";
import { checkProject } from "@visink/checker";
import { createCard, createCanvas, createProject, linkId, prepareProject, canvasLocations } from "@visink/core";
import { demoProject } from "../../checker/test/fixtures";
import { addBranchCards, addCanvas, addCard, addNestedFlow, addNextLine, addNote, addPlayerOption, alignToGrid, connect, copyFragment, deleteCards, deleteLinks, jumpTargetLocation, jumpTargets, parseFragment, pasteFragment, renameVariable, renameNestedCanvas, replaceIdent, setCanvasStart, snapPoint, variableUsages } from "../src/ops";
import { searchProject } from "../src/search";
import { moveCards } from "../src/organization";
import { moveVariable } from "../src/namespaceOps";

describe("linkId", () => {
  it("id стрелки: from>to>port, без порта — пустой хвост", () => {
    expect(linkId({ from: "a", to: "b" })).toBe("a>b>");
    expect(linkId({ from: "a", to: "b", port: "yes" })).toBe("a>b>yes");
  });
});

describe("связи условия", () => {
  it("один порт хранит несколько целей и отбрасывает только точный дубликат", () => {
    const p = demoProject();
    const c = p.canvases.advisor;
    c.cards.push(createCard("a12", "line", { speaker: "ent_advisor", text: "Ещё ветка." }));
    c.layout.a12 = { x: 900, y: 300 };
    connect(c, "a8", "a12", "yes");
    connect(c, "a8", "a12", "yes");
    expect(c.links.filter((l) => l.from === "a8" && l.port === "yes").map((l) => l.to).sort()).toEqual(["a12", "a9"]);
    connect(c, "a8", "a12", "no");
    expect(c.links.filter((l) => l.from === "a8" && l.port === "no").map((l) => l.to).sort()).toEqual(["a10", "a12"]);
    connect(c, "a8", "a8", "yes");
    expect(c.links.some((l) => l.from === "a8" && l.to === "a8")).toBe(false);
  });

  it("пакетно создаёт 1–4 карточки справа и подключает каждую к исходному порту", () => {
    const p = demoProject();
    const c = p.canvases.advisor;
    const created = addBranchCards(c, "a8", "line", 4, { speaker: "ent_advisor" }, c, 20, "yes");
    expect(created).toHaveLength(4);
    expect(new Set(created.map((card) => card.id)).size).toBe(4);
    expect(created.every((card) => c.links.some((l) => l.from === "a8" && l.to === card.id && l.port === "yes"))).toBe(true);
    const positions = created.map((card) => c.layout[card.id]);
    expect(new Set(positions.map((point) => point.x)).size).toBe(1);
    expect(positions.map((point) => point.y)).toEqual([60, 260, 460, 660]);
    expect(positions.every((point) => point.x % 20 === 0 && point.y % 20 === 0)).toBe(true);
  });
});

describe("варианты игрока", () => {
  it("Tab создаёт повторяемый ответ и подключает его к выбранной реплике", () => {
    const p = demoProject();
    const c = p.canvases.advisor;
    const card = addPlayerOption(p, c, "a1")!;
    expect(card).toMatchObject({ speaker: "ent_player", repeat: "sticky" });
    expect(c.links.some((link) => link.from === "a1" && link.to === card.id)).toBe(true);
  });

  it("Enter создаёт sticky при возврате к игроку и не меняет поведение NPC", () => {
    const p = demoProject();
    const c = p.canvases.advisor;
    const player = addNextLine(p, c, "a6")!;
    expect(player).toMatchObject({ speaker: "ent_player", repeat: "sticky" });
    const npc = addNextLine(p, c, "a1")!;
    expect(npc).toMatchObject({ speaker: "ent_advisor", repeat: "once" });
    expect(c.cards.find((card) => card.id === "a3")!.repeat).toBe("once");
    expect(c.cards.find((card) => card.id === "a12")!.repeat).toBe("fallback");
  });
});

describe("переменные", () => {
  it("замена имени по границе слова и не в строках", () => {
    expect(replaceIdent('logic >= 3 and logic_max > 1 and x == "logic"', "logic", "wit")).toBe('wit >= 3 and logic_max > 1 and x == "logic"');
    expect(replaceIdent("Clues has Clues.archive", "Clues", "Evidence")).toBe("Evidence has Evidence.archive");
  });

  it("переименование обновляет условия и действия карточек и стрелок", () => {
    const p = demoProject();
    p.canvases.dean.links.find((l) => l.from === "c2" && l.to === "c3")!.condition = "dean_trust > 0";
    expect(variableUsages(p, "dean_trust").map((u) => u.card ?? `${u.link!.from}>${u.link!.to}`)).toEqual(["c5", "c2>c3", "a8"]);
    renameVariable(p, "dean_trust", "trust");
    expect(p.variables.vars.map((v) => v.name)).toContain("trust");
    expect(p.canvases.dean.cards.find((c) => c.id === "c5")!.action).toBe("trust -= 1");
    expect(p.canvases.advisor.cards.find((c) => c.id === "a8")!.condition).toBe("trust < 0");
    expect(checkProject(p).diagnostics.filter((d) => d.severity === "error")).toEqual([]);
  });
  it("rename/move/поиск обходят только распознанные шаблоны реплик", () => {
    const p = createProject("text-references");
    p.variables.sets = [{ id: "quest", name: "quest" }];
    p.variables.vars.push({ name: "roll", type: "int", default: 1 }, { name: "roll", owner: "quest", type: "int", default: 2 });
    const card = createCard("line", "line", {
      speaker: "ent_narrator",
      text: "Бросок {roll}, набор {quest.roll}, экран \\{roll}, литералы {версия 2} и {заметка про roll}",
      menuText: "Ход {roll + 1}",
    });
    p.canvases.main.cards.push(card);
    expect(variableUsages(p, "roll").map((usage) => usage.card)).toEqual(["line"]);
    renameVariable(p, "roll", "score");
    expect(card.text).toBe("Бросок {score}, набор {quest.roll}, экран \\{roll}, литералы {версия 2} и {заметка про roll}");
    expect(card.menuText).toBe("Ход {score + 1}");
    renameVariable(p, "roll", "bonus", "quest");
    expect(card.text).toContain("набор {quest.bonus}");
    expect(variableUsages(p, "bonus", "quest").map((usage) => usage.card)).toEqual(["line"]);
    moveVariable(p, "score", undefined, "quest");
    expect(card.text).toContain("Бросок {quest.score}");
    expect(card.menuText).toBe("Ход {quest.score + 1}");
    expect(searchProject(p, "quest.score").get("card")?.map((hit) => hit.card)).toEqual(["line"]);
    expect(checkProject(p).diagnostics.filter((diagnostic) => diagnostic.severity === "error")).toEqual([]);
  });
});

describe("функции", () => {
  it("переименование функции меняет вызовы, параметры не трогает", () => {
    const p = demoProject();
    p.variables.functions.push({ name: "bump", params: ["logic"], body: "~ return logic + 1" });
    p.variables.functions.push({ name: "twice", params: [], body: "~ return bump(bump(logic))" });
    p.canvases.dean.cards.find((c) => c.id === "c5")!.action = "logic = bump(logic)";
    expect(variableUsages(p, "bump").map((u) => u.func ?? u.card)).toEqual(["twice", "c5"]);
    renameVariable(p, "bump", "inc");
    renameVariable(p, "logic", "wit");
    expect(p.variables.functions.map((f) => [f.name, f.body])).toEqual([
      ["inc", "~ return logic + 1"],
      ["twice", "~ return inc(inc(wit))"],
    ]);
    expect(p.canvases.dean.cards.find((c) => c.id === "c5")!.action).toBe("wit = inc(wit)");
    expect(checkProject(p).diagnostics.filter((d) => d.severity === "error")).toEqual([]);
  });
});

describe("границы холста", () => {
  it("новый файл является вложенностью main с явными входом и выходом; границы не удаляются", () => {
    const p = demoProject();
    const id = addCanvas(p, "Библиотекарь");
    const card = p.canvases.main.cards.find((c) => c.id === id)!;
    expect(card.flow?.cards.map((c) => c.type)).toEqual(["entry", "exit"]);
    deleteCards(card.flow!, ["__entry", "__exit"]);
    expect(card.flow?.cards.map((c) => c.type)).toEqual(["entry", "exit"]);
    expect(card.flow?.layout.__entry).toBeDefined();
  });

  it("удаление старого поля start не создаёт предупреждение: начало задаёт «Вход»", () => {
    const p = demoProject();
    delete p.canvases.dean.start;
    const r = checkProject(p);
    expect(r.diagnostics.some((d) => d.code === "no-start")).toBe(false);
    expect(r.storyJson).toBeTruthy();
  });

  it("после удаления единственной корневой карточки новая снова становится стартом", () => {
    const p = createProject("start-after-delete");
    const main = p.canvases.main;
    const first = addCard(main, "line", { x: 0, y: 0 }, { speaker: "ent_narrator", text: "Первая." });
    const entry = main.cards.find((card) => card.type === "entry")!;
    const startLink = main.links.find((link) => link.from === entry.id)!;
    startLink.condition = "true";
    startLink.action = "true";
    setCanvasStart(main, first.id);
    expect(main.links.find((link) => link.from === entry.id)).toBe(startLink);

    deleteCards(main, [first.id]);
    const exit = main.cards.find((card) => card.type === "exit")!;
    expect(main.links.find((link) => link.from === entry.id)?.to).toBe(exit.id);
    const second = addCard(main, "line", { x: 0, y: 0 }, { speaker: "ent_narrator", text: "Новый старт." });
    expect(main.links.find((link) => link.from === entry.id)).toMatchObject({ to: second.id });
    expect(main.links.find((link) => link.from === entry.id)?.direct).toBeUndefined();
    const result = checkProject(p);
    expect(result.diagnostics.filter((diagnostic) => diagnostic.severity === "error")).toEqual([]);
    const story = new Story(result.storyJson!);
    story.ChoosePathString("main");
    expect(story.ContinueMaximally()).toBe("Новый старт.\n");
  });

  it("ручной перенос корневого старта создаёт обычную связь без direct", () => {
    const p = createProject("manual-start");
    const main = p.canvases.main;
    addCard(main, "hub", { x: 0, y: 0 });
    const second = addCard(main, "line", { x: 300, y: 0 }, { speaker: "ent_narrator", text: "Старт." });
    setCanvasStart(main, second.id);
    const entry = main.cards.find((card) => card.type === "entry")!;
    expect(main.links.find((link) => link.from === entry.id)).toMatchObject({ to: second.id, kind: "divert" });
    expect(main.links.find((link) => link.from === entry.id)?.direct).toBeUndefined();
  });

  it("не восстанавливает намеренно разорванный старт вложенности при удалении", () => {
    const box = createCard("box", "flow");
    const nested = box.flow!;
    const line = addCard(nested, "line", { x: 0, y: 0 }, { speaker: "ent_narrator", text: "Внутри." });
    deleteCards(nested, [line.id]);
    const entry = nested.cards.find((card) => card.type === "entry")!;
    expect(nested.links.some((link) => link.from === entry.id)).toBe(false);
  });
});

describe("deleteLinks", () => {
  it("deleteLinks удаляет стрелки по id и перенумеровывает порядок", () => {
    const c = demoProject().canvases.advisor;
    deleteLinks(c, ["a8>a9>yes", "a2>a3>"]);
    expect(c.links.some((l) => l.from === "a8" && l.to === "a9")).toBe(false);
    expect(c.links.some((l) => l.from === "a2" && l.to === "a3")).toBe(false);
    expect(c.links.filter((l) => l.from === "a2").map((l) => l.order)).toEqual([0, 1, 2]);
  });
});

describe("общий поиск", () => {
  it("находит по группам", () => {
    const p = demoProject();
    const hits = searchProject(p, "декан");
    expect(hits.get("file")!.map((h) => h.key)).toEqual(["dean"]);
    expect(hits.get("entity")!.map((h) => h.id)).toEqual(["ent_dean"]);
    expect(searchProject(p, "trust").get("var")!.map((h) => h.id)).toEqual(["dean_trust"]);
    expect(searchProject(p, "trust").get("card")!.map((h) => h.card)).toEqual(expect.arrayContaining(["c5", "a8"]));
    expect(searchProject(p, "letter").get("list")!.map((h) => h.id)).toEqual(["Clues"]);
  });
});

describe("подсказки при вводе", () => {
  it("переменные, элементы списков, функции; подстановка", async () => {
    const { suggest, applySuggestion } = await import("../src/suggest");
    const p = demoProject();
    p.variables.functions.push({ name: "trust_level", params: ["who"], body: "~ return 0" });
    const r = suggest("not tru", 7, p)!;
    expect(r.items.map((s) => s.insert)).toEqual(["trust_level()", "dean_trust"]);
    expect(applySuggestion("not tru", r, r.items[0])).toEqual({ text: "not trust_level()", caret: 16 });
    const items = suggest("Clues has Clues.a", 17, p)!;
    expect(items.items[0].insert).toBe("Clues.archive");
    expect(suggest('x == "tru', 9, p)).toBeNull();
    expect(suggest("", 0, p)).toBeNull();
    expect(suggest("", 0, p, { forced: true })!.items.length).toBeGreaterThan(5);
  });
});

describe("копировать и вставить", () => {
  it("новая заметка не содержит служебной подписи", () => {
    const canvas = createProject("notes").canvases.main;
    expect(addNote(canvas, { x: 20, y: 40 }).text).toBe("");
  });

  it("новые id, стрелки только внутри куска, вход не дублируется", () => {
    const p = demoProject();
    const dean = p.canvases.dean;
    const fragment = parseFragment(JSON.stringify(copyFragment(dean, ["c1", "c2", "c3"])))!;
    expect(fragment.links.map((l) => `${l.from}>${l.to}`)).toEqual(["c1>c2", "c2>c3"]);
    const before = dean.cards.length;
    const ids = pasteFragment(p, dean, fragment, { x: 1003, y: 497 }, 20);
    expect(ids).toHaveLength(3);
    expect(dean.cards.length).toBe(before + 3);
    expect(ids.some((id) => ["c1", "c2", "c3"].includes(id))).toBe(false);
    const pasted = dean.cards.filter((c) => ids.includes(c.id));
    expect(pasted.some((c) => c.entry)).toBe(false);
    expect(pasted.map((c) => c.text)).toEqual(["Садитесь.", "Итак, ваша диссертация?", "Почти готова."]);
    expect(dean.links.filter((l) => ids.includes(l.from) || ids.includes(l.to))).toHaveLength(2);
    // левый верхний угол куска — в точке вставки, по сетке
    const xs = ids.map((id) => dean.layout[id].x);
    const ys = ids.map((id) => dean.layout[id].y);
    expect([Math.min(...xs), Math.min(...ys)]).toEqual([1000, 500]);
    expect(checkProject(p).diagnostics.filter((d) => d.severity === "error")).toEqual([]);
  });

  it("в другой проект: неизвестный спикер заменяется", () => {
    const p = demoProject();
    const fragment = copyFragment(p.canvases.dean, ["c2"])!;
    fragment.cards[0].speaker = "ent_ghost";
    const [id] = pasteFragment(p, p.canvases.advisor, fragment);
    expect(p.canvases.advisor.cards.find((c) => c.id === id)!.speaker).not.toBe("ent_ghost");
  });

  it("сохраняет ручные размеры заметки при вставке", () => {
    const p = demoProject();
    const dean = p.canvases.dean;
    dean.notes.push({ id: "note_sized", text: "Размеры", color: "#ef4444", x: 40, y: 60, w: 320, h: 180 });
    const fragment = copyFragment(dean, ["note_sized"])!;
    const [id] = pasteFragment(p, dean, fragment, { x: 500, y: 300 });
    expect(dean.notes.find((note) => note.id === id)).toMatchObject({ color: "#ef4444", w: 320, h: 180, x: 500, y: 300 });
  });

  it("чужой текст — не кусок холста", () => {
    expect(parseFragment("просто текст")).toBeNull();
    expect(parseFragment('{"a":1}')).toBeNull();
  });
});

describe("сетка", () => {
  it("привязка точки и выравнивание холста", () => {
    expect(snapPoint({ x: 29, y: 31 }, 20)).toEqual({ x: 20, y: 40 });
    expect(snapPoint({ x: 29.6, y: 31.2 })).toEqual({ x: 30, y: 31 });
    const p = demoProject();
    const dean = p.canvases.dean;
    dean.layout.c1 = { x: 13, y: 47, w: 291 };
    alignToGrid(dean, 20);
    expect(dean.layout.c1).toEqual({ x: 20, y: 40, w: 300 });
  });
});

describe("вложенные потоки и области имён", () => {
  it("копирование карточки клонирует весь внутренний поток и переназначает id", () => {
    const p = demoProject();
    const dean = p.canvases.dean;
    const nested = addNestedFlow(dean, "c1");
    nested.cards = [
      createCard("nested_a", "line", { speaker: "ent_dean", text: "А" }),
      createCard("nested_b", "line", { speaker: "ent_dean", text: "Б" }),
    ];
    nested.links = [{ from: "nested_a", to: "nested_b", order: 0, kind: "divert" }];
    nested.layout = { nested_a: { x: 0, y: 0 }, nested_b: { x: 320, y: 0 } };
    nested.start = "nested_a";
    const fragment = copyFragment(dean, ["c1"])!;
    const [id] = pasteFragment(p, dean, fragment);
    const copy = dean.cards.find((c) => c.id === id)!;
    expect(copy.flow).toBeDefined();
    expect(copy.flow!.cards.map((c) => c.text)).toEqual(["А", "Б"]);
    expect(copy.flow!.cards.some((c) => ["nested_a", "nested_b"].includes(c.id))).toBe(false);
    const ids = copy.flow!.cards.map((c) => c.id);
    expect(copy.flow!.links[0]).toMatchObject({ from: ids[0], to: ids[1] });
    expect(copy.flow!.start).toBe(ids[0]);
    expect(checkProject(p).diagnostics.filter((d) => d.severity === "error")).toEqual([]);
  });

  it("цели jump включают реплики, хабы и карточки внутри вложенностей", () => {
    const p = demoProject();
    const nested = addNestedFlow(p.canvases.dean, "c1");
    nested.cards = [
      createCard("nested_hub", "hub"),
      createCard("nested_flow", "flow", { text: "Внутренняя глава" }),
      createCard("nested_line", "line", { speaker: "ent_dean", text: "Скрытая реплика" }),
    ];
    const targets = jumpTargets(p);
    expect(targets.map((target) => target.value)).toEqual(expect.arrayContaining(["dean", "dean.c1", "dean_c1.nested_hub", "dean_c1.nested_flow", "dean_c1.nested_line"]));
    expect(targets.flatMap((target) => target.aliases ?? [])).toEqual(expect.arrayContaining(["dean.nested_hub", "dean.nested_flow", "dean.nested_line"]));
    expect(targets.find((target) => target.value === "dean_c1.nested_line")).toMatchObject({ label: "Скрытая реплика · nested_line" });
  });

  it("не дублирует technical/legacy-адреса и сохраняет именованные входы отдельно", () => {
    const p = createProject("dedupe-targets");
    const main = p.canvases.main;
    main.legacyId = "main";
    const box = createCard("nested_box", "flow");
    box.flow!.legacyId = "main";
    box.flow!.cards.push(createCard("nested_same", "line", { speaker: "ent_narrator", text: "Повтор" }));
    main.cards.push(
      createCard("root_same", "line", { speaker: "ent_narrator", text: "Повтор", entry: "begin" }),
      box,
      createCard("saved_jump", "jump", { target: "main.nested_same" }),
    );
    const targets = jumpTargets(p);
    const cards = targets.filter((target) => target.label.startsWith("Повтор"));
    expect(cards.map((target) => target.value).sort()).toEqual(["flow_nested_box.nested_same", "main.root_same"]);
    expect(cards.find((target) => target.value === "flow_nested_box.nested_same")?.aliases).toContain("main.nested_same");
    expect(cards.find((target) => target.value === "main.root_same")?.aliases ?? []).not.toContain("main.nested_same");
    expect(targets.find((target) => target.value === "main.entry_begin")).toMatchObject({ label: "Вход: begin", aliases: ["main.begin"] });
    expect(main.cards.find((card) => card.id === "saved_jump")?.target).toBe("main.nested_same");
    expect(jumpTargetLocation(p, "main.nested_same")?.card?.id).toBe("nested_same");
  });

  it("поиск, подсказки, использования и rename различают владельцев", async () => {
    const { suggest } = await import("../src/suggest");
    const p = demoProject();
    p.variables.vars.push(
      { name: "trust", owner: "ent_dean", type: "int", default: 1 },
      { name: "trust", owner: "ent_advisor", type: "int", default: 2 },
    );
    p.variables.functions.push(
      { name: "can_start", owner: "ent_dean", params: [], body: "~ return trust > 0" },
      { name: "can_start", owner: "ent_advisor", params: [], body: "~ return trust > 1" },
    );
    p.canvases.dean.cards.find((c) => c.id === "c1")!.action = "ent_dean.trust += 1";
    p.canvases.advisor.cards.find((c) => c.id === "a1")!.action = "ent_advisor.trust += 1";
    expect(variableUsages(p, "trust", "ent_dean").map((u) => `${u.key}:${u.card ?? u.func}`)).toEqual([":can_start", "dean:c1"]);
    expect(searchProject(p, "ent_advisor.trust").get("var")!.map((h) => [h.id, h.owner])).toEqual([["trust", "ent_advisor"]]);
    expect(suggest("ent_dean.", 9, p)!.items.map((s) => s.insert)).toEqual(expect.arrayContaining(["ent_dean.trust", "ent_dean.can_start()"]));
    renameVariable(p, "trust", "rapport", "ent_advisor");
    expect(p.canvases.dean.cards.find((c) => c.id === "c1")!.action).toBe("ent_dean.trust += 1");
    expect(p.canvases.advisor.cards.find((c) => c.id === "a1")!.action).toBe("ent_advisor.rapport += 1");
    expect(p.variables.functions.find((f) => f.owner === "ent_advisor")!.body).toBe("~ return rapport > 1");
    expect(p.variables.functions.find((f) => f.owner === "ent_dean")!.body).toBe("~ return trust > 0");
  });
});

describe("навигация по целям перехода", () => {
  it("разрешает main, корневые и legacy-адреса в реальные видимые карточки", () => {
    const p = prepareProject(demoProject());
    expect(jumpTargetLocation(p, "main")?.card?.id).not.toBe("__entry");
    expect(jumpTargetLocation(p, "main.file_dean")).toMatchObject({ canvas: p.canvases.main, card: { id: "file_dean", type: "flow" } });
    expect(jumpTargetLocation(p, "dean.first_meeting")).toMatchObject({ canvas: { id: "dean" }, card: { id: "c1" } });
    expect(jumpTargetLocation(p, "dean.entry_first_meeting")).toMatchObject({ canvas: { id: "dean" }, card: { id: "c1" } });
    expect(jumpTargetLocation(p, "advisor.office")).toMatchObject({ canvas: { id: "advisor" }, card: { id: "a1" } });
    expect(jumpTargetLocation(p, "main.missing")).toBeNull();
  });
});


describe("технические границы при копировании и переносе", () => {
  it("не копирует связи границ и локально связывает одинаковые id на разных уровнях", () => {
    const p = demoProject();
    const source = createCard("container", "flow", { text: "Контейнер" });
    const outerLine = addCard(source.flow!, "line", { x: 300, y: 0 }, { speaker: "ent_narrator", text: "Outer" }, p.canvases.dean);
    connect(source.flow!, outerLine.id, source.flow!.cards.find((c) => c.type === "exit")!.id);
    const nested = addCard(source.flow!, "flow", { x: 600, y: 0 }, { text: "Nested" }, p.canvases.dean);
    const innerLine = addCard(nested.flow!, "line", { x: 300, y: 0 }, { speaker: "ent_narrator", text: "Inner" }, p.canvases.dean);
    connect(nested.flow!, innerLine.id, nested.flow!.cards.find((c) => c.type === "exit")!.id);
    p.canvases.dean.cards.push(source);
    p.canvases.dean.layout[source.id] = { x: 0, y: 0 };
    const fragment = copyFragment(p.canvases.dean, [source.id])!;
    expect(fragment.links).toEqual([]);
    const [id] = pasteFragment(p, p.canvases.advisor, fragment);
    const copy = p.canvases.advisor.cards.find((card) => card.id === id)!;
    expect(copy.flow!.id).not.toBe(source.flow!.id);
    const copyNested = copy.flow!.cards.find((card) => card.type === "flow")!;
    expect(copyNested.flow!.id).not.toBe(nested.flow!.id);
    for (const canvas of [copy.flow!, copyNested.flow!]) {
      const entry = canvas.cards.find((card) => card.type === "entry")!;
      const exit = canvas.cards.find((card) => card.type === "exit")!;
      const entryLink = canvas.links.find((link) => link.from === entry.id)!;
      expect(canvas.cards.some((card) => card.id === entryLink.to)).toBe(true);
      expect(canvas.links.filter((link) => link.to === exit.id).every((link) => canvas.cards.some((card) => card.id === link.from))).toBe(true);
    }
    expect(checkProject(p).diagnostics.filter((d) => d.severity === "error")).toEqual([]);
  });

  it("при переносе условия сохраняет обе полные связи yes/no к выходу целевого холста", () => {
    const p = prepareProject(demoProject());
    const source = canvasLocations(p).find(({ canvas }) => canvas.id === "dean")!.canvas;
    const target = canvasLocations(p).find(({ canvas }) => canvas.id === "advisor")!.canvas;
    const gate = createCard("gate", "condition", { condition: "logic > 0" });
    source.cards.push(gate);
    source.layout[gate.id] = { x: 0, y: 0 };
    const exit = source.cards.find((card) => card.type === "exit")!;
    source.links.push(
      { from: gate.id, to: exit.id, port: "yes", order: 0, kind: "divert", condition: "thesis_changed", action: "logic = 1" },
      { from: gate.id, to: exit.id, port: "no", order: 1, kind: "divert", action: "logic = 2" },
    );
    moveCards(p, "main", ["file_dean"], [gate.id], "main", ["file_advisor"]);
    const targetExit = target.cards.find((card) => card.type === "exit")!;
    expect(target.links.filter((link) => link.from === gate.id)).toEqual([
      { from: gate.id, to: targetExit.id, port: "yes", order: 0, kind: "divert", condition: "thesis_changed", action: "logic = 1" },
      { from: gate.id, to: targetExit.id, port: "no", order: 1, kind: "divert", action: "logic = 2" },
    ]);
    expect(checkProject(p).diagnostics.filter((d) => d.severity === "error")).toEqual([]);
  });
});


describe("имена и адреса канвасов", () => {
  it("резервирует globals/main и различает физические имена без учёта регистра", () => {
    const p = demoProject();
    const first = addCanvas(p, "Globals");
    const second = addCanvas(p, "globals");
    const ids = [first, second].map((id) => p.canvases.main.cards.find((card) => card.id === id)!.flow!.id);
    expect(ids[0].toLowerCase()).toBe("globals_2");
    expect(ids[1].toLowerCase()).toBe("globals_3");
    expect(checkProject(p).diagnostics.filter((d) => d.severity === "error")).toEqual([]);
  });

  it("техническое переименование корня сохраняет новые и старые card/entry адреса", () => {
    const p = createProject("rename-legacy");
    const dialog = createCanvas("dialog", "Диалог");
    const box = createCard("box", "flow", { text: "Блок" });
    box.flow = createCanvas("dialog_box", "Блок");
    box.flow.cards = [createCard("inner", "line", { speaker: "ent_narrator", text: "Внутри.", entry: "intro" })];
    box.flow.start = "inner";
    dialog.cards = [box];
    dialog.start = box.id;
    p.canvases = { dialog };
    p.settings.start = "dialog";
    prepareProject(p);
    const jump = createCard("jump", "jump", { target: "dialog.inner" });
    p.canvases.main.cards.push(jump);
    p.canvases.main.layout[jump.id] = { x: 0, y: 0 };
    renameNestedCanvas(p, ["file_dialog"], "renamed_dialog");
    expect(jump.target).toBe("renamed_dialog.inner");
    const r = checkProject(p);
    expect(r.diagnostics.filter((d) => d.severity === "error")).toEqual([]);
    for (const target of ["dialog.inner", "renamed_dialog.inner", "dialog.entry_intro", "renamed_dialog.entry_intro"]) {
      const story = new Story(r.storyJson!);
      story.ChoosePathString(target);
      expect(story.ContinueMaximally()).toBe("Внутри.\n");
    }
  });
});
