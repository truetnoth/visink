import { describe, expect, it } from "vitest";
import type { Edge, Node } from "@xyflow/react";
import { mergeEdges, mergeNodes, shallowEqual } from "../src/canvasNodes";
import { directEdgeBoundaries, pinBoundary, routedEdgeBoundaries } from "../src/canvas/edgeGeometry";

const node = (id: string, data: Record<string, unknown>, x = 0): Node => ({ id, type: "card", position: { x, y: 0 }, data });
const edge = (id: string, data: Record<string, unknown>): Edge => ({ id, source: "a", target: "b", type: "logic", data });

describe("shallowEqual", () => {
  it("сравнивает поля по ссылке", () => {
    const card = {};
    expect(shallowEqual({ card, n: 1 }, { card, n: 1 })).toBe(true);
    expect(shallowEqual({ card }, { card: {} })).toBe(false);
    expect(shallowEqual({ a: 1 }, { a: 1, b: undefined })).toBe(false);
  });
});

describe("mergeNodes", () => {
  it("ничего не изменилось — тот же массив", () => {
    const card = {};
    const prev = [{ ...node("a", { card }), selected: true }];
    expect(mergeNodes(prev, [node("a", { card })], new Set())).toBe(prev);
  });
  it("изменённый узел пересобирается с выделением и замерами, остальные те же", () => {
    const b = node("b", { card: {} });
    const prev = [{ ...node("a", { card: {} }), selected: true, measured: { width: 10, height: 20 } }, b];
    const out = mergeNodes(prev, [node("a", { card: {} }), node("b", b.data)], new Set());
    expect(out[0]).not.toBe(prev[0]);
    expect(out[0].selected).toBe(true);
    expect(out[0].measured).toEqual({ width: 10, height: 20 });
    expect(out[1]).toBe(b);
  });
  it("сдвиг пересобирает узел", () => {
    const card = {};
    const prev = [node("a", { card }, 0)];
    expect(mergeNodes(prev, [node("a", { card }, 20)], new Set())[0].position.x).toBe(20);
  });
  it("новый узел берёт выделение из store", () => {
    expect(mergeNodes([], [node("n", {})], new Set(["n"]))[0].selected).toBe(true);
  });
});

describe("mergeEdges", () => {
  it("та же логика стрелки — тот же объект", () => {
    const prev = [{ ...edge("a>b>", { condition: "x" }), selected: true }];
    expect(mergeEdges(prev, [edge("a>b>", { condition: "x" })], new Set())).toBe(prev);
  });
  it("другое условие — новый объект, выделение сохраняется", () => {
    const prev = [{ ...edge("a>b>", { condition: "x" }), selected: true }];
    const out = mergeEdges(prev, [edge("a>b>", { condition: "y" })], new Set());
    expect(out[0]).not.toBe(prev[0]);
    expect(out[0].selected).toBe(true);
  });
});


describe("геометрия стрелок у пинов", () => {
  it("по горизонтали возвращает центр наружного края", () => {
    expect(pinBoundary({ x: 100, y: 50 }, { x: 200, y: 50 })).toEqual({ x: 107, y: 50 });
    expect(directEdgeBoundaries({ x: 100, y: 50 }, { x: 200, y: 50 })).toEqual({
      source: { x: 107, y: 50 },
      target: { x: 193, y: 50 },
    });
  });

  it("на диагоналях примыкает сверху или снизу по направлению подхода", () => {
    const fromAbove = directEdgeBoundaries({ x: 100, y: 0 }, { x: 200, y: 100 }).target;
    expect(fromAbove.x).toBeLessThan(200);
    expect(fromAbove.y).toBeLessThan(100);
    const fromBelow = directEdgeBoundaries({ x: 100, y: 100 }, { x: 200, y: 0 }).target;
    expect(fromBelow.x).toBeLessThan(200);
    expect(fromBelow.y).toBeGreaterThan(0);
  });

  it("обратный маршрут использует направления крайних сегментов", () => {
    const points = routedEdgeBoundaries([
      { x: 100, y: 50 }, { x: 160, y: 50 }, { x: 160, y: -50 },
      { x: 40, y: -50 }, { x: 40, y: 80 }, { x: 200, y: 80 },
    ]);
    expect(points[0]).toEqual({ x: 107, y: 50 });
    expect(points.at(-1)).toEqual({ x: 193, y: 80 });
  });
});
