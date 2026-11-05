// Узлы и стрелки React Flow из проекта без лишних перерисовок.
import type { Edge, Node } from "@xyflow/react";

export function shallowEqual(a: object | undefined, b: object | undefined): boolean {
  if (a === b) return true;
  if (!a || !b) return false;
  const ka = Object.keys(a);
  if (ka.length !== Object.keys(b).length) return false;
  return ka.every((k) => Object.is((a as Record<string, unknown>)[k], (b as Record<string, unknown>)[k]));
}

const sameNode = (o: Node, n: Node) =>
  o.type === n.type && o.position.x === n.position.x && o.position.y === n.position.y && o.width === n.width && o.height === n.height && shallowEqual(o.data, n.data);

/**
 * Узлы из проекта поверх текущих узлов React Flow. Неизменённые остаются теми же объектами,
 * поэтому memo карточек не сбрасывается; у изменённых сохраняются выделение и замеры.
 */
export function mergeNodes(prev: Node[], next: Node[], selected: Set<string>): Node[] {
  const old = new Map(prev.map((n) => [n.id, n]));
  const out = next.map((n) => {
    const o = old.get(n.id);
    if (o && sameNode(o, n)) return o;
    return { ...n, selected: o ? !!o.selected : selected.has(n.id), ...(o?.measured ? { measured: o.measured } : {}) };
  });
  return out.length === prev.length && out.every((n, i) => n === prev[i]) ? prev : out;
}

export function mergeEdges<E extends Edge>(prev: E[], next: E[], selected: Set<string>): E[] {
  const old = new Map(prev.map((e) => [e.id, e]));
  const out = next.map((e) => {
    const o = old.get(e.id);
    if (o && o.type === e.type && o.className === e.className && o.source === e.source && o.target === e.target && shallowEqual(o.data, e.data)) return o;
    return { ...e, selected: o ? !!o.selected : selected.has(e.id) };
  });
  return out.length === prev.length && out.every((e, i) => e === prev[i]) ? prev : out;
}
