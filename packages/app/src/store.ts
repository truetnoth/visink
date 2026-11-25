import type { CardControlField } from "./canvas/CardControl";
import { migrateFolders } from "@visink/core";
import { create } from "zustand";
import { produce } from "immer";
import { temporal } from "zundo";
import type { Canvas, FlowPath, Project, ProjectFs } from "@visink/core";
import { canvasAtPath, createProject, flowCards, linkId, loadProject, saveProject, writeBuild, prepareProject, canvasLocations } from "@visink/core";
import type { CheckResult } from "@visink/checker";
import { checkInBackground } from "./checkClient";
import { BrowserFs, pickDirectory } from "./browserFs";
import { TauriFs, askUser, inTauri, pickTauriDirectory } from "./tauriFs";
import { usePrefs } from "./prefs";
import { endTreeDrag, syncTreeDragProject } from "./treeDrag";
import { currentCanvasViewport, type CanvasViewport } from "./navigation";

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
  projectSession: number;
  fs: FolderFs | null;
  /** внешняя папка сборки (например, в проекте Godot); иначе — project.settings.buildDir внутри проекта */
  buildFs: FolderFs | null;
  activeCanvas: string | null;
  flowPath: FlowPath;
  view: "canvas" | "logic" | "characters" | "testing" | "stats";
  editorOpen: boolean;
  selection: string[];
  /** выделенная стрелка: id ребра "from>to>port" */
  selectedLink: string | null;
  selectedLinks: string[];
  selectedEntity: string | null;
  logicOwner: string | null;
  selectLogicScope: (owner: string | null) => void;
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
  pinRequest: { card: string; field: "condition" | "action"; nonce: number } | null;
  navBackCount: number;
  navForwardCount: number;
  viewportRequest: { flowKey: string; viewport: CanvasViewport; nonce: number } | null;

  edit: (fn: (p: Project) => void) => void;
  editCanvas: (fn: (c: Canvas, p: Project) => void) => void;
  setActiveCanvas: (key: string | null, path?: FlowPath) => void;
  setView: (view: State["view"]) => void;
  openEditor: () => void;
  closeEditor: () => void;
  /** настройки карточки: одиночная становится выделением, группа сохраняется */
  cardControl: { card: string; field: CardControlField; nonce: number } | null;
  openCardControl: (id: string, field: CardControlField) => void;
  setSelection: (ids: string[], link?: string | null, links?: string[]) => void;
  selectEntity: (id: string | null) => void;
  inspectVariable: (kind: "var" | "list" | "func", name: string | null, owner?: string) => void;
  /** щелчок по пустому холсту — закрыть контекстный редактор */
  clearInspector: () => void;
  /** открыть файл и выделить стрелку */
  focusLink: (canvas: string, link: { from: string; to: string; port?: string }) => void;
  focusCard: (canvas: string, card?: string) => void;
  navigateBack: () => void;
  navigateForward: () => void;
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

type NavigationEntry = Pick<State, "view" | "activeCanvas" | "flowPath" | "selection" | "selectedLink" | "selectedLinks" | "selectedEntity" | "logicOwner" | "inspect"> & { viewport?: CanvasViewport };
let navigationPast: NavigationEntry[] = [];
let navigationFuture: NavigationEntry[] = [];

function navigationSnapshot(state: State): NavigationEntry {
  return {
    view: state.view,
    activeCanvas: state.activeCanvas,
    flowPath: [...state.flowPath],
    selection: [...state.selection],
    selectedLink: state.selectedLink,
    selectedLinks: [...state.selectedLinks],
    selectedEntity: state.selectedEntity,
    logicOwner: state.logicOwner,
    inspect: state.inspect ? { ...state.inspect } : null,
    ...(state.view === "canvas" ? { viewport: currentCanvasViewport() } : {}),
  };
}

