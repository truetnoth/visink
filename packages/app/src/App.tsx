import { useEffect, useRef, useState } from "react";
import type { CSSProperties } from "react";
import { ChevronRight, CircleHelp, FilePlus, FolderOpen, GitBranch, Monitor, Moon, PanelLeft, Play, Redo2, Save, Settings as SettingsIcon, Sun, Undo2, Users, Variable, X } from "lucide-react";
import { useStore as useZustand } from "zustand";
import { canvasAtPath } from "@visink/core";
import { CanvasView, isTyping, TYPE_LABEL } from "./CanvasView";
import { BottomPanel, Library, Properties } from "./Panels";
import { CharactersScreen, LogicScreen, TestingScreen } from "./Screens";
import { recentProjects, redo, reopenLastProject, undo, useStore } from "./store";
import { askUser, inTauri } from "./tauriFs";
import { getCurrentWindow } from "@tauri-apps/api/window";
import { fsAccessSupported } from "./browserFs";
import type { AutosaveSec } from "./prefs";
import { AUTOSAVE_LABEL, AUTOSAVE_OPTIONS, FONT_MAX, FONT_MIN, usePrefs } from "./prefs";
import type { ThemeMode } from "./theme";
import { useTheme } from "./theme";
import type { PanelSizes } from "./ui";
import { IconButton, Select, Splitter, usePanelSizes } from "./ui";

const THEME_NEXT: Record<ThemeMode, ThemeMode> = { system: "light", light: "dark", dark: "system" };
const THEME_LABEL: Record<ThemeMode, string> = { system: "системная", light: "светлая", dark: "тёмная" };
const THEME_ICON = { system: Monitor, light: Sun, dark: Moon };
import { demoProject } from "../../checker/test/fixtures";

type Panels = ReturnType<typeof usePanelSizes>;
const isError = (text: string) => /^(Ошибка|Не удалось)/.test(text);

function Status({ text }: { text: string }) {
  const [shown, setShown] = useState(false);
  const nonce = useStore((s) => s.statusNonce);
  useEffect(() => {
    if (!text) return;
    setShown(true);
    if (isError(text)) return;
    const t = setTimeout(() => setShown(false), 3000);
    return () => clearTimeout(t);
  }, [text, nonce]);
  return <span className={`status ${shown ? "" : "faded"} ${isError(text) ? "bad" : ""}`} title={isError(text) ? "Щёлкните, чтобы скрыть" : text} onClick={() => setShown(false)}>{text}</span>;
}

const VIEWS = [
  { id: "canvas", label: "Канвас", icon: GitBranch },
  { id: "logic", label: "Логика", icon: Variable },
  { id: "characters", label: "Персонажи", icon: Users },
  { id: "testing", label: "Тестирование", icon: Play },
] as const;

function ViewSwitcher() {
  const view = useStore((s) => s.view);
  const project = useStore((s) => s.project);
  const key = useStore((s) => s.activeCanvas);
  const flowPath = useStore((s) => s.flowPath);
  const root = project && key ? project.canvases[key] : null;
  return <nav className="view-switcher" aria-label="Режим работы">
    {VIEWS.map(({ id, label, icon: Icon }) => <button key={id} className={view === id ? "on" : ""} onClick={() => useStore.getState().setView(id)}><Icon size={15} />{label}</button>)}
    {view === "canvas" && root && <div className="flow-breadcrumbs" aria-label="Путь по вложенностям">
      <button className={!flowPath.length ? "on" : ""} onClick={() => key && useStore.getState().setActiveCanvas(key)}>{root.title}</button>
      {flowPath.map((id, i) => {
        const parent = canvasAtPath(root, flowPath.slice(0, i));
        const card = parent?.cards.find((c) => c.id === id);
        return <span key={`${id}:${i}`}><ChevronRight size={12} /><button className={i === flowPath.length - 1 ? "on" : ""} onClick={() => key && useStore.getState().setActiveCanvas(key, flowPath.slice(0, i + 1))}>{card?.text || card?.condition || TYPE_LABEL[card?.type ?? "hub"]}</button></span>;
      })}
    </div>}
  </nav>;
}

