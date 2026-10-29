import { describe, expect, it } from "vitest";
import { checkProject } from "@visink/checker";
import { demoProject } from "../../checker/test/fixtures";
import { addCanvas, alignToGrid, copyFragment, deleteCards, parseFragment, pasteFragment, renameVariable, replaceIdent, snapPoint, variableUsages } from "../src/ops";
import { searchProject } from "../src/search";

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
