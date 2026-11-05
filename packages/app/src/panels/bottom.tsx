// нижняя панель: список проблем и просмотр сгенерированных .ink/manifest файлов
import { useState } from "react";
import { ChevronDown, ChevronUp } from "lucide-react";
import { useStore } from "../store";
import { IconButton } from "../ui";

type BottomTab = "problems" | "ink" | "globals" | "main" | "manifest";

export function BottomPanel({ splitter, open, onToggle }: { splitter?: React.ReactNode; open: boolean; onToggle: (open?: boolean) => void }) {
  const [tab, setTab] = useState<BottomTab>("problems");
  const check = useStore((s) => s.check);
  const project = useStore((s) => s.project)!;
  const key = useStore((s) => s.activeCanvas);
  const focusCard = useStore.getState().focusCard;
  const diags = check?.diagnostics ?? [];
  const errors = diags.filter((d) => d.severity === "error").length;
  const file =
    tab === "ink"
      ? key
        ? check?.build.canvases[key]?.text
        : ""
      : tab === "globals"
        ? check?.build.files.get("globals.ink")
        : tab === "main"
          ? check?.build.files.get("main.ink")
          : check?.build.files.get("manifest.json");
  const sorted = [...diags].sort((a, b) => (a.severity === b.severity ? 0 : a.severity === "error" ? -1 : 1));
  const show = (t: BottomTab) => {
    setTab(t);
    onToggle(true);
  };

  return (
    <section className={`dock ${open ? "" : "closed"}`}>
      {open && splitter}
      <div className="tabs">
        <button className={tab === "problems" ? "on" : ""} onClick={() => show("problems")}>
          Проблемы {errors > 0 && <span className="err-count">{errors}</span>}
          {diags.length - errors > 0 && <span className="warn-count">{diags.length - errors}</span>}
        </button>
        <button className={tab === "ink" ? "on" : ""} onClick={() => show("ink")}>ink файла</button>
        <button className={tab === "globals" ? "on" : ""} onClick={() => show("globals")}>globals.ink</button>
        <button className={tab === "main" ? "on" : ""} onClick={() => show("main")}>main.ink</button>
        <button className={tab === "manifest" ? "on" : ""} onClick={() => show("manifest")}>manifest.json</button>
        <span className="spacer" />
        <span className={errors ? "bad" : "good"}>{check ? (errors ? "ink не собирается" : check.storyJson ? "ink компилируется ✓" : "") : "проверка…"}</span>
        <IconButton icon={open ? ChevronDown : ChevronUp} className="tip-left tip-up" label={open ? "Скрыть нижнюю панель (Ctrl+\\)" : "Показать нижнюю панель"} onClick={() => onToggle()} />
      </div>
      {open && (
        <div className="dock-body">
          {tab === "problems" ? (
            <ul className="problems">
              {sorted.map((d, i) => (
                <li
                  key={i}
                  className={d.severity}
                  onClick={() => {
                    if (d.func) useStore.getState().inspectVariable("func", d.func, d.funcOwner);
                    else if (d.canvas && d.link) useStore.getState().focusLink(d.canvas, d.link);
                    else if (d.canvas) focusCard(d.canvas, d.card);
                  }}
                >
                  <span className="sev">{d.severity === "error" ? "ошибка" : "внимание"}</span>
                  {d.func && <span className="muted mono">функция {d.func}</span>}
                  {d.canvas && (
                    <span className="muted">
                      {project.canvases[d.canvas]?.title ?? d.canvas}
                      {d.card ? ` · ${d.card}` : ""}
                    </span>
                  )}
                  <span>{d.message}</span>
                </li>
              ))}
              {!sorted.length && <li className="muted">Проблем нет</li>}
            </ul>
          ) : (
            <pre className="ink-view">{file ?? ""}</pre>
          )}
        </div>
      )}
    </section>
  );
}