function sameNavigation(a: NavigationEntry, b: NavigationEntry) {
  return a.view === b.view && a.activeCanvas === b.activeCanvas && a.selectedLink === b.selectedLink && a.selectedEntity === b.selectedEntity && a.logicOwner === b.logicOwner
    && a.flowPath.join("/") === b.flowPath.join("/") && a.selection.join("\0") === b.selection.join("\0") && a.selectedLinks.join("\0") === b.selectedLinks.join("\0")
    && a.inspect?.kind === b.inspect?.kind && a.inspect?.name === b.inspect?.name && a.inspect?.owner === b.inspect?.owner;
}

function syncNavigationCounts() {
  useStore.setState({ navBackCount: navigationPast.length, navForwardCount: navigationFuture.length });
}

function navigateTo(get: () => State, next: Partial<State>) {
  const current = navigationSnapshot(get());
  const candidate: NavigationEntry = { ...current, ...next };
  if (sameNavigation(current, candidate)) {
    useStore.setState({ ...next, viewportRequest: null });
    return;
  }
  navigationPast.push(current);
  if (navigationPast.length > 100) navigationPast.shift();
  navigationFuture = [];
  syncNavigationCounts();
  useStore.setState({ ...next, viewportRequest: null });
}

function validNavigation(project: Project, entry: NavigationEntry): NavigationEntry | null {
  if (entry.selectedEntity && !project.entities.some((entity) => entity.id === entry.selectedEntity)) return null;
  if (entry.logicOwner && !project.variables.sets?.some((set) => set.id === entry.logicOwner)) return null;
  if (entry.activeCanvas && !project.canvases[entry.activeCanvas]) return null;
  const canvas = entry.activeCanvas ? canvasAtPath(project.canvases[entry.activeCanvas], entry.flowPath) : undefined;
  if (entry.activeCanvas && !canvas) return null;
  const selection = canvas ? entry.selection.filter((id) => canvas.cards.some((card) => card.id === id) || canvas.notes.some((note) => note.id === id)) : [];
  const selectedLinks = canvas ? entry.selectedLinks.filter((id) => canvas.links.some((link) => linkId(link) === id)) : [];
  let inspect = entry.inspect ? { ...entry.inspect } : null;
  if (inspect) {
    const collection = inspect.kind === "var" ? project.variables.vars : inspect.kind === "list" ? project.variables.lists : project.variables.functions;
    if (!collection.some((item) => item.name === inspect!.name && item.owner === inspect!.owner)) inspect = null;
  }
  return { ...entry, selection, selectedLinks, selectedLink: entry.selectedLink && selectedLinks.includes(entry.selectedLink) ? entry.selectedLink : null, inspect };
}

function restoreNavigation(get: () => State, direction: "back" | "forward") {
  const project = get().project;
  if (!project) return;
  const source = direction === "back" ? navigationPast : navigationFuture;
  let target: NavigationEntry | null = null;
  while (source.length && !target) {
    const candidate = source.pop()!;
    target = validNavigation(project, candidate);
  }
  if (!target) {
    syncNavigationCounts();
    return;
  }
  const current = navigationSnapshot(get());
  (direction === "back" ? navigationFuture : navigationPast).push(current);
  const viewportRequest = target.view === "canvas" && target.activeCanvas && target.viewport
    ? { flowKey: `${target.activeCanvas}:${target.flowPath.join("/")}`, viewport: target.viewport, nonce: Date.now() }
    : null;
  const { viewport: _viewport, ...location } = target;
  useStore.setState({
    ...location,
    editorOpen: false,
    cardControl: null,
    focus: null,
    viewportRequest,
  });
  syncNavigationCounts();
}

function resetNavigation() {
  navigationPast = [];
  navigationFuture = [];
  useStore.setState({ navBackCount: 0, navForwardCount: 0, viewportRequest: null });
}

