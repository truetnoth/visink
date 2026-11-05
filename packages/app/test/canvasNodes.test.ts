import { describe, expect, it } from "vitest";
import type { Edge, Node } from "@xyflow/react";
import { mergeEdges, mergeNodes, shallowEqual } from "../src/canvasNodes";

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
