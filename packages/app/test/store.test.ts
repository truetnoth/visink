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
});
