import { useEffect, useRef, useState } from "react";
import type { CSSProperties } from "react";
import { CircleHelp, FilePlus, FolderOpen, Monitor, Moon, PanelLeft, PanelRight, Redo2, Save, Settings as SettingsIcon, Sun, Undo2, X } from "lucide-react";
import { useStore as useZustand } from "zustand";
import { CanvasView, isTyping } from "./CanvasView";
import { BottomPanel, Library, Properties } from "./Panels";
import { recentProjects, redo, reopenLastProject, undo, useStore } from "./store";
import { askUser, inTauri } from "./tauriFs";
import { getCurrentWindow } from "@tauri-apps/api/window";
import { fsAccessSupported } from "./browserFs";
import type { AutosaveSec } from "./prefs";
import { AUTOSAVE_LABEL, AUTOSAVE_OPTIONS, FONT_MAX, FONT_MIN, usePrefs } from "./prefs";
import type { ThemeMode } from "./theme";
import { useTheme } from "./theme";
import type { PanelSizes } from "./ui";
import { IconButton, Splitter, usePanelSizes } from "./ui";

const THEME_NEXT: Record<ThemeMode, ThemeMode> = { system: "light", light: "dark", dark: "system" };
const THEME_LABEL: Record<ThemeMode, string> = { system: "системная", light: "светлая", dark: "тёмная" };
const THEME_ICON = { system: Monitor, light: Sun, dark: Moon };
import { demoProject } from "../../checker/test/fixtures";

type Panels = ReturnType<typeof usePanelSizes>;

const isError = (text: string) => /^(Ошибка|Не удалось)/.test(text);

/** Сообщение в тулбаре: обычное гаснет через 3 с, ошибка висит до щелчка или следующего сообщения. */
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
  return (
    <span
      className={`status ${shown ? "" : "faded"} ${isError(text) ? "bad" : ""}`}
      title={isError(text) ? "Щёлкните, чтобы скрыть" : text}
      onClick={() => setShown(false)}
    >
      {text}
    </span>
  );
}

function Toolbar({ panels, onAbout, onSettings }: { panels: Panels; onAbout: () => void; onSettings: () => void }) {
  const project = useStore((s) => s.project);
  const dirty = useStore((s) => s.dirty);
  const status = useStore((s) => s.status);
  const { openProject, save } = useStore.getState();
  const canUndo = useZustand(useStore.temporal, (s) => s.pastStates.length > 0);
  const canRedo = useZustand(useStore.temporal, (s) => s.futureStates.length > 0);
  const theme = useTheme((s) => s.mode);
  const autosave = usePrefs((s) => s.autosaveSec);
  return (
    <header className="toolbar">
      {project && (
        <>
          {/* на стартовом экране эти кнопки уже есть по центру */}
          <IconButton icon={FilePlus} label="Новый проект… (выбрать пустую папку)" onClick={() => openProject(true)} />
          <IconButton icon={FolderOpen} label="Открыть проект…" onClick={() => openProject(false)} />
          <IconButton
            icon={Save}
            primary
            badge={dirty}
            label={`Сохранить и собрать ink (Ctrl+S)${dirty ? " — есть несохранённые правки" : ""}; автосохранение: ${AUTOSAVE_LABEL[autosave]}`}
            onClick={() => save()}
          />
          <span className="toolbar-sep" />
          <IconButton icon={Undo2} label="Отменить (Ctrl+Z)" onClick={undo} disabled={!canUndo} />
          <IconButton icon={Redo2} label="Вернуть (Ctrl+Shift+Z)" onClick={redo} disabled={!canRedo} />
          <span className="project-name">{project.settings.name}</span>
        </>
      )}
      <Status text={status} />
      {project && (
        <>
          <IconButton
            icon={PanelLeft}
            className={`toggle ${panels.sizes.showLeft ? "on" : ""}`}
            label={`${panels.sizes.showLeft ? "Скрыть" : "Показать"} левую панель (Ctrl+[)`}
            onClick={() => panels.toggle("showLeft")}
          />
          <IconButton
            icon={PanelRight}
            className={`toggle tip-left ${panels.sizes.showRight ? "on" : ""}`}
            label={`${panels.sizes.showRight ? "Скрыть" : "Показать"} правую панель (Ctrl+])`}
            onClick={() => panels.toggle("showRight")}
          />
        </>
      )}
      <IconButton icon={SettingsIcon} label="Настройки" className="tip-left" onClick={onSettings} />
      <IconButton icon={CircleHelp} label="О программе и горячие клавиши" className="tip-left" onClick={onAbout} />
      <IconButton
        icon={THEME_ICON[theme]}
        label={`Тема: ${THEME_LABEL[theme]} — щёлкните, чтобы сменить`}
        onClick={() => useTheme.getState().setMode(THEME_NEXT[theme])}
        className="tip-left"
      />
    </header>
  );
}