function Toolbar({ panels, onAbout, onSettings }: { panels: Panels; onAbout: () => void; onSettings: () => void }) {
  const project = useStore((s) => s.project);
  const dirty = useStore((s) => s.dirty);
  const status = useStore((s) => s.status);
  const { openProject, save } = useStore.getState();
  const canUndo = useZustand(useStore.temporal, (s) => s.pastStates.length > 0);
  const canRedo = useZustand(useStore.temporal, (s) => s.futureStates.length > 0);
  const theme = useTheme((s) => s.mode);
  return (
    <header className="toolbar">
      {project && <>
        <IconButton icon={FilePlus} label="Новый проект" onClick={() => openProject(true)} />
        <IconButton icon={FolderOpen} label="Открыть проект…" onClick={() => openProject(false)} />
        <IconButton icon={Save} primary badge={dirty} label="Сохранить" onClick={() => save()} />
        <span className="toolbar-sep" />
        <IconButton icon={Undo2} label="Отменить (Ctrl+Z)" onClick={undo} disabled={!canUndo} />
        <IconButton icon={Redo2} label="Вернуть (Ctrl+Shift+Z)" onClick={redo} disabled={!canRedo} />
        <span className="project-name">{project.settings.name}</span>
      </>}
      <Status text={status} />
      {project && <IconButton icon={PanelLeft} className={`toggle ${panels.sizes.showLeft ? "on" : ""}`} label={`${panels.sizes.showLeft ? "Скрыть" : "Показать"} дерево проекта (Ctrl+[)`} onClick={() => panels.toggle("showLeft")} />}
      <IconButton icon={SettingsIcon} label="Настройки" onClick={onSettings} />
      <IconButton icon={CircleHelp} label="О программе и горячие клавиши" onClick={onAbout} />
      <IconButton icon={THEME_ICON[theme]} label={`Тема: ${THEME_LABEL[theme]}`} onClick={() => useTheme.getState().setMode(THEME_NEXT[theme])} />
    </header>
  );
}

function Logo({ size = 72 }: { size?: number }) {
  return <svg width={size} height={size} viewBox="0 0 100 100" aria-hidden="true"><rect x="2" y="2" width="96" height="96" rx="22" fill="var(--accent)" /><rect x="24" y="32" width="31" height="17" rx="3" fill="#fff" /><path d="M55 40.5 H67 V55" stroke="#fff" strokeWidth="2.4" fill="none" /><rect x="58" y="55" width="18" height="14" rx="3" fill="#fff" opacity=".92" /></svg>;
}

function Welcome({ onAbout }: { onAbout: () => void }) {
  const recent = inTauri ? recentProjects() : [];
  const { openProject } = useStore.getState();
  return <div className="welcome"><Logo /><h1>Visink</h1>{!fsAccessSupported && !inTauri && <p className="bad">Этот браузер не умеет работать с папками. Откройте Visink в Chrome или Edge.</p>}<div className="welcome-actions"><button className="primary" onClick={() => openProject(true)}><FilePlus size={16} /> Создать проект</button><button onClick={() => openProject(false)}><FolderOpen size={16} /> Открыть проект</button></div>{recent.length > 0 && <ul className="recent">{recent.map((path) => <li key={path} onClick={() => openProject(false, path)} title={path}><span>{path.split(/[\\/]/).filter(Boolean).pop()}</span><span className="muted ellipsis">{path}</span></li>)}</ul>}<button className="link" onClick={onAbout}>О программе</button></div>;
}

function Settings({ onClose }: { onClose: () => void }) {
  const { cardFontSize, snap, autosaveSec, set } = usePrefs();
  return <div className="modal-backdrop" onMouseDown={onClose}><div className="modal settings" onMouseDown={(e) => e.stopPropagation()}><div className="modal-head"><div><h2>Настройки</h2><div className="muted">Хранятся на этом компьютере, в проект не попадают.</div></div><IconButton icon={X} label="Закрыть (Esc)" onClick={onClose} /></div>
    <h3>Размер шрифта в карточках</h3><div className="row"><input type="range" min={FONT_MIN} max={FONT_MAX} step={1} value={cardFontSize} onChange={(e) => set({ cardFontSize: Number(e.target.value) })} /><span className="mono">{cardFontSize}px</span>{cardFontSize !== 12 && <button className="link" onClick={() => set({ cardFontSize: 12 })}>как было</button>}</div>
    <h3>Холст</h3><label className="check"><input type="checkbox" checked={snap} onChange={(e) => set({ snap: e.target.checked })} />Привязывать карточки к сетке</label>
    <h3>Автосохранение</h3><Select value={String(autosaveSec)} options={AUTOSAVE_OPTIONS.map((sec) => ({ value: String(sec), label: AUTOSAVE_LABEL[sec] }))} onChange={(value) => set({ autosaveSec: Number(value) as AutosaveSec })} />
    <p className="muted">Сохраняет проект и собирает ink через заданное время после правки. Пишутся только изменившиеся файлы. При ошибках в проекте ink не пересобирается.</p>
  </div></div>;
}

