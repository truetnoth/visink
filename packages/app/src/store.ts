import { create } from "zustand";
import { temporal } from "zundo";
import type { Canvas, FlowPath, Project, ProjectFs } from "@visink/core";
import { canvasAtPath, createProject, flowCards, loadProject, saveProject, writeBuild } from "@visink/core";
import type { CheckResult } from "@visink/checker";
import { checkProject } from "@visink/checker";
import { BrowserFs, pickDirectory } from "./browserFs";
import { TauriFs, askUser, inTauri, pickTauriDirectory } from "./tauriFs";
import { usePrefs } from "./prefs";

/** Папка на диске: в браузере — File System Access, в приложении — команды Rust. */
export type FolderFs = ProjectFs & { readonly name: string };

const LAST_PROJECT = "visink-last-project";
const RECENT = "visink-recent";
const buildDirKey = (root: string) => `visink-build-dir:${root}`;

function remember(key: string, value: string | null) {
  try {
    if (value) localStorage.setItem(key, value);
    else localStorage.removeItem(key);
  } catch {
    // не запомним — откроют вручную
  }
}

function recall(key: string): string | null {
  try {
    return localStorage.getItem(key);
  } catch {
    return null;
  }
}

/** Выбор папки: в приложении — системный диалог, в браузере — showDirectoryPicker. */
async function pickFolder(id: string, title: string): Promise<FolderFs | null> {
  if (inTauri) {
    const path = await pickTauriDirectory(title);
    return path ? new TauriFs(path) : null;
  }
  const handle = await pickDirectory(id);
  return handle ? new BrowserFs(handle) : null;
}

interface State {
  project: Project | null;
  fs: FolderFs | null;
  /** внешняя папка сборки (например, в проекте Godot); иначе — project.settings.buildDir внутри проекта */
  buildFs: FolderFs | null;
  activeCanvas: string | null;
  flowPath: FlowPath;
  view: "canvas" | "logic" | "characters" | "testing";
  editorOpen: boolean;
  selection: string[];
  /** выделенная стрелка: id ребра "from>to>port" */
  selectedLink: string | null;
  selectedLinks: string[];
  selectedEntity: string | null;
  /** переменная или список, открытые на экране логики */
  inspect: { kind: "var" | "list" | "func"; name: string; owner?: string } | null;
  check: CheckResult | null;
  dirty: boolean;
  status: string;
  /** меняется с каждым сообщением — чтобы одинаковый текст тоже показался заново */
  statusNonce: number;
  focus: { canvas: string; card: string; nonce: number } | null;
  /** новую карточку сразу открыть на ввод текста */
  editRequest: { card: string; nonce: number } | null;

  edit: (fn: (p: Project) => void) => void;
  editCanvas: (fn: (c: Canvas, p: Project) => void) => void;
  setActiveCanvas: (key: string | null, path?: FlowPath) => void;
  setView: (view: State["view"]) => void;
  openEditor: () => void;
  closeEditor: () => void;
  setSelection: (ids: string[], link?: string | null, links?: string[]) => void;
  selectEntity: (id: string | null) => void;
  inspectVariable: (kind: "var" | "list" | "func", name: string | null, owner?: string) => void;
  /** щелчок по пустому холсту — закрыть контекстный редактор */
  clearInspector: () => void;
  /** открыть файл и выделить стрелку */
  focusLink: (canvas: string, link: { from: string; to: string; port?: string }) => void;
  focusCard: (canvas: string, card?: string) => void;
  /**
   * picked — уже выбранная папка: handle (автотесты через OPFS) или путь (приложение, последний проект);
   * иначе спросит у пользователя.
   */
  openProject: (create: boolean, picked?: FileSystemDirectoryHandle | string) => Promise<void>;
  /** Проект без папки: для демо и проверки, сохранить нельзя. */
  openInMemory: (project: Project) => void;
  /** auto — автосохранение: короткое сообщение в строке состояния */
  save: (opts?: { auto?: boolean }) => Promise<void>;
  requestEdit: (card: string) => void;
  pickBuildDir: () => Promise<void>;
}

