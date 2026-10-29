import { create } from "zustand";
import { temporal } from "zundo";
import type { Canvas, Project, ProjectFs } from "@visink/core";
import { createProject, loadProject, saveProject, writeBuild } from "@visink/core";
import type { CheckResult } from "@visink/checker";
import { checkProject } from "@visink/checker";
import { BrowserFs, pickDirectory } from "./browserFs";
import { TauriFs, askUser, inTauri, pickTauriDirectory } from "./tauriFs";

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
  selection: string[];
  /** выделенная стрелка: id ребра "from>to>port" */
  selectedLink: string | null;
  selectedEntity: string | null;
  /** переменная или список, открытые в панели свойств */
  inspect: { kind: "var" | "list" | "func"; name: string } | null;
  check: CheckResult | null;
  dirty: boolean;
  status: string;
  /** меняется с каждым сообщением — чтобы одинаковый текст тоже показался заново */
  statusNonce: number;
  focus: { canvas: string; card: string; nonce: number } | null;

  edit: (fn: (p: Project) => void) => void;
  editCanvas: (fn: (c: Canvas, p: Project) => void) => void;
  setActiveCanvas: (key: string | null) => void;
  setSelection: (ids: string[], link?: string | null) => void;
  selectEntity: (id: string | null) => void;
  inspectVariable: (kind: "var" | "list" | "func", name: string | null) => void;
  /** щелчок по пустому холсту — убрать из панели свойств переменную, персонажа, стрелку */
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
  save: () => Promise<void>;
  pickBuildDir: () => Promise<void>;
}

let loading = false;
/** Отложенная запись шага отмены — сбрасывается перед undo/redo. */
let flushHistory: (() => void) | null = null;

export const useStore = create<State>()(
  temporal(
    (set, get) => ({
      project: null,
      fs: null,
      buildFs: null,
      activeCanvas: null,
      selection: [],
      selectedLink: null,
      selectedEntity: null,
      inspect: null,
      check: null,
      dirty: false,
      status: "",
      statusNonce: 0,
      focus: null,

      edit(fn) {
        const project = get().project;
        if (!project) return;
        const draft = structuredClone(project);
        fn(draft);
        set({ project: draft });
      },

      editCanvas(fn) {
        const key = get().activeCanvas;
        if (!key) return;
        get().edit((p) => {
          const canvas = p.canvases[key];
          if (canvas) fn(canvas, p);
        });
      },

      setActiveCanvas: (key) => set({ activeCanvas: key, selection: [], selectedLink: null, selectedEntity: null, inspect: null }),
      setSelection: (ids, link = null) => {
        const cur = get().selection;
        if (cur.length === ids.length && cur.every((id, i) => id === ids[i]) && get().selectedLink === link) return;
        const picked = ids.length > 0 || !!link;
        set({
          selection: ids,
          selectedLink: link,
          selectedEntity: picked ? null : get().selectedEntity,
          inspect: picked ? null : get().inspect,
        });
      },
      selectEntity: (id) => set({ selectedEntity: id, inspect: null, selection: [], selectedLink: null }),
      clearInspector: () => {
        const s = get();
        if (s.inspect || s.selectedEntity || s.selectedLink) set({ inspect: null, selectedEntity: null, selectedLink: null });
      },
      inspectVariable: (kind, name) => set({ inspect: name ? { kind, name } : null, selectedEntity: null, selection: [], selectedLink: null }),
      focusLink: (canvas, link) =>
        set({
          activeCanvas: canvas,
          selection: [],
          selectedLink: `${link.from}>${link.to}>${link.port ?? ""}`,
          selectedEntity: null,
          inspect: null,
          focus: { canvas, card: link.from, nonce: Date.now() },
        }),
      focusCard: (canvas, card) =>
        set({
          activeCanvas: canvas,
          selection: card ? [card] : [],
          selectedLink: null,
          inspect: null,
          selectedEntity: null,
          focus: card ? { canvas, card, nonce: Date.now() } : null,
        }),

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
            selection: [],
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
          selection: [],
          selectedEntity: null,
          dirty: false,
          statusNonce: Date.now(), status: "Проект в памяти — чтобы сохранять, откройте папку проекта",
        });
        loading = false;
        flushHistory = null;
        useStore.temporal.getState().clear();
        runCheck();
      },

      async save() {
        const { fs, project, buildFs } = get();
        if (!project) return;
        if (!fs) {
          runCheck();
          set({ statusNonce: Date.now(), status: "Проект в памяти: проверено, но сохранять некуда — откройте или создайте папку проекта" });
          return;
        }
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
          set({ check, dirty: false, statusNonce: Date.now(), status: `Сохранено (файлов проекта: ${written.length}), ${buildMsg}` });
        } catch (e) {
          set({ statusNonce: Date.now(), status: `Ошибка сохранения: ${(e as Error).message}` });
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
  // после отмены переименования холста активный ключ может пропасть
  if (s.activeCanvas && !s.project.canvases[s.activeCanvas]) {
    useStore.setState({ activeCanvas: Object.keys(s.project.canvases).sort()[0] ?? null, selection: [] });
  }
  clearTimeout(checkTimer);
  checkTimer = setTimeout(runCheck, 300);
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