function About({ onClose }: { onClose: () => void }) {
  return <div className="modal-backdrop" onMouseDown={onClose}><div className="modal" onMouseDown={(e) => e.stopPropagation()}><div className="modal-head"><Logo size={36} /><div><h2>Visink</h2><div className="muted">Визуальный редактор диалогов: карточки на холсте → обычные .ink-файлы для движка.</div></div><IconButton icon={X} label="Закрыть (Esc)" onClick={onClose} /></div>
    <h3>Как игра запускает диалог</h3><p>Каждый файл — отдельный диалог. Игра вызывает <span className="mono">ChoosePathString("dean")</span> — диалог идёт с карточки-начала. Дополнительная точка входа задаётся в свойствах карточки. Функции «Реализует игра» привязываются через <span className="mono">BindExternalFunction</span>.</p>
    <h3>Горячие клавиши</h3><table className="keys"><tbody>
      <tr><td>Двойной щелчок по пустому месту</td><td>новая реплика</td></tr>
      <tr><td>Двойной щелчок по карточке</td><td>вложенный поток или свойства</td></tr>
      <tr><td>Двойной щелчок по пину</td><td>условие или действие</td></tr>
      <tr><td>Щелчок по пину, затем 1–4</td><td>связи-заготовки</td></tr>
      <tr><td>Стрелка из карточки в пустоту</td><td>меню: что вставить</td></tr>
      <tr><td>Протянуть по пустому месту</td><td>выделить рамкой</td></tr>
      <tr><td>Cmd/Ctrl + протянуть, два пальца</td><td>двигать холст</td></tr>
      <tr><td>Shift+1</td><td>показать всё</td></tr>
      <tr><td>Enter / Tab</td><td>следующая реплика / вариант игрока</td></tr>
      <tr><td>Щелчок по тексту карточки</td><td>править на месте</td></tr>
      <tr><td>Ctrl+C / Ctrl+X / Ctrl+V</td><td>копировать / вырезать / вставить</td></tr>
      <tr><td>Ctrl+1…9</td><td>сменить спикера</td></tr>
      <tr><td>Ctrl+Space в условии</td><td>подсказки</td></tr>
      <tr><td>Ctrl+[ / Ctrl+\</td><td>дерево / нижняя панель и дерево</td></tr>
      <tr><td>Ctrl+Z / Ctrl+Shift+Z</td><td>отменить / вернуть</td></tr>
      <tr><td>Ctrl+S</td><td>сохранить и собрать ink</td></tr>
    </tbody></table>
    <div className="row"><button onClick={() => { onClose(); useStore.getState().openInMemory(demoProject()); }}>Открыть демо-проект</button><span className="muted">в памяти, без сохранения</span></div>
  </div></div>;
}

export function App() {
  const project = useStore((s) => s.project);
  const dirty = useStore((s) => s.dirty);
  const view = useStore((s) => s.view);
  const editorOpen = useStore((s) => s.editorOpen);
  const panels = usePanelSizes();
  const [about, setAbout] = useState(false);
  const [settings, setSettings] = useState(false);

  useEffect(() => { void reopenLastProject(); }, []);
  useEffect(() => {
    if (!inTauri) return;
    void getCurrentWindow().setTitle(project ? `${project.settings.name}${dirty ? " •" : ""} — Visink` : "Visink");
  }, [project?.settings.name, dirty]);
  useEffect(() => {
    if (!inTauri) return;
    const unlisten = getCurrentWindow().onCloseRequested(async (e) => {
      const { dirty, fs, save } = useStore.getState();
      if (!dirty) return;
      if (usePrefs.getState().autosaveSec && fs) {
        e.preventDefault();
        await save({ auto: true });
        if (!useStore.getState().dirty || (await askUser("Сохранить не удалось. Закрыть без сохранения?"))) await getCurrentWindow().destroy();
        return;
      }
      if (!(await askUser("Есть несохранённые правки. Закрыть без сохранения?"))) e.preventDefault();
    });
    return () => { void unlisten.then((f) => f()); };
  }, []);

  const { sizes, resize, reset, toggle } = panels;
  const current = useRef(sizes);
  const origin = useRef(sizes);
  current.current = sizes;
  const panelsRef = useRef(sizes);
  panelsRef.current = sizes;
  const drag = (apply: (o: PanelSizes, delta: number) => Partial<PanelSizes>) => (delta: number, start: boolean) => {
    if (start) origin.current = current.current;
    resize(apply(origin.current, delta));
  };

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const mod = e.ctrlKey || e.metaKey;
      if (!mod) return;
      const k = e.key.toLowerCase();
      if (e.code === "BracketLeft" || e.code === "Backslash") {
        e.preventDefault();
        if (e.code === "BracketLeft") toggle("showLeft");
        else {
          const { showLeft, showDock } = panelsRef.current;
          const anyOpen = showLeft || showDock;
          toggle("showLeft", !anyOpen);
          toggle("showDock", !anyOpen);
        }
      } else if (k === "s" || k === "ы") {
        e.preventDefault();
        useStore.getState().save();
      } else if ((k === "z" || k === "я") && !isTyping()) {
        e.preventDefault();
        if (e.shiftKey) redo(); else undo();
      } else if ((k === "y" || k === "н") && !isTyping()) {
        e.preventDefault();
        redo();
      }
    };
    const onEscape = (e: KeyboardEvent) => {
      if (e.key !== "Escape" || document.querySelector(".popup")) return;
      if (about) { setAbout(false); e.preventDefault(); e.stopImmediatePropagation(); return; }
      if (settings) { setSettings(false); e.preventDefault(); e.stopImmediatePropagation(); return; }
      if (useStore.getState().editorOpen) { useStore.getState().closeEditor(); e.preventDefault(); e.stopImmediatePropagation(); return; }
      if (!isTyping()) { e.preventDefault(); useStore.getState().clearInspector(); }
    };
    const onUnload = (e: BeforeUnloadEvent) => { if (useStore.getState().dirty) e.preventDefault(); };
    window.addEventListener("keydown", onKey);
    window.addEventListener("keydown", onEscape, true);
    window.addEventListener("beforeunload", onUnload);
    return () => {
      window.removeEventListener("keydown", onKey);
      window.removeEventListener("keydown", onEscape, true);
      window.removeEventListener("beforeunload", onUnload);
    };
  }, [toggle, about, settings]);

  const columns = [sizes.showLeft && "var(--left)", sizes.showLeft && "auto", "minmax(0, 1fr)"].filter(Boolean).join(" ");
  return <div className="app">
    <Toolbar panels={panels} onAbout={() => setAbout(true)} onSettings={() => setSettings(true)} />
    {about && <About onClose={() => setAbout(false)} />}
    {settings && <Settings onClose={() => setSettings(false)} />}
    {project ? <>
      {editorOpen && <div className="modal-backdrop editor-backdrop" onMouseDown={() => useStore.getState().closeEditor()}><div className="modal editor-modal" onMouseDown={(e) => e.stopPropagation()}><div className="editor-close"><IconButton icon={X} label="Закрыть (Esc)" onClick={() => useStore.getState().closeEditor()} /></div><Properties /></div></div>}
      <div className="workspace" style={{ "--left": `${sizes.left}px`, "--dock": `${sizes.dock}px`, gridTemplateColumns: columns } as CSSProperties}>
        {sizes.showLeft && <><Library /><Splitter direction="col" onDrag={drag((o, d) => ({ left: o.left + d }))} onReset={() => reset("left")} /></>}
        <main className="center">
          <ViewSwitcher />
          <div className="canvas-screen" style={{ display: view === "canvas" ? "flex" : "none" }} aria-hidden={view !== "canvas"}>
            <CanvasView />
          </div>
          {view === "logic" && <LogicScreen />}
          {view === "characters" && <CharactersScreen />}
          {view === "testing" && <TestingScreen />}
          {view === "canvas" && <BottomPanel open={sizes.showDock} onToggle={(open) => toggle("showDock", open)} splitter={<Splitter direction="row" onDrag={drag((o, d) => ({ dock: o.dock - d }))} onReset={() => reset("dock")} />} />}
        </main>
      </div>
    </> : <Welcome onAbout={() => setAbout(true)} />}
  </div>;
}