/** Знак Visink — тот же, что у иконки приложения. */
function Logo({ size = 72 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 100 100" aria-hidden="true">
      <rect x="2" y="2" width="96" height="96" rx="22" fill="var(--accent)" />
      <rect x="24" y="32" width="31" height="17" rx="3" fill="#fff" />
      <path d="M55 40.5 H67 V55" stroke="#fff" strokeWidth="2.4" fill="none" />
      <rect x="58" y="55" width="18" height="14" rx="3" fill="#fff" opacity=".92" />
    </svg>
  );
}

function Welcome({ onAbout }: { onAbout: () => void }) {
  const recent = inTauri ? recentProjects() : [];
  const { openProject } = useStore.getState();
  return (
    <div className="welcome">
      <Logo />
      <h1>Visink</h1>
      {!fsAccessSupported && !inTauri && <p className="bad">Этот браузер не умеет работать с папками. Откройте Visink в Chrome или Edge.</p>}
      <div className="welcome-actions">
        <button className="primary" onClick={() => openProject(true)}>
          <FilePlus size={16} /> Создать проект
        </button>
        <button onClick={() => openProject(false)}>
          <FolderOpen size={16} /> Открыть проект
        </button>
      </div>
      {recent.length > 0 && (
        <ul className="recent">
          {recent.map((path) => (
            <li key={path} onClick={() => openProject(false, path)} title={path}>
              <span>{path.split(/[\\/]/).filter(Boolean).pop()}</span>
              <span className="muted ellipsis">{path}</span>
            </li>
          ))}
        </ul>
      )}
      <button className="link" onClick={onAbout}>О программе</button>
    </div>
  );
}

/** Настройки этого компьютера: шрифт карточек, сетка, автосохранение. */
function Settings({ onClose }: { onClose: () => void }) {
  const { cardFontSize, snap, autosaveSec, set } = usePrefs();
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);
  return (
    <div className="modal-backdrop" onMouseDown={onClose}>
      <div className="modal settings" onMouseDown={(e) => e.stopPropagation()}>
        <div className="modal-head">
          <div>
            <h2>Настройки</h2>
            <div className="muted">Хранятся на этом компьютере, в проект не попадают.</div>
          </div>
          <IconButton icon={X} label="Закрыть (Esc)" className="tip-left" onClick={onClose} />
        </div>
        <h3>Размер шрифта в карточках</h3>
        <div className="row">
          <input type="range" min={FONT_MIN} max={FONT_MAX} step={1} value={cardFontSize} onChange={(e) => set({ cardFontSize: Number(e.target.value) })} />
          <span className="mono">{cardFontSize}px</span>
          {cardFontSize !== 12 && (
            <button className="link" onClick={() => set({ cardFontSize: 12 })}>
              как было
            </button>
          )}
        </div>
        <h3>Холст</h3>
        <label className="check">
          <input type="checkbox" checked={snap} onChange={(e) => set({ snap: e.target.checked })} />
          Привязывать карточки к сетке (перемещение и размер); тот же переключатель — магнит на холсте
        </label>
        <h3>Автосохранение</h3>
        <div className="row">
          <select value={autosaveSec} onChange={(e) => set({ autosaveSec: Number(e.target.value) as AutosaveSec })}>
            {AUTOSAVE_OPTIONS.map((sec) => (
              <option key={sec} value={sec}>
                {AUTOSAVE_LABEL[sec]}
              </option>
            ))}
          </select>
        </div>
        <p className="muted">
          Сохраняет проект и собирает ink через заданное время после правки. Пишутся только изменившиеся файлы: перемещение карточки трогает лишь
          файл холста, а .ink — только если поменялся сам текст или порядок вариантов. При ошибках в проекте ink не пересобирается.
        </p>
      </div>
    </div>
  );
}

