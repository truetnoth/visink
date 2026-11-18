import { describe, it, expect } from "vitest";
import { createProject, createCanvas, createCard, MemoryFs, serializeProject, loadProject, saveProject, namespaceError } from "@visink/core";
import { compileLogic } from "@visink/compiler";
import { checkProject, unknownIdentifiers } from "@visink/checker";
import { addVariableSet, moveVariable, renameNamespace } from "../src/namespaceOps";
import { renameVariable } from "../src/ops";
import { candidates } from "../src/suggest";
import { projectHierarchy, indexHierarchy } from "../src/hierarchy";

function fixture() {
  const p = createProject("Test");
  p.variables.vars.push({ name: "met", owner: "ent_player", type: "bool", default: true });
  const c = createCanvas("scene", "Сцена"); c.start = "outer";
  const outer = createCard("outer", "flow");
  outer.flow!.cards.push(createCard("inner", "line", { text: "Hello", speaker: "ent_player", condition: "ent_player.met" }), createCard("next", "hub"));
  outer.flow!.start = "inner";
  outer.flow!.links.push({ from: "inner", to: "next", order: 0, kind: "divert", action: "ent_player.met = false" });
  c.cards.push(outer); p.canvases.scene = c; p.settings.start = "scene";
  return p;
}

describe("пространства имен", () => {
  it("переименовывает ссылки на любой глубине, сохраняя ID и литералы", () => {
    const p = fixture();
    p.variables.functions.push({ name: "test", params: [], body: '~ return ent_player.met' });
    const inner = p.canvases.scene.cards[0].flow!;
    inner.cards[0].action = 'ent_player.met = "ent_player.met"';
    renameNamespace(p, "ent_player", "hero");
    expect(inner.cards[0].condition).toBe("hero.met");
    expect(inner.cards[0].speaker).toBe("ent_player");
    expect(inner.cards[0].action).toBe('hero.met = "ent_player.met"');
    expect(inner.links[0].action).toBe("hero.met = false");
    expect(p.variables.functions[0].body).toBe("~ return hero.met");
    expect(compileLogic(p, "hero.met")).toBe("hero__met");
    expect(unknownIdentifiers("hero.met", p)).toEqual([]);
    expect(candidates(p).some((s) => s.insert === "hero.met")).toBe(true);
    renameVariable(p, "met", "first_met", "ent_player");
    expect(inner.cards[0].condition).toBe("hero.first_met");
  });
  it("собирает независимые одинаковые имена и перемещает глобальную переменную в набор", () => {
    const p = fixture(); const id = addVariableSet(p); renameNamespace(p, id, "quest");
    p.variables.vars.push({ name: "met", type: "bool", default: true });
    p.canvases.scene.cards[0].condition = "met";
    moveVariable(p, "met", undefined, id);
    expect(p.canvases.scene.cards[0].condition).toBe("quest.met");
    expect(compileLogic(p, "quest.met and ent_player.met")).toBe("quest__met and ent_player__met");
    const result = checkProject(p);
    expect(result.diagnostics.filter((d) => d.severity === "error")).toEqual([]);
    expect(result.storyJson).toBeTruthy();
    renameNamespace(p, id, "chapter");
    expect(p.canvases.scene.cards[0].condition).toBe("chapter.met");
    moveVariable(p, "met", id, undefined);
    expect(p.canvases.scene.cards[0].condition).toBe("met");
  });
  it("отклоняет дубли и недопустимые имена без частичного изменения", () => {
    const p = fixture(); const id = addVariableSet(p);
    expect(namespaceError(p, "bad name", id)).toBeTruthy();
    expect(() => renameNamespace(p, id, "ent_player")).toThrow();
    expect(() => renameNamespace(p, id, "scene")).toThrow();
    p.variables.vars.push({ name: "met", owner: id, type: "bool", default: false });
    const original = structuredClone(p);
    expect(() => moveVariable(p, "met", "ent_player", id)).toThrow();
    expect(p).toEqual(original);
  });
  it("мигрирует и сохраняет LIST; резервная копия точная, повторное сохранение пустое", async () => {
    const p = fixture(); p.variables.lists.push({ name: "OldList", items: ["one"], initial: ["one"] });
    const fs = new MemoryFs(); fs.files = serializeProject(p);
    const settings = JSON.parse(fs.files.get("project.json")!); delete settings.formatVersion;
    fs.files.set("project.json", JSON.stringify(settings));
    const original = new Map(fs.files);
    const loaded = await loadProject(fs); const id = addVariableSet(loaded); renameNamespace(loaded, id, "quest");
    await saveProject(fs, loaded);
    for (const [path, content] of original) expect(fs.files.get(`.backups/pre-v2/${path}`)).toBe(content);
    const reopened = await loadProject(fs);
    expect(reopened.variables.sets).toEqual(loaded.variables.sets);
    expect(reopened.variables.lists).toEqual(p.variables.lists);
    expect(await saveProject(fs, reopened)).toEqual([]);
  });
  it("показывает понятные названия переходов и условий", () => {
    const p = fixture(); const c = p.canvases.scene;
    const hub = c.cards[0].flow!.cards[1]; hub.text = "Встреча"; hub.entry = "meeting";
    c.cards.push(createCard("jump", "jump", { target: "scene.next" }), createCard("check", "condition", { condition: "ent_player.met", text: "Старое название" }));
    const label = () => indexHierarchy(projectHierarchy(p)).nodes.get("card:scene:jump")!.title;
    expect(label()).toBe("Переход → Хаб: Встреча");
    c.cards[1].target = "scene.entry_meeting";
    expect(label()).toBe("Переход → Хаб: Встреча");
    hub.text = "Прощание";
    expect(label()).toBe("Переход → Хаб: Прощание");
    c.cards[1].target = "scene";
    expect(label()).toBe("Переход → Сцена");
    c.cards[1].target = "scene.missing";
    expect(label()).toBe("Переход → Цель не найдена");
    expect(indexHierarchy(projectHierarchy(p)).nodes.get("card:scene:check")!.title).toBe("Условие: ent_player.met");
  });
  it("дерево включает только реальное содержимое вложенностей, без служебных дочерних строк", () => {
    const p = fixture(); const c = p.canvases.scene.cards[0].flow!;
    c.cards[0].action = "ent_player.met = false";
    c.cards[0].entry = "greeting";
    c.cards[0].note = "Комментарий";
    c.notes.push({ id: "n1", text: "Заметка", x: 0, y: 0 }); c.groups.push({ title: "Группа", cards: ["inner", "next"] });
    const { nodes, parents } = indexHierarchy(projectHierarchy(p));
    expect(nodes.has("card:scene:inner")).toBe(true);
    expect(nodes.has("card:scene:inner:in")).toBe(false);
    expect(nodes.has("card:scene:outer:inside")).toBe(false);
    expect(nodes.get("card:scene:inner")?.children).toEqual([]);
    expect(nodes.has("link:scene:inner>next>")).toBe(false);
    expect(nodes.get("card:scene:outer")?.children.map((n) => n.kind)).toEqual(["card", "card", "note", "group"]);
    expect(nodes.has("note:scene:n1")).toBe(true);
    expect(nodes.has("logic:var:ent_player:met")).toBe(false);
    expect(nodes.get("entity:ent_player")?.children).toEqual([]);
    expect(parents.get("card:scene:inner")).toBe("card:scene:outer");
    expect([...nodes.values()].some((n) => n.kind === "group")).toBe(true);
  });
});
