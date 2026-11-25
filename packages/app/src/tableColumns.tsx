import { useEffect, useRef, useState } from "react";

export const INITIAL_COLUMNS = [0.03, 0.155, 0.155, 0.36, 0.11, 0.155, 0.035];
const MINIMUM = [0.03, 0.08, 0.08, 0.15, 0.07, 0.08, 0.035];
const MAXIMUM = [0.06, 0.3, 0.3, 0.6, 0.2, 0.3, 0.06];
const KEY = "visink-table-columns-v2:";
const clamp = (value: number, index: number) => Math.max(MINIMUM[index], Math.min(MAXIMUM[index], value));

export function normalizeColumns(values: number[]) {
  const result = INITIAL_COLUMNS.map((initial, i) => clamp(Number.isFinite(values[i]) && values[i] > 0 ? values[i] : initial, i));
  for (let pass = 0; pass < INITIAL_COLUMNS.length * 2; pass++) {
    const total = result.reduce((sum, width) => sum + width, 0);
    if (Math.abs(total - 1) < 1e-9) break;
    const grow = total < 1;
    const room = result.map((width, i) => grow ? MAXIMUM[i] - width : width - MINIMUM[i]);
    const available = room.reduce((sum, value) => sum + value, 0);
    if (available < 1e-9) break;
    const change = Math.abs(1 - total);
    for (let i = 0; i < result.length; i++) result[i] = clamp(result[i] + (grow ? change : -change) * room[i] / available, i);
  }
  return result;
}

export function resizeColumns(widths: number[], index: number, requested: number) {
  const neighbor = index + 1;
  if (index < 0 || neighbor >= widths.length || !Number.isFinite(requested)) return [...widths];
  const pair = widths[index] + widths[neighbor];
  const minimum = Math.max(MINIMUM[index], pair - MAXIMUM[neighbor]);
  const maximum = Math.min(MAXIMUM[index], pair - MINIMUM[neighbor]);
  const value = Math.max(minimum, Math.min(maximum, requested));
  return widths.map((width, i) => i === index ? value : i === neighbor ? pair - value : width);
}

function read(scope: string) {
  try {
    const raw = JSON.parse(localStorage.getItem(KEY + scope) ?? "null");
    if (Array.isArray(raw) && raw.length === INITIAL_COLUMNS.length) return normalizeColumns(raw);
  } catch { /* Use defaults if storage is unavailable. */ }
  return [...INITIAL_COLUMNS];
}

export function useTableColumns(scope: "entity" | "global") {
  const [widths, setWidths] = useState(() => read(scope));
  const container = useRef<HTMLDivElement>(null);
  const drag = useRef<{ index: number; x: number; widths: number[] } | null>(null);
  useEffect(() => { try { localStorage.setItem(KEY + scope, JSON.stringify(widths)); } catch { /* Local preference only. */ } }, [scope, widths]);
  const resize = (index: number, width: number) => setWidths((old) => resizeColumns(old, index, width));
  const availableWidth = () => container.current?.querySelector("table")?.clientWidth ?? 0;
  const handle = (index: number, label: string) => <span className="column-resizer" role="separator" tabIndex={0} aria-orientation="vertical" aria-label={`Ширина: ${label}`} aria-valuemin={Math.round(MINIMUM[index] * 100)} aria-valuemax={Math.round(MAXIMUM[index] * 100)} aria-valuenow={Math.round(widths[index] * 100)}
    onPointerDown={(e) => { e.preventDefault(); e.stopPropagation(); e.currentTarget.setPointerCapture(e.pointerId); drag.current = { index, x: e.clientX, widths: [...widths] }; }}
    onPointerMove={(e) => { const d = drag.current; const available = availableWidth(); if (d?.index === index && available > 0) setWidths(resizeColumns(d.widths, index, d.widths[index] + (e.clientX - d.x) / available)); }}
    onPointerUp={(e) => { drag.current = null; if (e.currentTarget.hasPointerCapture(e.pointerId)) e.currentTarget.releasePointerCapture(e.pointerId); }}
    onPointerCancel={() => { drag.current = null; }} onLostPointerCapture={() => { drag.current = null; }}
    onDoubleClick={() => resize(index, INITIAL_COLUMNS[index])}
    onKeyDown={(e) => {
      const available = availableWidth();
      if ((e.key === "ArrowLeft" || e.key === "ArrowRight") && available > 0) { e.preventDefault(); resize(index, widths[index] + (e.key === "ArrowLeft" ? -10 : 10) / available); }
      if (e.key === "Home") { e.preventDefault(); resize(index, INITIAL_COLUMNS[index]); }
    }} />;
  return { widths, handle, container };
}
