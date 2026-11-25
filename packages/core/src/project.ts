import type { ProjectFs } from "./fs";
import { stableStringify } from "./json";
import type { Canvas, Card, CardType, Entity, Link, Project, Variables } from "./model";

import { migrateFolders } from "./folders";

const CANVAS_SUFFIX = ".canvas.json";

export function createProject(name: string): Project {
  const main = createCanvas("main", name);
  ensureCanvasBoundaries(main);
  return {
    settings: { name, buildDir: "build/narrative", languages: ["ru"], start: "main", formatVersion: 4 },
    entities: [
      { id: "ent_player", kind: "character", name: "Игрок", inkName: "ИГРОК", color: "#3b82f6", isPlayer: true },
      { id: "ent_narrator", kind: "character", name: "Рассказчик", inkName: "", color: "#6b7280" },
    ],
    variables: { vars: [], lists: [], functions: [] },
    canvases: { main },
  };
}

export function createCanvas(id: string, title: string): Canvas {
  return { id, title, entries: [], cards: [], links: [], layout: {}, groups: [], notes: [], graveyard: [] };
}

function unusedCardId(canvas: Canvas, base: string): string {
  const used = new Set([...canvas.cards.map((c) => c.id), ...canvas.graveyard]);
  if (!used.has(base)) return base;
  for (let n = 2; ; n++) if (!used.has(`${base}_${n}`)) return `${base}_${n}`;
}

export function isBoundaryCard(card: Card): boolean {
  return card.type === "entry" || card.type === "exit";
}

/** Добавляет неизменяемые границы холста и переводит прежние свободные концы на «Выход». */
export function ensureCanvasBoundaries(canvas: Canvas): Canvas {
  if (canvas.cards.some((c) => c.type === "entry") && canvas.cards.some((c) => c.type === "exit")) return canvas;
  const ordinary = canvas.cards.filter((c) => !isBoundaryCard(c));
  const previousStart = ordinary.find((c) => c.id === canvas.start) ?? guessStart({ ...canvas, cards: ordinary });
  let entry = canvas.cards.find((c) => c.type === "entry");
  if (!entry) {
    entry = { id: unusedCardId(canvas, "__entry"), type: "entry" };
    canvas.cards.unshift(entry);
  }
  let exit = canvas.cards.find((c) => c.type === "exit");
  if (!exit) {
    exit = { id: unusedCardId(canvas, "__exit"), type: "exit" };
    canvas.cards.push(exit);
  }
  canvas.links = canvas.links.filter((l) => l.from !== exit.id && l.to !== entry.id);
  if (!canvas.links.some((l) => l.from === entry.id)) {
    canvas.links.push({ from: entry.id, to: previousStart?.id ?? exit.id, order: 0, kind: "divert", ...(previousStart ? { direct: true } : {}) });
  }
  for (const card of ordinary) {
    if (card.type === "jump" || canvas.links.some((l) => l.from === card.id)) continue;
    canvas.links.push({ from: card.id, to: exit.id, order: 0, kind: "divert" });
  }
  const positions = ordinary.map((c) => canvas.layout[c.id]).filter(Boolean);
  const minX = Math.min(0, ...positions.map((p) => p.x));
  const maxX = Math.max(0, ...positions.map((p) => p.x + (p.w ?? 280)));
  const y = previousStart ? canvas.layout[previousStart.id]?.y ?? 0 : 0;
  canvas.layout[entry.id] ??= { x: minX - 220, y };
  canvas.layout[exit.id] ??= { x: maxX + 220, y };
  return canvas;
}

/** Путь файла холста без расширения: холсты лежат плоско, имя файла = id. */
export function canvasPath(canvas: Pick<Canvas, "id">): string {
  return canvas.id;
}

export function createCard(id: string, type: CardType, init: Partial<Card> = {}): Card {
  const card: Card = { id, type, ...init };
  if (type === "line") {
    card.text ??= "";
    card.repeat ??= "once";
    card.status ??= "draft";
  }
  if (type === "ink") card.text ??= "";
  if (type === "flow") {
    card.text ??= "Новая вложенность";
    card.flow ??= ensureCanvasBoundaries(createCanvas(`flow_${id}`, card.text));
  }
  return card;
}

export function playerEntity(project: Project): Entity | undefined {
  return project.entities.find((e) => e.isPlayer);
}

