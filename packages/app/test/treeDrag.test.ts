import { afterEach, describe, expect, it } from "vitest";
import { demoProject } from "../../checker/test/fixtures";
import { beginTreeDrag, draggedItems, endTreeDrag, jumpDrop } from "../src/treeDrag";
import { editAtomic, redo, undo, useStore } from "../src/store";

function dataTransfer(): DataTransfer {
  const types: string[] = [];
  return { types, effectAllowed: "copyMove", setData: (type: string) => types.push(type) } as unknown as DataTransfer;
}

describe("перетаскивание цели перехода из дерева", () => {
  afterEach(endTreeDrag);

  it("сохраняет drag после immutable-правки, отклоняет другой project и очищается после drag", () => {
    useStore.getState().openInMemory(demoProject());
    const initial = useStore.getState().project!;
    const dt = dataTransfer();
    beginTreeDrag(dt, initial, [{ kind: "file", id: "dean" }]);
    useStore.getState().edit((project) => { project.settings.name = "Обновлённый проект"; });
    const updated = useStore.getState().project!;
    expect(updated).not.toBe(initial);
    expect(jumpDrop(dt, updated)).toBe("dean");
    expect(jumpDrop(dt, demoProject())).toBeNull();
    endTreeDrag();
    expect(draggedItems(dt, updated)).toBeNull();
    expect(jumpDrop(dt, updated)).toBeNull();
  });

  it("сохраняет drag после undo/redo и продолжает отклонять другой project", () => {
    useStore.getState().openInMemory(demoProject());
    useStore.getState().edit((project) => { project.settings.name = "До изменения"; });
    editAtomic((project) => { project.settings.name = "После изменения"; });
    const dt = dataTransfer();
    beginTreeDrag(dt, useStore.getState().project!, [{ kind: "file", id: "dean" }]);

    undo();
    expect(useStore.getState().project!.settings.name).toBe("До изменения");
    expect(jumpDrop(dt, useStore.getState().project!)).toBe("dean");

    redo();
    expect(useStore.getState().project!.settings.name).toBe("После изменения");
    expect(jumpDrop(dt, useStore.getState().project!)).toBe("dean");
    expect(jumpDrop(dt, demoProject())).toBeNull();
  });

  it("сбрасывает drag при открытии другого проекта", () => {
    const project = demoProject();
    const dt = dataTransfer();
    beginTreeDrag(dt, project, [{ kind: "file", id: "dean" }]);
    useStore.getState().openInMemory(demoProject());
    expect(draggedItems(dt, useStore.getState().project!)).toBeNull();
  });
});