function About({ onClose }: { onClose: () => void }) {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);
  return (
    <div className="modal-backdrop" onMouseDown={onClose}>
      <div className="modal" onMouseDown={(e) => e.stopPropagation()}>
        <div className="modal-head">
          <Logo size={36} />
          <div>
            <h2>Visink</h2>
            <div className="muted">Визуальный редактор диалогов: карточки на холсте → обычные .ink-файлы для движка.</div>
          </div>
          <IconButton icon={X} label="Закрыть (Esc)" className="tip-left" onClick={onClose} />
        </div>
        <h3>Как игра запускает диалог</h3>
        <p>
          Каждый файл — отдельный диалог. Игра вызывает <span className="mono">ChoosePathString("dean")</span> — диалог идёт с карточки-начала
          (флажок в шапке). Дополнительная точка входа в свойствах карточки — чтобы начать не с начала:{" "}
          <span className="mono">dean.entry_second_meeting</span>. Функции «Реализует игра» привязываются в движке через{" "}
          <span className="mono">BindExternalFunction</span>, их список — в <span className="mono">manifest.json</span>.
        </p>
        <h3>Горячие клавиши</h3>
        <table className="keys">
          <tbody>
            <tr><td>Двойной щелчок по пустому месту</td><td>новая реплика</td></tr>
            <tr><td>Стрелка из карточки в пустоту</td><td>меню: что вставить</td></tr>
            <tr><td>Правый щелчок по пустому месту / по карточке</td><td>меню холста / действия с карточкой</td></tr>
            <tr><td>Щелчок по стрелке</td><td>условие и действие стрелки</td></tr>
            <tr><td>Протянуть по пустому месту</td><td>выделить рамкой</td></tr>
            <tr><td>Cmd/Ctrl + протянуть, два пальца</td><td>двигать холст</td></tr>
            <tr><td>Shift+1</td><td>показать всё</td></tr>
            <tr><td>Enter / Tab</td><td>следующая реплика / ещё один вариант игрока — сразу с курсором в тексте</td></tr>
            <tr><td>Щелчок по тексту карточки</td><td>править на месте (Enter — готово, Shift+Enter — перенос)</td></tr>
            <tr><td>Цветная шапка карточки</td><td>перетащить; несколько выделенных — за любое место</td></tr>
            <tr><td>Ctrl+C / Ctrl+X / Ctrl+V</td><td>копировать / вырезать / вставить карточки (под курсор)</td></tr>
            <tr><td>Угол выделенной карточки</td><td>изменить размер</td></tr>
            <tr><td>Ctrl+1…9</td><td>сменить спикера</td></tr>
            <tr><td>Ctrl+Space в условии</td><td>подсказки: переменные, функции, списки</td></tr>
            <tr><td>Ctrl+[ / Ctrl+] / Ctrl+\\</td><td>скрыть левую / правую / все панели</td></tr>
            <tr><td>Ctrl+Z / Ctrl+Shift+Z</td><td>отменить / вернуть</td></tr>
            <tr><td>Ctrl+S</td><td>сохранить и собрать ink</td></tr>
          </tbody>
        </table>
        <div className="row">
          <button
            onClick={() => {
              onClose();
              useStore.getState().openInMemory(demoProject());
            }}
          >
            Открыть демо-проект
          </button>
          <span className="muted">в памяти, без сохранения</span>
        </div>
      </div>
    </div>
  );
}