export const useStore = create<State>()(
  temporal(
    (set, get) => ({
      project: null,
      projectSession: 0,
      fs: null,
      buildFs: null,
      activeCanvas: null,
      flowPath: [],
      view: "canvas",
      editorOpen: false,
      selection: [],
      selectedLink: null, selectedLinks: [],
      selectedEntity: null,
      logicOwner: null,
      inspect: null,
      check: null,
      dirty: false,
      status: "",
      statusNonce: 0,
      focus: null,
      editRequest: null,
      pinRequest: null,
      cardControl: null,
      navBackCount: 0,
      navForwardCount: 0,
      viewportRequest: null,

      edit(fn) {
        const project = get().project;
        if (!project) return;
        // фигурные скобки обязательны: immer бросает ошибку, если рецепт что-то вернёт
        const next = produce(project, (draft) => { fn(draft); });
        syncTreeDragProject(next);
        set({ project: next });
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

      setActiveCanvas: (key, flowPath = []) => navigateTo(get, { activeCanvas: key, flowPath, view: "canvas", editorOpen: false, cardControl: null, selection: [], selectedLink: null, selectedLinks: [], selectedEntity: null, inspect: null }),
      setView: (view) => navigateTo(get, { view, editorOpen: false, cardControl: null }),
      openEditor: () => {
        const s = get();
        const c = s.project && s.activeCanvas ? canvasAtPath(s.project.canvases[s.activeCanvas], s.flowPath) : null;
        if (s.inspect || s.selection.some((id) => c?.cards.some((card) => card.id === id) || c?.notes.some((note) => note.id === id))) return;
        set({ editorOpen: true, cardControl: null });
      },
      closeEditor: () => set({ editorOpen: false }),
      openCardControl(id, field) {
        const { selection, setSelection } = get();
        if (!(selection.length > 1 && selection.includes(id))) setSelection([id]);
        set({ cardControl: { card: id, field, nonce: Date.now() }, editorOpen: false });
      },
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
      selectEntity: (id) => navigateTo(get, { selectedEntity: id, view: "characters", editorOpen: false, cardControl: null, inspect: null, selection: [], selectedLink: null, selectedLinks: [] }),
      clearInspector: () => set({ cardControl: null, editorOpen: false, selectedLink: null, selectedLinks: [] }),
      selectLogicScope: (owner) => navigateTo(get, { logicOwner: owner, view: "logic", selectedEntity: null, inspect: null, editorOpen: false, cardControl: null, selection: [], selectedLink: null, selectedLinks: [] }),
      inspectVariable: (kind, name, owner) => {
        const entity = get().project?.entities.some((e) => e.id === owner);
        navigateTo(get, { inspect: name ? { kind, name, owner } : null, view: entity ? "characters" : "logic", logicOwner: entity ? null : owner ?? null, selectedEntity: entity ? owner! : null, editorOpen: false, cardControl: null, selection: [], selectedLink: null, selectedLinks: [] });
      },
      focusLink: (canvas, link) => {
        const project = get().project;
        const location = project && canvasLocations(project).find((x) => (x.canvas.id === canvas || x.canvas.legacyId === canvas) && x.canvas.cards.some((card) => card.id === link.from));
        if (!project || !location) return;
        const id = linkId(link);
        navigateTo(get, {
          activeCanvas: "main",
          flowPath: location.path,
          view: "canvas",
          editorOpen: false,
          cardControl: null,
          selection: [],
          selectedLink: id,
          selectedLinks: [id],
          inspect: null,
          selectedEntity: null,
          focus: { canvas: "main", card: link.from, nonce: Date.now() },
        });
      },
      focusCard: (canvas, card) => {
        const project = get().project;
        if (!project) return;
        const locations = canvasLocations(project);
        const location = card
          ? locations.find((x) => (x.canvas.id === canvas || x.canvas.legacyId === canvas) && x.canvas.cards.some((item) => item.id === card))
          : locations.find((x) => x.canvas.id === canvas || x.canvas.legacyId === canvas && x.canvas.id === x.canvas.legacyId);
        if (!location) return;
        navigateTo(get, {
          activeCanvas: "main",
          flowPath: location.path,
          view: "canvas",
          editorOpen: false,
          cardControl: null,
          selection: card ? [card] : [],
          selectedLink: null, selectedLinks: [],
          inspect: null,
          selectedEntity: null,
          focus: card ? { canvas: "main", card, nonce: Date.now() } : null,
        });
      },
      navigateBack: () => restoreNavigation(get, "back"),
      navigateForward: () => restoreNavigation(get, "forward"),

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
          endTreeDrag();
          set({
            project,
            projectSession: get().projectSession + 1,
            fs,
            buildFs,
            activeCanvas: project.canvases.main ? "main" : Object.keys(project.canvases).sort()[0] ?? null,
            flowPath: [],
            view: "canvas",
            editorOpen: false,
          cardControl: null,
            selection: [],
            selectedLink: null, selectedLinks: [],
            inspect: null,
            selectedEntity: null,
            logicOwner: null,
            dirty: false,
            statusNonce: Date.now(), status: `Открыт проект «${project.settings.name}»`,
          });
          loading = false;
          flushHistory?.();
          useStore.temporal.getState().clear();
          resetNavigation();
          void runCheck();
        } catch (e) {
          loading = false;
          set({ statusNonce: Date.now(), status: `Не удалось открыть: ${(e as Error).message}` });
        }
      },

      openInMemory(project) {
        project = prepareProject(structuredClone(project));
        migrateFolders(project);
        loading = true;
        endTreeDrag();
        set({
          project,
          projectSession: get().projectSession + 1,
          fs: null,
          buildFs: null,
          activeCanvas: project.canvases.main ? "main" : Object.keys(project.canvases).sort()[0] ?? null,
          flowPath: [],
          view: "canvas",
          editorOpen: false,
          cardControl: null,
          selection: [],
          selectedLink: null, selectedLinks: [],
          inspect: null,
          selectedEntity: null,
          logicOwner: null,
          dirty: false,
          statusNonce: Date.now(), status: "Проект в памяти — чтобы сохранять, откройте папку проекта",
        });
        loading = false;
        flushHistory?.();
        useStore.temporal.getState().clear();
        resetNavigation();
        void runCheck();
      },

      requestEdit: (card) => set({ editRequest: { card, nonce: Date.now() } }),

      async save({ auto = false } = {}) {
        const { fs, project, buildFs } = get();
        if (!project || saving) return;
        if (!fs) {
          if (auto) return;
          void runCheck();
          set({ statusNonce: Date.now(), status: "Проект в памяти: проверено, но сохранять некуда — откройте или создайте папку проекта" });
          return;
        }
        saving = true;
        try {
          const written = await saveProject(fs, project);
          const check = await checkInBackground(project);
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

async function runCheck() {
  const project = useStore.getState().project;
  if (!project) return;
  try {
    const check = await checkInBackground(project);
    // пока шла проверка, проект поменяли — придёт следующий результат
    if (useStore.getState().project === project) useStore.setState({ check });
  } catch (e) {
    console.error(e);
  }
}

useStore.subscribe((s, prev) => {
  if (s.project === prev.project || !s.project) return;
  if (!loading && !s.dirty) useStore.setState({ dirty: true });
  // после отмены активный файл или вложенный слой может исчезнуть
      if (s.activeCanvas && !s.project.canvases[s.activeCanvas]) {
    useStore.setState({ activeCanvas: s.project.canvases.main ? "main" : Object.keys(s.project.canvases).sort()[0] ?? null, flowPath: [], selection: [], selectedLink: null, selectedLinks: [], editorOpen: false });
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
  const project = useStore.getState().project;
  if (project) syncTreeDragProject(project);
  else endTreeDrag();
}

export function redo() {
  flushHistory?.();
  useStore.temporal.getState().redo();
  const project = useStore.getState().project;
  if (project) syncTreeDragProject(project);
  else endTreeDrag();
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

/** One structural operation is always a separate undo step. */
export function editAtomic(fn: (project: Project) => void) {
  flushHistory?.();
  useStore.getState().edit(fn);
  flushHistory?.();
}