export function isPlayerCard(project: Pick<Project, "entities">, card: Card): boolean {
  if (card.type !== "line" || !card.speaker) return false;
  return project.entities.some((e) => e.id === card.speaker && e.isPlayer);
}

/**
 * Карточка, которую разумно считать началом файла, если оно не задано явно:
 * первая точка входа по имени, иначе самая верхняя-левая карточка без входящих стрелок.
 */
export function guessStart(canvas: Pick<Canvas, "cards" | "links" | "layout">): Card | undefined {
  const entries = canvas.cards.filter((c) => c.entry).sort((a, b) => a.entry!.localeCompare(b.entry!) || a.id.localeCompare(b.id));
  if (entries.length) return entries[0];
  const incoming = new Set(canvas.links.map((l) => l.to));
  const pos = (c: Card) => canvas.layout[c.id] ?? { x: 0, y: 0 };
  const byPos = (a: Card, b: Card) => pos(a).y - pos(b).y || pos(a).x - pos(b).x || a.id.localeCompare(b.id);
  const free = canvas.cards.filter((c) => !incoming.has(c.id)).sort(byPos);
  return free[0] ?? [...canvas.cards].sort(byPos)[0];
}

/** Точки входа выводятся из поля entry карточек — поле entries всегда синхронно с холстом. */
export function syncEntries(canvas: Canvas): Canvas {
  const entries = canvas.cards
    .filter((c) => c.entry)
    .map((c) => ({ name: c.entry!, card: c.id }))
    .sort((a, b) => a.name.localeCompare(b.name));
  return { ...canvas, entries };
}

/** Карточка в формате до 29.10: были типы start (точка входа) и end (конец). */
type LegacyCard = Omit<Card, "type"> & { type: CardType | "start" | "end"; name?: string; endKind?: "done" | "end" | "return" };

/**
 * Старые проекты: карточка start отдаёт имя входа своей единственной цели (иначе становится хабом-входом),
 * end «конец диалога» исчезает — ветка без стрелок и так заканчивается DONE, END и ->-> становятся карточками ink.
 */
function migrateCards(cards: LegacyCard[], links: Link[], graveyard: string[]): { cards: Card[]; links: Link[] } {
  let out = [...cards];
  let outLinks = [...links];
  const drop = (id: string) => {
    out = out.filter((c) => c.id !== id);
    outLinks = outLinks.filter((l) => l.from !== id && l.to !== id);
    if (!graveyard.includes(id)) graveyard.push(id);
  };
  for (const card of cards) {
    if (card.type === "start") {
      const name = card.name || "start";
      const next = outLinks.filter((l) => l.from === card.id);
      const target = next.length === 1 ? out.find((c) => c.id === next[0].to) : undefined;
      if (target && !target.entry && target.type !== "start") {
        out = out.map((c) => (c.id === target.id ? { ...c, entry: name } : c));
        drop(card.id);
      } else {
        out = out.map((c) => (c.id === card.id ? { ...stripLegacy(c), type: "hub", entry: name } : c));
      }
    } else if (card.type === "end") {
      if (!card.endKind || card.endKind === "done") drop(card.id);
      else out = out.map((c) => (c.id === card.id ? { ...stripLegacy(c), type: "ink", text: card.endKind === "end" ? "-> END" : "->->" } : c));
    }
  }
  return { cards: out.map((c) => stripLegacy(c) as Card), links: outLinks };
}

/**
 * Проекты до логики на пинах: условие и действие со стрелки переезжают на пин карточки,
 * только когда ink от этого не меняется (или меняется лишь порядок действия и текста реплики).
 * Остальное остаётся на стрелке.
 */
export function migrateLinkLogic(canvas: Canvas, project: Pick<Project, "entities">): Canvas {
  const byId = new Map(canvas.cards.map((c) => [c.id, c]));
  const count = (key: "from" | "to", id: string) => canvas.links.filter((l) => l[key] === id).length;
  const join = (a: string | undefined, b: string, first = false) => (a?.trim() ? (first ? `${b}\n${a}` : `${a}\n${b}`) : b);
  for (const link of canvas.links) {
    const from = byId.get(link.from);
    const to = byId.get(link.to);
    if (!from || !to) continue;
    const cond = link.condition?.trim();
    if (cond && to.type !== "condition" && count("to", to.id) === 1) {
      const gate = to.condition?.trim();
      to.condition = gate ? `(${gate}) and (${cond})` : cond;
      delete link.condition;
    }
    const action = link.action?.trim();
    if (!action) continue;
    // на источник — только без условия: иначе действие выполнится до проверки условия
    if (!cond && from.type !== "condition" && count("from", from.id) === 1 && !isPlayerCard(project, to)) {
      from.action = join(from.action, action);
      delete link.action;
    } else if (count("to", to.id) === 1 && !(to.type === "line" && to.text?.includes("{"))) {
      to.action = join(to.action, action, true);
      delete link.action;
    }
  }
  return canvas;
}

