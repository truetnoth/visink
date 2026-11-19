import { useEffect, useRef, useState } from "react";

const INITIAL = [28, 100, 140, 200, 90, 94, 28];
const MINIMUM = [28, 70, 80, 100, 64, 70, 28];
const KEY = "visink-table-columns:";
function read(scope: string) {
  try {
    const raw = JSON.parse(localStorage.getItem(KEY + scope) ?? "null");
    if (Array.isArray(raw) && raw.length === INITIAL.length) return raw.map((x, i) => Number.isFinite(x) ? Math.max(MINIMUM[i], Math.min(800, x)) : INITIAL[i]);
  } catch { /* Use defaults if storage is unavailable. */ }
  return [...INITIAL];
}

export function useTableColumns(scope: "entity" | "global") {
  const [widths, setWidths] = useState(() => read(scope));
  const drag = useRef<{ index: number; x: number; width: number } | null>(null);
  useEffect(() => { try { localStorage.setItem(KEY + scope, JSON.stringify(widths)); } catch { /* Local preference only. */ } }, [scope, widths]);
  const resize = (index: number, width: number) => setWidths((old) => old.map((v, i) => i === index ? Math.max(MINIMUM[i], Math.min(800, width)) : v));
  const handle = (index: number, label: string) => <span className="column-resizer" role="separator" tabIndex={0} aria-orientation="vertical" aria-label={`Ширина: ${label}`} aria-valuemin={MINIMUM[index]} aria-valuemax={800} aria-valuenow={Math.round(widths[index])}
    onPointerDown={(e) => { e.preventDefault(); e.stopPropagation(); e.currentTarget.setPointerCapture(e.pointerId); drag.current = { index, x: e.clientX, width: widths[index] }; }}
    onPointerMove={(e) => { const d = drag.current; if (d?.index === index) resize(index, d.width + e.clientX - d.x); }}
    onPointerUp={(e) => { drag.current = null; if (e.currentTarget.hasPointerCapture(e.pointerId)) e.currentTarget.releasePointerCapture(e.pointerId); }}
    onPointerCancel={() => { drag.current = null; }} onLostPointerCapture={() => { drag.current = null; }}
    onDoubleClick={() => resize(index, INITIAL[index])}
    onKeyDown={(e) => { if (e.key === "ArrowLeft" || e.key === "ArrowRight") { e.preventDefault(); resize(index, widths[index] + (e.key === "ArrowLeft" ? -10 : 10)); } if (e.key === "Home") { e.preventDefault(); resize(index, INITIAL[index]); } }} />;
  return { widths, handle, total: widths.reduce((a, b) => a + b, 0) };
}
