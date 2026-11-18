import { describe, expect, it } from "vitest";
import { createProject } from "@visink/core";
import { applySuggestion, suggest } from "../src/suggest";

const project = createProject("Подсказки");
project.variables.vars.push(
  { name: "first_met", type: "bool", default: false },
  { name: "first_met", owner: "ent_player", type: "bool", default: false },
);
project.variables.functions.push({ name: "check", params: ["value"], body: "~ return value" });

describe("подсказки условий", () => {
  it("различает глобальную переменную и свойство сущности с тем же именем", () => {
    expect(suggest("first", 5, project)?.items.map((s) => s.insert)).toEqual(["first_met", "ent_player.first_met"]);
    expect(suggest("ent_player.", 11, project)?.items.map((s) => s.insert)).toEqual(["ent_player.first_met"]);
  });
  it("заменяет слово под курсором, сохраняя остальное многострочное выражение", () => {
    const text = "true and\nfirst_wrong == false";
    const result = suggest(text, 14, project)!;
    expect(applySuggestion(text, result, result.items[0])).toEqual({ text: "true and\nfirst_met == false", caret: 18 });
  });
  it("открывает список принудительно в пустом поле, но не внутри строкового литерала", () => {
    expect(suggest("", 0, project)).toBeNull();
    expect(suggest("", 0, project, { forced: true })?.items.length).toBeGreaterThan(0);
    expect(suggest('"first', 6, project, { forced: true })).toBeNull();
  });
  it("не дублирует скобки функции и ставит курсор внутри", () => {
    const result = suggest("che(first_met)", 3, project)!;
    expect(applySuggestion("che(first_met)", result, result.items[0])).toEqual({ text: "check(first_met)", caret: 6 });
  });
});