function stripLegacy(card: LegacyCard): LegacyCard {
  const { name: _name, endKind: _endKind, ...rest } = card;
  return rest;
}

export type FlowPath = string[];

/** Вложенный поток по пути id карточек от корневого файла. */
export function canvasAtPath(root: Canvas, path: FlowPath = []): Canvas | undefined {
  let canvas = root;
  for (const id of path) {
    const next = canvas.cards.find((c) => c.id === id)?.flow;
    if (!next) return undefined;
    canvas = next;
  }
  return canvas;
}

export interface CanvasLocation {
  canvas: Canvas;
  path: FlowPath;
  parent?: { canvas: Canvas; card: Card };
}

/** Все самостоятельные knot’ы проекта вместе с их единственным владельцем. */
export function canvasLocations(project: Project): CanvasLocation[] {
  const out: CanvasLocation[] = [];
  const roots = Object.values(project.canvases);
  const visit = (canvas: Canvas, parent?: CanvasLocation["parent"], path: FlowPath = []) => {
    out.push({ canvas, path, ...(parent ? { parent } : {}) });
    for (const card of canvas.cards) if (card.flow) visit(card.flow, { canvas, card }, [...path, card.id]);
  };
  for (const root of roots) visit(root);
  return out;
}

function markLegacyAddresses(root: Canvas) {
  const visit = (canvas: Canvas) => {
    canvas.legacyId ??= root.id;
    for (const card of canvas.cards) if (card.flow) visit(card.flow);
  };
  visit(root);
}

/** Переводит прежние независимые файлы в карточки главного холста main. */
export function prepareProject(project: Project): Project {
  const existing = Object.values(project.canvases);
  let main = existing.find((c) => c.id === "main");
  const roots = existing.filter((c) => c !== main);
  const missingBoundaries = (canvas: Canvas): boolean =>
    !canvas.cards.some((c) => c.type === "entry") || !canvas.cards.some((c) => c.type === "exit") || canvas.cards.some((c) => !!c.flow && missingBoundaries(c.flow));
  const migrating = (project.settings.formatVersion ?? 1) < 4 || !main || roots.length > 0 || existing.some(missingBoundaries);
  const legacyMain = (project.settings.formatVersion ?? 1) < 4 && !!main;
  if (!main) {
    main = createCanvas("main", project.settings.name);
    ensureCanvasBoundaries(main);
  }
  main.title = project.settings.name;
  project.canvases = { main };
  if (migrating) ensureCanvasBoundaries(main);
  if (legacyMain) markLegacyAddresses(main);
  if (roots.length) {
    const used = new Set(main.cards.map((c) => c.id));
    roots.forEach((canvas, i) => {
      markLegacyAddresses(canvas);
      let id = `file_${canvas.id}`;
      for (let n = 2; used.has(id); n++) id = `file_${canvas.id}_${n}`;
      used.add(id);
      const wrapper = createCard(id, "flow", { text: canvas.title, folderId: canvas.folderId });
      wrapper.flow = canvas;
      main!.cards.push(wrapper);
      main!.layout[id] = { x: 0, y: i * 180 };
    });
  }
  if (migrating && existing.length && project.settings.start && project.settings.start !== "main") {
    const entry = main.cards.find((c) => c.type === "entry")!;
    const route = createCard(unusedCardId(main, "__main_start"), "jump", { target: project.settings.start });
    main.cards.push(route);
    main.layout[route.id] = { x: -220, y: -180 };
    main.links = main.links.filter((l) => l.from !== entry.id);
    main.links.push({ from: entry.id, to: route.id, order: 0, kind: "divert" });
  }
  if (migrating) {
    const visit = (canvas: Canvas) => {
      ensureCanvasBoundaries(canvas);
      for (const card of canvas.cards) if (card.flow) visit(card.flow);
    };
    visit(main);
    const reserved = new Set([main, ...roots]);
    const usedIds = new Set(["globals", ...[...reserved].map((c) => c.id.toLowerCase())]);
    for (const location of canvasLocations(project)) {
      const canvas = location.canvas;
      if (reserved.has(canvas)) continue;
      const base = canvas.id;
      for (let n = 2; usedIds.has(canvas.id.toLowerCase()); n++) canvas.id = `${base}_${n}`;
      usedIds.add(canvas.id.toLowerCase());
    }
    project.settings.formatVersion = 4;
  }
  return project;
}

