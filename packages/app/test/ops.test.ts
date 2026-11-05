import { describe, expect, it } from "vitest";
import { checkProject } from "@visink/checker";
import { createCard, linkId } from "@visink/core";
import { demoProject } from "../../checker/test/fixtures";
import { addBranchCards, addCanvas, addNestedFlow, alignToGrid, connect, copyFragment, deleteCards, jumpTargets, parseFragment, pasteFragment, renameVariable, replaceIdent, snapPoint, variableUsages } from "../src/ops";
import { searchProject } from "../src/search";

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

describe("начало файла", () => {
  it("новый файл начинается с первой карточки, удаление начала переносит его", () => {
    const p = demoProject();
    const key = addCanvas(p, "Библиотекарь");
    const c = p.canvases[key];
    expect(c.start).toBe(c.cards[0].id);
    const dean = p.canvases.dean;
    deleteCards(dean, ["c1"]);
    expect(dean.start).toBe("c2");
  });

  it("без начала — предупреждение и догадка", () => {
    const p = demoProject();
    delete p.canvases.dean.start;
    const r = checkProject(p);
    expect(r.diagnostics).toContainEqual(expect.objectContaining({ code: "no-start", canvas: "dean", card: "c1" }));
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
    expect(targets.map((target) => target.value)).toEqual(expect.arrayContaining(["dean", "dean.c1", "dean.nested_hub", "dean.nested_flow", "dean.nested_line"]));
    expect(targets.find((target) => target.value === "dean.nested_line")).toMatchObject({ label: "Скрытая реплика · nested_line", hint: "Декан · внутри вложенности · Реплика" });
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
