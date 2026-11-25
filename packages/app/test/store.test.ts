import { beforeEach, describe, expect, it } from "vitest";
import { editAtomic, redo, undo, useStore } from "../src/store";
import { demoProject } from "../../checker/test/fixtures";
import { canvasLocations } from "@visink/core";
import { jumpTargetLocation } from "../src/ops";
import { deleteEntity } from "../src/organization";
import { registerCanvasViewport } from "../src/navigation";

describe("store", () => {
  beforeEach(() => {
    useStore.getState().openInMemory(demoProject());
    useStore.getState().setActiveCanvas("main", ["file_advisor"]);
  });

  it("редактор карточки сохраняет групповое выделение, не открывая модалку", () => {
    useStore.getState().openCardControl("a3", "entry");
    expect(useStore.getState().selection).toEqual(["a3"]);
    expect(useStore.getState().editorOpen).toBe(false);
    expect(useStore.getState().cardControl?.field).toBe("entry");
    useStore.getState().setSelection(["a3", "a4"]);
    useStore.getState().openCardControl("a4", "repeat");
    expect(useStore.getState().selection).toEqual(["a3", "a4"]);
    expect(useStore.getState().cardControl?.field).toBe("repeat");
    useStore.getState().openEditor();
    expect(useStore.getState().editorOpen).toBe(false);
  });

  it("legacy-цель перехода открывает нужную вложенность через существующую навигацию", () => {
    const project = useStore.getState().project!;
    const dean = jumpTargetLocation(project, "dean.first_meeting")!;
    useStore.getState().focusCard(dean.canvas.id, dean.card?.id);
    expect(useStore.getState()).toMatchObject({ activeCanvas: "main", flowPath: ["file_dean"], selection: ["c1"] });
    const advisor = jumpTargetLocation(project, "advisor.office")!;
    useStore.getState().focusCard(advisor.canvas.id, advisor.card?.id);
    expect(useStore.getState()).toMatchObject({ activeCanvas: "main", flowPath: ["file_advisor"], selection: ["a1"] });
  });

  it("история навигации ходит между вложенностями и внутри канваса, а новый переход очищает Вперёд", () => {
    const st = useStore.getState();
    st.setActiveCanvas("main");
    st.focusCard("dean", "c1");
    st.focusCard("advisor", "a1");
    st.focusCard("advisor", "a2");
    const count = useStore.getState().navBackCount;
    useStore.getState().setSelection(["a4"]);
    expect(useStore.getState().navBackCount).toBe(count);

    useStore.getState().navigateBack();
    expect(useStore.getState()).toMatchObject({ flowPath: ["file_advisor"], selection: ["a1"] });
    useStore.getState().navigateBack();
    expect(useStore.getState()).toMatchObject({ flowPath: ["file_dean"], selection: ["c1"] });
    useStore.getState().navigateForward();
    expect(useStore.getState()).toMatchObject({ flowPath: ["file_advisor"], selection: ["a1"] });
    useStore.getState().focusCard("dean", "c2");
    expect(useStore.getState().navForwardCount).toBe(0);
    useStore.getState().selectEntity("ent_dean");
    useStore.getState().navigateBack();
    expect(useStore.getState()).toMatchObject({ view: "canvas", flowPath: ["file_dean"], selection: ["c2"] });
  });

  it("история сохраняет viewport и полностью сбрасывается для новой сессии проекта", () => {
    let viewport = { x: 10, y: 20, zoom: 1.25 };
    const unregister = registerCanvasViewport(() => viewport);
    useStore.getState().setActiveCanvas("main");
    useStore.getState().focusCard("dean", "c1");
    viewport = { x: 30, y: 40, zoom: 1.5 };
    useStore.getState().focusCard("advisor", "a1");
    useStore.getState().navigateBack();
    expect(useStore.getState().viewportRequest).toMatchObject({ flowKey: "main:file_dean", viewport: { x: 30, y: 40, zoom: 1.5 } });
    unregister();
    const session = useStore.getState().projectSession;
    useStore.getState().openInMemory(demoProject());
    expect(useStore.getState()).toMatchObject({ navBackCount: 0, navForwardCount: 0, viewportRequest: null, projectSession: session + 1 });
  });

  it("немедленный Undo после открытия и удаления сущности возвращает текущий проект", () => {
    useStore.getState().openInMemory(demoProject());
    editAtomic((project) => deleteEntity(project, "ent_dean"));
    const dean = canvasLocations(useStore.getState().project!).find(({ canvas }) => canvas.id === "dean")!.canvas;
    expect(dean.cards.find((card) => card.id === "c1")?.speaker).toBe("ent_narrator");
    undo();
    const restored = useStore.getState().project;
    expect(restored?.settings.name).toBe("Тёмная академия — демо");
    expect(restored?.entities.some((entity) => entity.id === "ent_dean")).toBe(true);
    expect(canvasLocations(restored!).find(({ canvas }) => canvas.id === "dean")?.canvas.cards.find((card) => card.id === "c1")?.speaker).toBe("ent_dean");
    redo();
    expect(useStore.getState().project?.entities.some((entity) => entity.id === "ent_dean")).toBe(false);
  });

  it("правка одной карточки не пересоздаёт остальные объекты проекта", () => {
    const before = useStore.getState().project!;
    useStore.getState().editCanvas((c) => { c.cards.find((card) => card.id === "a1")!.text = "Новый текст"; });
    const after = useStore.getState().project!;
    expect(after).not.toBe(before);
    const dean = (p: typeof before) => canvasLocations(p).find(({ canvas }) => canvas.id === "dean")!.canvas;
    const advisor = (p: typeof before) => canvasLocations(p).find(({ canvas }) => canvas.id === "advisor")!.canvas;
    expect(dean(after)).toBe(dean(before));
    expect(advisor(after).cards.find((card) => card.id === "a2")).toBe(advisor(before).cards.find((card) => card.id === "a2"));
    expect(advisor(after).cards.find((card) => card.id === "a1")!.text).toBe("Новый текст");
  });

  it("рецепт правки может вернуть значение (присваивание в замыкании)", () => {
    let id = "";
    expect(() => useStore.getState().editCanvas((c) => (id = c.cards.find((card) => card.id === "a1")!.id))).not.toThrow();
    expect(id).toBe("a1");
  });
});