export interface FlowCard {
  canvas: Canvas;
  card: Card;
  path: FlowPath;
}

/** Все карточки корневого файла, включая внутренние потоки. */
export function flowCards(root: Canvas): FlowCard[] {
  const out: FlowCard[] = [];
  const visit = (canvas: Canvas, path: FlowPath) => {
    for (const card of canvas.cards) {
      out.push({ canvas, card, path });
      if (card.flow) visit(card.flow, [...path, card.id]);
    }
  };
  visit(root, []);
  return out;
}

function normalizeCanvas(raw: Partial<Canvas> & { cards?: LegacyCard[] }, modern = false): Canvas {
  const graveyard = [...(raw.graveyard ?? [])];
  const migrated = migrateCards(raw.cards ?? [], raw.links ?? [], graveyard);
  const cards = migrated.cards.map((card) => card.flow ? { ...card, flow: normalizeCanvas(card.flow, modern) } : card);
  const links = migrated.links;
  const layout = Object.fromEntries(Object.entries(raw.layout ?? {}).filter(([id]) => cards.some((c) => c.id === id)));
  const start = raw.start && cards.some((c) => c.id === raw.start) ? raw.start : modern ? undefined : guessStart({ cards, links, layout })?.id;
  return {
    id: raw.id ?? "canvas",
    title: raw.title ?? raw.id ?? "",
    ...(raw.legacyId ? { legacyId: raw.legacyId } : {}),
    ...(raw.folderId ? { folderId: raw.folderId } : {}),
    ...(raw.group ? { group: raw.group } : {}),
    ...(start ? { start } : {}),
    owner: raw.owner,
    entries: raw.entries ?? [],
    cards,
    links,
    layout,
    groups: raw.groups ?? [],
    notes: raw.notes ?? [],
    graveyard,
  };
}

function migrateFlowLogic(canvas: Canvas, project: Pick<Project, "entities">): Canvas {
  migrateLinkLogic(canvas, project);
  for (const card of canvas.cards) if (card.flow) migrateFlowLogic(card.flow, project);
  return canvas;
}

export async function loadProject(fs: ProjectFs): Promise<Project> {
  const settingsText = await fs.readText("project.json");
  if (settingsText == null) throw new Error("В папке нет project.json — это не проект Visink");
  const settings = JSON.parse(settingsText);
  if ((settings.formatVersion ?? 1) > 4) throw new Error("Проект создан более новой версией VisInk");
  const entities: Entity[] = JSON.parse((await fs.readText("entities.json")) ?? "[]");
  const variables: Variables = JSON.parse((await fs.readText("variables.json")) ?? '{"vars":[],"lists":[]}');
  const canvases: Record<string, Canvas> = {};
  const canvasFiles = (await fs.listFiles("canvases")).filter((file) => file.endsWith(CANVAS_SUFFIX));
  const currentFiles = (settings.formatVersion ?? 1) >= 4 && canvasFiles.includes(`canvases/main${CANVAS_SUFFIX}`)
    ? [`canvases/main${CANVAS_SUFFIX}`]
    : canvasFiles;
  for (const file of currentFiles) {
    const normalized = normalizeCanvas(JSON.parse((await fs.readText(file)) ?? "{}"), (settings.formatVersion ?? 1) >= 4);
    const canvas = (settings.formatVersion ?? 1) >= 4 ? normalized : migrateFlowLogic(normalized, { entities });
    canvases[canvasPath(canvas)] = canvas;
  }
  const project: Project = {
    settings: { buildDir: "build/narrative", languages: ["ru"], ...settings },
    entities: entities.map((e) => ({ ...e, technicalName: e.technicalName ?? e.id })),
    variables: { sets: variables.sets ?? [], vars: variables.vars ?? [], lists: variables.lists ?? [], functions: variables.functions ?? [] },
    canvases,
  };
  migrateFolders(project);
  return prepareProject(project);
}