let loading = false;
/** идёт запись на диск — второе сохранение подождёт следующего раза */
let saving = false;
/** Отложенная запись шага отмены — сбрасывается перед undo/redo. */
let flushHistory: (() => void) | null = null;

export const useStore = create<State>()(
  temporal(
    (set, get) => ({
      project: null,
      fs: null,
      buildFs: null,
      activeCanvas: null,
      flowPath: [],
      view: "canvas",
      editorOpen: false,
      selection: [],
      selectedLink: null, selectedLinks: [],
      selectedEntity: null,
      inspect: null,
      check: null,
      dirty: false,
      status: "",
      statusNonce: 0,
      focus: null,
      editRequest: null,

      edit(fn) {
        const project = get().project;
        if (!project) return;
        const draft = structuredClone(project);
        fn(draft);
        set({ project: draft });
      },

      editCanvas(fn) {
        const { activeCanvas: key, flowPath } = get();
        if (!key) return;
        get().edit((p) => {
          const root = p.canvases[key];
          const canvas = root && canvasAtPath(root, flowPath);
          if (canvas) fn(canvas, p);
        });
      },

      setActiveCanvas: (key, flowPath = []) => set({ activeCanvas: key, flowPath, view: "canvas", editorOpen: false, selection: [], selectedLink: null, selectedLinks: [], selectedEntity: null, inspect: null }),
      setView: (view) => set({ view, editorOpen: false }),
      openEditor: () => set({ editorOpen: true }),
      closeEditor: () => set({ editorOpen: false }),
      setSelection: (ids, link = null, links = link ? [link] : []) => {
        const state = get();
        const cur = state.selection;
        const sameLinks = state.selectedLinks.length === links.length && state.selectedLinks.every((id, i) => id === links[i]);
        if (cur.length === ids.length && cur.every((id, i) => id === ids[i]) && state.selectedLink === link && sameLinks) return;
        const picked = ids.length > 0 || links.length > 0;
        set({
          selection: ids,
          selectedLink: link,
          selectedLinks: links,
          selectedEntity: picked ? null : state.selectedEntity,
          inspect: picked ? null : state.inspect,
        });
      },
      selectEntity: (id) => set({ selectedEntity: id, view: "characters", editorOpen: false, inspect: null, selection: [], selectedLink: null, selectedLinks: [] }),
      clearInspector: () => set({ editorOpen: false, selectedLink: null, selectedLinks: [] }),
      inspectVariable: (kind, name, owner) => set({ inspect: name ? { kind, name, owner } : null, view: owner ? "characters" : "logic", selectedEntity: owner ?? get().selectedEntity, editorOpen: false, selection: [], selectedLink: null, selectedLinks: [] }),
      focusLink: (canvas, link) => {
        const root = get().project?.canvases[canvas];
        const flowPath = root ? flowCards(root).find((x) => x.card.id === link.from)?.path ?? [] : [];
        const id = `${link.from}>${link.to}>${link.port ?? ""}`;
        set({
          activeCanvas: canvas,
          flowPath,
          view: "canvas",
          editorOpen: false,
          selection: [],
          selectedLink: id,
          selectedLinks: [id],
          inspect: null,
          focus: { canvas, card: link.from, nonce: Date.now() },
        });
      },
      focusCard: (canvas, card) => {
        const root = get().project?.canvases[canvas];
        const flowPath = root && card ? flowCards(root).find((x) => x.card.id === card)?.path ?? [] : [];
        set({
          activeCanvas: canvas,
          flowPath,
          view: "canvas",
          editorOpen: false,
          selection: card ? [card] : [],
          selectedLink: null, selectedLinks: [],
          inspect: null,
          focus: card ? { canvas, card, nonce: Date.now() } : null,
        });
      },

      async openProject(createNew, picked) {
        try {
          const fs: FolderFs | null =
            typeof picked === "string"
              ? new TauriFs(picked)
              : picked
                ? new BrowserFs(picked)
                : await pickFolder("visink-project", createNew ? "Пустая папка для нового проекта" : "Папка проекта Visink");
          if (!fs) return;
          let project: Project;
          if ((await fs.readText("project.json")) == null) {
            if (typeof picked === "string") return; // запомненный проект пропал — просто стартовый экран
            const ok = createNew || (await askUser(`В папке «${fs.name}» нет проекта Visink. Создать новый проект здесь?`));
            if (!ok) return;
            project = createProject(fs.name.replace(/\.visink$/, ""));
            await saveProject(fs, project);
          } else {
            if (createNew && !(await askUser(`В папке «${fs.name}» уже есть проект. Открыть его?`))) return;
            project = await loadProject(fs);
          }
          let buildFs: FolderFs | null = null;
          if (fs instanceof TauriFs) {
            remember(LAST_PROJECT, fs.root);
            remember(RECENT, JSON.stringify([fs.root, ...recentProjects().filter((p) => p !== fs.root)].slice(0, 5)));
            const build = recall(buildDirKey(fs.root));
            if (build) buildFs = new TauriFs(build);
          }
          loading = true;
          set({
            project,
            fs,
            buildFs,
            activeCanvas: Object.keys(project.canvases).sort()[0] ?? null,
            flowPath: [],
            view: "canvas",
            editorOpen: false,
            selection: [],
            selectedLink: null, selectedLinks: [],
            inspect: null,
            selectedEntity: null,
            dirty: false,
            statusNonce: Date.now(), status: `Открыт проект «${project.settings.name}»`,
          });
          loading = false;
          flushHistory = null;
          useStore.temporal.getState().clear();
          runCheck();
        } catch (e) {
          loading = false;
          set({ statusNonce: Date.now(), status: `Не удалось открыть: ${(e as Error).message}` });
        }
      },

      openInMemory(project) {
        loading = true;
        set({
          project,
          fs: null,
          buildFs: null,
          activeCanvas: Object.keys(project.canvases).sort()[0] ?? null,
          flowPath: [],
          view: "canvas",
          editorOpen: false,
          selection: [],
          selectedLink: null, selectedLinks: [],
          inspect: null,
          selectedEntity: null,
          dirty: false,
          statusNonce: Date.now(), status: "Проект в памяти — чтобы сохранять, откройте папку проекта",
        });
        loading = false;
        flushHistory = null;
        useStore.temporal.getState().clear();
        runCheck();
      },

      requestEdit: (card) => set({ editRequest: { card, nonce: Date.now() } }),

      async save({ auto = false } = {}) {
        const { fs, project, buildFs } = get();
        if (!project || saving) return;
        if (!fs) {
          if (auto) return;
          runCheck();
          set({ statusNonce: Date.now(), status: "Проект в памяти: проверено, но сохранять некуда — откройте или создайте папку проекта" });
          return;
        }
        saving = true;
        try {
          const written = await saveProject(fs, project);
          const check = checkProject(project);
          const errors = check.diagnostics.filter((d) => d.severity === "error").length;
          let buildMsg: string;
          if (errors) {
            buildMsg = `сборка не записана — ошибок: ${errors}`;
          } else {
            const target = buildFs ?? fs;
            const dir = buildFs ? "" : project.settings.buildDir;
            const changed = await writeBuild(target, dir, check.build.files);
            buildMsg = `сборка → ${buildFs ? buildFs.name : dir} (изменено файлов: ${changed.length})`;
          }
          // правки, пришедшие во время записи, остаются несохранёнными
          const dirty = get().project !== project;
          const time = new Date().toLocaleTimeString("ru", { hour: "2-digit", minute: "2-digit" });
          set({
            check: dirty ? get().check : check,
            dirty,
            statusNonce: Date.now(),
            status: auto ? `Автосохранено в ${time}${errors ? `, ${buildMsg}` : ""}` : `Сохранено (файлов проекта: ${written.length}), ${buildMsg}`,
          });
        } catch (e) {
          set({ statusNonce: Date.now(), status: `Ошибка ${auto ? "автосохранения" : "сохранения"}: ${(e as Error).message}` });
        } finally {
          saving = false;
        }
      },

      async pickBuildDir() {
        try {
          const buildFs = await pickFolder("visink-build", "Куда собирать ink (например, папка в проекте Godot)");
          if (!buildFs) return;
          const { fs } = get();
          if (buildFs instanceof TauriFs && fs instanceof TauriFs) remember(buildDirKey(fs.root), buildFs.root);
          set({ buildFs, statusNonce: Date.now(), status: `Папка сборки: ${buildFs.name}${buildFs instanceof TauriFs ? "" : " (до перезагрузки страницы)"}` });
        } catch (e) {
          set({ statusNonce: Date.now(), status: (e as Error).message });
        }
      },
    }),
    {
      partialize: (s) => ({ project: s.project }),
      equality: (a, b) => a.project === b.project,
      limit: 200,
      // Склеиваем быстрые правки (набор текста) в один шаг отмены.
      handleSet: (handleSet) => {
        let pending: unknown;
        let timer: ReturnType<typeof setTimeout> | undefined;
        return (pastState, replace) => {
          if (pending === undefined) pending = pastState;
          clearTimeout(timer);
          const flush = () => {
            clearTimeout(timer);
            flushHistory = null;
            if (pending === undefined) return;
            (handleSet as (s: unknown, r?: unknown) => void)(pending, replace);
            pending = undefined;
          };
          flushHistory = flush;
          timer = setTimeout(flush, 300);
        };
      },
    },
  ),
);