export function App() {
  const project = useStore((s) => s.project);
  const dirty = useStore((s) => s.dirty);
  const panels = usePanelSizes();
  const [about, setAbout] = useState(false);
  const [settings, setSettings] = useState(false);

  // приложение: последний проект при запуске, заголовок окна, вопрос перед закрытием с несохранённым
  useEffect(() => {
    void reopenLastProject();
  }, []);
  useEffect(() => {
    if (!inTauri) return;
    void getCurrentWindow().setTitle(project ? `${project.settings.name}${dirty ? " •" : ""} — Visink` : "Visink");
  }, [project?.settings.name, dirty]);
  useEffect(() => {
    if (!inTauri) return;
    const unlisten = getCurrentWindow().onCloseRequested(async (e) => {
      const { dirty, fs, save } = useStore.getState();
      if (!dirty) return;
      // с автосохранением — молча дописать и закрыть
      if (usePrefs.getState().autosaveSec && fs) {
        e.preventDefault();
        await save({ auto: true });
        if (!useStore.getState().dirty || (await askUser("Сохранить не удалось. Закрыть без сохранения?"))) await getCurrentWindow().destroy();
        return;
      }
      if (!(await askUser("Есть несохранённые правки. Закрыть без сохранения?"))) e.preventDefault();
    });
    return () => {
      void unlisten.then((f) => f());
    };
  }, []);
  const { sizes, resize, reset, toggle } = panels;
  // размеры на момент начала перетаскивания границы
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
      // Ctrl+[ / Ctrl+] / Ctrl+\ — панели; по коду клавиши, чтобы работало в русской раскладке
      if (e.code === "BracketLeft" || e.code === "BracketRight" || e.code === "Backslash") {
        e.preventDefault();
        if (e.code === "BracketLeft") toggle("showLeft");
        else if (e.code === "BracketRight") toggle("showRight");
        else {
          const { showLeft, showRight, showDock } = panelsRef.current;
          const anyOpen = showLeft || showRight || showDock;
          toggle("showLeft", !anyOpen);
          toggle("showRight", !anyOpen);
          toggle("showDock", !anyOpen);
        }
      } else if (k === "s" || k === "ы") {
        e.preventDefault();
        useStore.getState().save();
      } else if ((k === "z" || k === "я") && !isTyping()) {
        e.preventDefault();
        if (e.shiftKey) redo();
        else undo();
      } else if ((k === "y" || k === "н") && !isTyping()) {
        e.preventDefault();
        redo();
      }
    };
    const onUnload = (e: BeforeUnloadEvent) => {
      if (useStore.getState().dirty) e.preventDefault();
    };
    window.addEventListener("keydown", onKey);
    window.addEventListener("beforeunload", onUnload);
    return () => {
      window.removeEventListener("keydown", onKey);
      window.removeEventListener("beforeunload", onUnload);
    };
  }, [toggle]);

  const columns = [sizes.showLeft && "var(--left)", sizes.showLeft && "auto", "minmax(0, 1fr)", sizes.showRight && "auto", sizes.showRight && "var(--right)"]
    .filter(Boolean)
    .join(" ");

  return (
    <div className="app">
      <Toolbar panels={panels} onAbout={() => setAbout(true)} onSettings={() => setSettings(true)} />
      {about && <About onClose={() => setAbout(false)} />}
      {settings && <Settings onClose={() => setSettings(false)} />}
      {project ? (
        <div
          className="workspace"
          style={{ "--left": `${sizes.left}px`, "--right": `${sizes.right}px`, "--dock": `${sizes.dock}px`, gridTemplateColumns: columns } as CSSProperties}
        >
          {sizes.showLeft && (
            <>
              <Library />
              <Splitter direction="col" onDrag={drag((o, d) => ({ left: o.left + d }))} onReset={() => reset("left")} />
            </>
          )}
          <main className="center">
            <CanvasView />
            <BottomPanel
              open={sizes.showDock}
              onToggle={(open) => toggle("showDock", open)}
              splitter={<Splitter direction="row" onDrag={drag((o, d) => ({ dock: o.dock - d }))} onReset={() => reset("dock")} />}
            />
          </main>
          {sizes.showRight && (
            <>
              <Splitter direction="col" onDrag={drag((o, d) => ({ right: o.right - d }))} onReset={() => reset("right")} />
              <Properties />
            </>
          )}
        </div>
      ) : (
        <Welcome onAbout={() => setAbout(true)} />
      )}
    </div>
  );
}
