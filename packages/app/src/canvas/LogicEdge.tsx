// стрелка-связь: маршрут, подпись условия/действия, узел-заглушка для черновика связи
import { memo } from "react";
import type { Edge, EdgeProps } from "@xyflow/react";
import { BaseEdge, EdgeLabelRenderer, Handle, Position, getBezierPath, useReactFlow } from "@xyflow/react";
import { actionLines } from "@visink/compiler";
import { useStore } from "../store";
import type { EdgeData } from "./constants";

export function roundedRoute(points: { x: number; y: number }[], radius = 16) {
  if (points.length < 2) return "";
  let path = `M ${points[0].x} ${points[0].y}`;
  for (let i = 1; i < points.length - 1; i++) {
    const prev = points[i - 1], at = points[i], next = points[i + 1];
    const before = Math.min(radius, Math.hypot(at.x - prev.x, at.y - prev.y) / 2);
    const after = Math.min(radius, Math.hypot(next.x - at.x, next.y - at.y) / 2);
    const a = { x: at.x + Math.sign(prev.x - at.x) * before, y: at.y + Math.sign(prev.y - at.y) * before };
    const b = { x: at.x + Math.sign(next.x - at.x) * after, y: at.y + Math.sign(next.y - at.y) * after };
    path += ` L ${a.x} ${a.y} Q ${at.x} ${at.y} ${b.x} ${b.y}`;
  }
  const end = points.at(-1)!;
  return path + ` L ${end.x} ${end.y}`;
}

/** Прямые связи остаются плавными; обратные и петли проходят большой дугой над карточками. */
export const LogicEdge = memo(function LogicEdge(props: EdgeProps<Edge<EdgeData>>) {
  const { id, data, selected, markerEnd, style, source, target, sourceX, sourceY, targetX, targetY } = props;
  const { setNodes, setEdges, getNode } = useReactFlow();
  const select = (additive = false) => {
    if (data?.draft) return;
    if (!additive) setNodes((ns) => ns.map((n) => (n.selected ? { ...n, selected: false } : n)));
    setEdges((es) => es.map((e) => {
      const next = e.id === id ? (additive ? !e.selected : true) : additive ? !!e.selected : false;
      return !!e.selected !== next ? { ...e, selected: next } : e;
    }));
  };
  let [path, x, y] = getBezierPath(props);
  if (source === target || sourceX > targetX + 20) {
    const s = getNode(source), t = getNode(target);
    const top = Math.min(s?.position.y ?? sourceY, t?.position.y ?? targetY) - 90;
    const right = sourceX + 60, left = targetX - 60;
    path = roundedRoute([{ x: sourceX, y: sourceY }, { x: right, y: sourceY }, { x: right, y: top }, { x: left, y: top }, { x: left, y: targetY }, { x: targetX, y: targetY }]);
    x = (right + left) / 2;
    y = top;
  }
  const cond = data?.condition?.trim();
  const action = actionLines(data?.action);
  return <>
    <BaseEdge id={id} path={path} markerEnd={markerEnd} style={{ ...style, strokeWidth: selected ? 3 : 2.25, strokeOpacity: 1 }} interactionWidth={28} />
    {(cond || action.length > 0) && <EdgeLabelRenderer><div className={`edge-logic nodrag nopan ${selected ? "selected" : ""} ${data?.error ? "error" : ""}`} style={{ transform: `translate(-50%, -50%) translate(${x}px, ${y}px)` }} onClick={(e) => select(e.shiftKey || e.metaKey || e.ctrlKey)} onDoubleClick={() => { select(); useStore.getState().openEditor(); setTimeout(() => (document.querySelector(".link-props input, .link-props textarea") as HTMLElement | null)?.focus(), 50); }}>
      {cond && <div className="edge-cond mono">{`{${cond}}`}</div>}{action.map((l, i) => <div key={i} className="edge-action mono">{l}</div>)}
    </div></EdgeLabelRenderer>}
  </>;
});

export function DraftNode() {
  return <div className="draft-target"><Handle type="target" position={Position.Left} className="draft-handle" /></div>;
}