let checkTimer: ReturnType<typeof setTimeout> | undefined;

function runCheck() {
  const project = useStore.getState().project;
  if (!project) return;
  try {
    useStore.setState({ check: checkProject(project) });
  } catch (e) {
    console.error(e);
  }
}

useStore.subscribe((s, prev) => {
  if (s.project === prev.project || !s.project) return;
  if (!loading && !s.dirty) useStore.setState({ dirty: true });
  // после отмены активный файл или вложенный слой может исчезнуть
  if (s.activeCanvas && !s.project.canvases[s.activeCanvas]) {
    useStore.setState({ activeCanvas: Object.keys(s.project.canvases).sort()[0] ?? null, flowPath: [], selection: [], selectedLink: null, selectedLinks: [], editorOpen: false });
  } else if (s.activeCanvas && !canvasAtPath(s.project.canvases[s.activeCanvas], s.flowPath)) {
    useStore.setState({ flowPath: [], selection: [], selectedLink: null, selectedLinks: [], editorOpen: false });
  }
  clearTimeout(checkTimer);
  checkTimer = setTimeout(runCheck, 300);
});

// Автосохранение: после первой правки — запись через заданный интервал, не чаще.
let autosaveTimer: ReturnType<typeof setTimeout> | undefined;

function scheduleAutosave() {
  const sec = usePrefs.getState().autosaveSec;
  const { dirty, fs } = useStore.getState();
  if (!sec || !dirty || !fs) {
    clearTimeout(autosaveTimer);
    autosaveTimer = undefined;
    return;
  }
  if (autosaveTimer) return;
  autosaveTimer = setTimeout(async () => {
    autosaveTimer = undefined;
    await useStore.getState().save({ auto: true });
    // не успели записать (шла другая запись) или правили во время записи — следующий круг
    scheduleAutosave();
  }, sec * 1000);
}

useStore.subscribe((s, prev) => {
  if (s.dirty !== prev.dirty || s.fs !== prev.fs) scheduleAutosave();
});
usePrefs.subscribe((s, prev) => {
  if (s.autosaveSec === prev.autosaveSec) return;
  clearTimeout(autosaveTimer);
  autosaveTimer = undefined;
  scheduleAutosave();
});

export function undo() {
  flushHistory?.();
  useStore.temporal.getState().undo();
}

export function redo() {
  flushHistory?.();
  useStore.temporal.getState().redo();
}

/** Приложение: при запуске открыть последний проект. */
export async function reopenLastProject() {
  if (!inTauri) return;
  const last = recall(LAST_PROJECT);
  if (last) await useStore.getState().openProject(false, last);
}

/** Недавние проекты приложения — пути, последний первым. */
export function recentProjects(): string[] {
  try {
    const list = JSON.parse(recall(RECENT) ?? "[]");
    return Array.isArray(list) ? list.filter((x): x is string => typeof x === "string") : [];
  } catch {
    return [];
  }
}
