import { beforeEach, describe, expect, it } from "vitest";
import { useStore } from "../src/store";
import { demoProject } from "../../checker/test/fixtures";

describe("store", () => {
  beforeEach(() => {
    useStore.getState().openInMemory(demoProject());
    useStore.getState().setActiveCanvas("advisor");
  });

  it("openCardSettings: одиночная карточка выделяется, группа сохраняется", () => {
    useStore.getState().openCardSettings("a3");
    expect(useStore.getState().selection).toEqual(["a3"]);
    expect(useStore.getState().editorOpen).toBe(true);
    useStore.getState().closeEditor();
    useStore.getState().setSelection(["a3", "a4"]);
    useStore.getState().openCardSettings("a4");
    expect(useStore.getState().selection).toEqual(["a3", "a4"]);
    expect(useStore.getState().editorOpen).toBe(true);
  });

  it("правка одной карточки не пересоздаёт остальные объекты проекта", () => {
    const before = useStore.getState().project!;
    useStore.getState().editCanvas((c) => { c.cards[0].text = "Новый текст"; });
    const after = useStore.getState().project!;
    expect(after).not.toBe(before);
    expect(after.canvases.dean).toBe(before.canvases.dean);
    expect(after.canvases.advisor.cards[1]).toBe(before.canvases.advisor.cards[1]);
    expect(after.canvases.advisor.cards[0].text).toBe("Новый текст");
  });

  it("рецепт правки может вернуть значение (присваивание в замыкании)", () => {
    let id = "";
    expect(() => useStore.getState().editCanvas((c) => (id = c.cards[0].id))).not.toThrow();
    expect(id).toBe("a1");
  });
});