/** Файлы проекта в виде «путь → содержимое». */
export function serializeProject(project: Project): Map<string, string> {
  project = structuredClone(project);
  migrateFolders(project);
  prepareProject(project);
  const files = new Map<string, string>();
  files.set("project.json", stableStringify({ ...project.settings, formatVersion: 4 }));
  files.set("entities.json", stableStringify(project.entities.map((e) => ({ ...e, technicalName: e.technicalName ?? e.id }))));
  files.set("variables.json", stableStringify({ ...project.variables, sets: project.variables.sets ?? [] }));
  for (const canvas of Object.values(project.canvases)) {
    const sync = (c: Canvas) => {
      c.entries = syncEntries(c).entries;
      for (const card of c.cards) if (card.flow) sync(card.flow);
    };
    sync(canvas);
    files.set(`canvases/${canvasPath(canvas)}${CANVAS_SUFFIX}`, stableStringify(canvas));
  }
  return files;
}

/**
 * Пишет только изменившиеся файлы и удаляет файлы холстов, которых больше нет.
 * Возвращает список записанных путей.
 */
export async function saveProject(fs: ProjectFs, project: Project): Promise<string[]> {
  const original = await fs.readText("project.json");
  if (original && (JSON.parse(original).formatVersion ?? 1) < 4) {
    const oldVersion = JSON.parse(original).formatVersion ?? 1;
    const backup = oldVersion < 2 ? ".backups/pre-v2/" : oldVersion < 3 ? ".backups/pre-v3/" : ".backups/pre-v4/";
    if (!(await fs.readText(backup + "complete.json"))) {
      const paths = ["project.json", "entities.json", "variables.json", ...(await fs.listFiles("canvases"))];
      for (const path of paths) {
        const text = await fs.readText(path);
        if (text !== null && await fs.readText(backup + path) === null) await fs.writeText(backup + path, text);
      }
      await fs.writeText(backup + "complete.json", JSON.stringify({ formatVersion: oldVersion }));
    }
  }
  return writeFiles(fs, "", serializeProject(project), "canvases", CANVAS_SUFFIX);
}

/**
 * Пишет набор файлов в папку под корнем, только изменившиеся.
 * Если задан pruneDir, удаляет там файлы с суффиксом pruneSuffix, которых нет в наборе.
 */
export async function writeFiles(
  fs: ProjectFs,
  dir: string,
  files: Map<string, string>,
  pruneDir?: string,
  pruneSuffix = "",
): Promise<string[]> {
  const prefix = dir ? `${dir}/` : "";
  const written: string[] = [];
  for (const [rel, content] of files) {
    const path = prefix + rel;
    if ((await fs.readText(path)) === content) continue;
    await fs.writeText(path, content);
    written.push(path);
  }
  if (pruneDir != null) {
    for (const path of await fs.listFiles(prefix + pruneDir)) {
      if (path.endsWith(pruneSuffix) && !files.has(path.slice(prefix.length))) {
        await fs.remove(path);
        written.push(path);
      }
    }
  }
  return written;
}

export const BUILD_HEADER = "// Сгенерировано Visink";

/**
 * Пишет сборку в папку и удаляет оставшиеся там старые .ink, сгенерированные Visink
 * (например, после переименования холста). Чужие файлы не трогает.
 */
export async function writeBuild(fs: ProjectFs, dir: string, files: Map<string, string>): Promise<string[]> {
  const written = await writeFiles(fs, dir, files);
  const prefix = dir ? `${dir}/` : "";
  // в корне сборки и в папках категорий старых версий
  const legacy = ["characters", "items", "situations", "other"].map((d) => prefix + d);
  const found = [...(await fs.listFiles(dir, true))];
  for (const d of legacy) found.push(...(await fs.listFiles(d, true)));
  for (const path of found) {
    const rel = path.slice(prefix.length);
    if (!rel.endsWith(".ink") || files.has(rel)) continue;
    if (!(await fs.readText(path))?.startsWith(BUILD_HEADER)) continue;
    await fs.remove(path);
    written.push(path);
  }
  return written;
}

/** Id стрелки на холсте и в выделении: "from>to>port". */
export const linkId = (l: { from: string; to: string; port?: string }) => `${l.from}>${l.to}>${l.port ?? ""}`;
