import { namespaceName } from "@visink/core";
import { isLegacyRoot, mapStoryText } from "@visink/compiler";
import { rewriteCardExpression } from "./cardEditing";
// Операции правки проекта. Все мутируют черновик (копию), store сам делает копию и пишет историю.
import type { Canvas, Card, CardType, Link, Note, Point, Project } from "@visink/core";
import { canvasAtPath, createCanvas, createCard, flowCards, guessStart, isPlayerCard, linkId, newCardId, newNoteId, toInkName, canvasLocations, ensureCanvasBoundaries, isBoundaryCard, prepareProject } from "@visink/core";

export const CARD_W = 280;
export const COL = 360;
/** зазор между карточкой и следующей справа */
const GAP = COL - CARD_W;
export const ROW = 200;
/** сдвиг вставки без курсора: две клетки сетки */
const GRID_STEP = 20;

function takenIds(canvas: Canvas): string[] {
  const out = [...canvas.cards.map((c) => c.id), ...canvas.graveyard, ...canvas.notes.map((n) => n.id)];
  for (const card of canvas.cards) if (card.flow) out.push(...takenIds(card.flow));
  return out;
}

function takenCanvasIds(root: Canvas): string[] {
  return [root.id, ...root.cards.flatMap((card) => card.flow ? takenCanvasIds(card.flow) : [])];
}

/** Порядок стрелок из карточки = порядок целей сверху вниз. */
export function reorderLinks(canvas: Canvas) {
  const pos = (id: string) => canvas.layout[id] ?? { x: 0, y: 0 };
  const groups = new Map<string, typeof canvas.links>();
  for (const l of canvas.links) {
    if (!groups.has(l.from)) groups.set(l.from, []);
    groups.get(l.from)!.push(l);
  }
  for (const links of groups.values()) {
    links.sort((a, b) => pos(a.to).y - pos(b.to).y || pos(a.to).x - pos(b.to).x || a.to.localeCompare(b.to));
    links.forEach((l, i) => (l.order = i));
  }
}

export function addCard(canvas: Canvas, type: CardType, at: Point, init: Partial<Card> = {}, root = canvas): Card {
  const card = createCard(newCardId(takenIds(root)), type, init);
  if (card.flow) {
    const used = new Set(takenCanvasIds(root).map((id) => id.toLowerCase()));
    const base = `${root.id}_${card.id}`;
    card.flow.id = used.has(base.toLowerCase()) ? `${base}_${card.id}` : base;
    let n = 2; while (used.has(card.flow.id.toLowerCase())) card.flow.id = `${base}_${n++}`;
  }
  canvas.cards.push(card);
  canvas.layout[card.id] = { x: Math.round(at.x), y: Math.round(at.y) };
  const entry = canvas.cards.find((c) => c.type === "entry");
  const exit = canvas.cards.find((c) => c.type === "exit");
  if (entry && exit && !isBoundaryCard(card) && canvas.links.some((l) => l.from === entry.id && l.to === exit.id)) {
    const direct = canvas.links.find((l) => l.from === entry.id)?.direct;
    canvas.links = canvas.links.filter((l) => l.from !== entry.id);
    canvas.links.push({ from: entry.id, to: card.id, order: 0, kind: "divert", ...(direct ? { direct: true } : {}) });
  }
  return card;
}

export function setCanvasStart(canvas: Canvas, cardId: string) {
  const entry = canvas.cards.find((card) => card.type === "entry");
  const card = canvas.cards.find((item) => item.id === cardId);
  if (!entry || !card || isBoundaryCard(card)) return;
  const current = canvas.links.filter((link) => link.from === entry.id);
  if (current.length === 1 && current[0].to === card.id) return;
  canvas.links = canvas.links.filter((link) => link.from !== entry.id);
  canvas.links.push({ from: entry.id, to: card.id, order: 0, kind: "divert" });
  reorderLinks(canvas);
}

export function addNote(canvas: Canvas, at: Point, root = canvas) {
  const note = { id: newNoteId(takenIds(root)), text: "", x: Math.round(at.x), y: Math.round(at.y) };
  canvas.notes.push(note);
  return note;
}

export function addNestedFlow(canvas: Canvas, cardId: string): Canvas {
  const card = canvas.cards.find((c) => c.id === cardId);
  if (!card) throw new Error("Карточка не найдена");
  if (!card.flow) card.flow = ensureCanvasBoundaries(createCanvas(`${canvas.id}_${card.id}`, "Вложенный поток"));
  return card.flow;
}

export function connect(canvas: Canvas, from: string, to: string, port?: "yes" | "no") {
  if (from === to || canvas.cards.find((c) => c.id === from)?.type === "exit" || canvas.cards.find((c) => c.id === to)?.type === "entry") return;
  if (canvas.links.some((l) => l.from === from && l.to === to && l.port === port)) return;
  canvas.links.push({ from, to, order: 999, kind: "divert", ...(port ? { port } : {}) });
  reorderLinks(canvas);
}

export function branchPoints(canvas: Canvas, from: string, count: number, grid = 1): Point[] {
  const at = canvas.layout[from] ?? { x: 0, y: 0 };
  const total = Math.max(1, Math.min(4, Math.round(count)));
  return Array.from({ length: total }, (_, i) => snapPoint({
    x: at.x + (at.w ?? CARD_W) + GAP,
    y: at.y + (i - (total - 1) / 2) * ROW,
  }, grid));
}

export function addBranchCards(canvas: Canvas, from: string, type: CardType, count: number, init: Partial<Card>, root: Canvas, grid: number, port?: "yes" | "no"): Card[] {
  return branchPoints(canvas, from, count, grid).map((at) => {
    const card = addCard(canvas, type, at, init, root);
    connect(canvas, from, card.id, port);
    return card;
  });
}

export function deleteCards(canvas: Canvas, ids: string[]) {
  const set = new Set(ids.filter((id) => {
    const card = canvas.cards.find((c) => c.id === id);
    return !card || !isBoundaryCard(card);
  }));
  const entry = canvas.cards.find((card) => card.type === "entry");
  const exit = canvas.cards.find((card) => card.type === "exit");
  const direct = canvas.links.find((link) => link.from === entry?.id)?.direct;
  const removed = canvas.cards.filter((c) => set.has(c.id)).map((c) => c.id);
  canvas.cards = canvas.cards.filter((c) => !set.has(c.id));
  canvas.notes = canvas.notes.filter((n) => !set.has(n.id));
  canvas.links = canvas.links.filter((l) => !set.has(l.from) && !set.has(l.to));
  if (canvas.id === "main" && entry && exit && !canvas.links.some((link) => link.from === entry.id)) {
    canvas.links.push({ from: entry.id, to: exit.id, order: 0, kind: "divert", ...(direct ? { direct: true } : {}) });
  }
  for (const id of set) delete canvas.layout[id];
  canvas.groups = canvas.groups.map((g) => ({ ...g, cards: g.cards.filter((c) => !set.has(c)) }));
  for (const id of removed) if (!canvas.graveyard.includes(id)) canvas.graveyard.push(id);
  reorderLinks(canvas);
}

export function deleteLinks(canvas: Canvas, ids: Iterable<string>) {
  const set = new Set(ids);
  canvas.links = canvas.links.filter((l) => !set.has(linkId(l)));
  reorderLinks(canvas);
}

export function deleteLink(canvas: Canvas, from: string, to: string, port?: string) {
  deleteLinks(canvas, [linkId({ from, to, port })]);
}

/** Точка, привязанная к сетке шага grid (1 — просто округлить). */
export function snapPoint(p: { x: number; y: number }, grid = 1) {
  return { x: Math.round(p.x / grid) * grid, y: Math.round(p.y / grid) * grid };
}

/** «Выровнять всё по сетке»: позиции и ручные размеры карточек и заметок. */
export function alignToGrid(canvas: Canvas, grid: number) {
  for (const [id, p] of Object.entries(canvas.layout)) {
    const snapped: Point = snapPoint(p, grid);
    if (p.w != null) snapped.w = Math.max(grid, Math.round(p.w / grid) * grid);
    if (p.h != null) snapped.h = Math.max(grid, Math.round(p.h / grid) * grid);
    canvas.layout[id] = snapped;
  }
  for (const n of canvas.notes) Object.assign(n, snapPoint(n, grid));
  reorderLinks(canvas);
}

// ───────────── копировать / вставить ─────────────

/** Кусок холста в буфере обмена: карточки, заметки, стрелки между ними и раскладка. */
export interface Fragment {
  visink: 1;
  cards: Card[];
  notes: Note[];
  links: Link[];
  layout: Record<string, Point>;
}

export function copyFragment(canvas: Canvas, ids: string[]): Fragment | null {
  const set = new Set(ids);
  const cards = canvas.cards.filter((c) => set.has(c.id) && !isBoundaryCard(c));
  const notes = canvas.notes.filter((n) => set.has(n.id));
  if (!cards.length && !notes.length) return null;
  const copied = new Set([...cards.map((c) => c.id), ...notes.map((n) => n.id)]);
  const links = canvas.links.filter((l) => copied.has(l.from) && copied.has(l.to));
  const layout = Object.fromEntries(cards.filter((c) => canvas.layout[c.id]).map((c) => [c.id, canvas.layout[c.id]]));
  return structuredClone({ visink: 1, cards, notes, links, layout });
}

export function parseFragment(text: string): Fragment | null {
  try {
    const f = JSON.parse(text);
    if (f?.visink !== 1 || !Array.isArray(f.cards) || !Array.isArray(f.notes) || !Array.isArray(f.links)) return null;
    return { visink: 1, cards: f.cards, notes: f.notes, links: f.links, layout: f.layout ?? {} };
  } catch {
    return null;
  }
}

/**
 * Вставляет кусок с новыми id. at — куда встанет левый верхний угол куска;
 * без него — со сдвигом от оригинала. Возвращает id вставленного.
 */
export function pasteFragment(project: Project, canvas: Canvas, fragment: Fragment, at?: Point, grid = 1, root = canvas): string[] {
  const corners = [...fragment.cards.map((c) => fragment.layout[c.id] ?? { x: 0, y: 0 }), ...fragment.notes];
  const minX = Math.min(...corners.map((p) => p.x));
  const minY = Math.min(...corners.map((p) => p.y));
  const target = snapPoint(at ?? { x: minX + 2 * GRID_STEP, y: minY + 2 * GRID_STEP }, grid);
  const move = (p: Point) => snapPoint({ x: p.x - minX + target.x, y: p.y - minY + target.y }, grid);
  const npc = defaultNpc(project, canvas);
  const ids = new Map<string, string>();
  const topIds: string[] = [];

  const cloneCard = (src: Card, dest: Canvas, nested: boolean): Card => {
    const { id: _id, entry: _entry, flow, ...rest } = structuredClone(src);
    if (rest.speaker && !project.entities.some((e) => e.id === rest.speaker)) rest.speaker = npc;
    const card = createCard(newCardId(takenIds(root)), src.type, rest);
    ids.set(src.id, card.id);
    dest.cards.push(card);
    const p = fragment.layout[src.id] ?? { x: minX, y: minY };
    dest.layout[card.id] = nested ? { x: 0, y: 0 } : { ...move(p), ...(p.w != null ? { w: p.w } : {}), ...(p.h != null ? { h: p.h } : {}) };
    if (flow) {
      card.flow = cloneCanvas(flow);
      const used = new Set(takenCanvasIds(root).map((id) => id.toLowerCase()));
      const base = `${root.id}_${card.id}`;
      card.flow.id = base;
      for (let n = 2; used.has(card.flow.id.toLowerCase()); n++) card.flow.id = `${base}_${n}`;
    }
    return card;
  };

  const cloneCanvas = (src: Canvas): Canvas => {
    const dest = createCanvas(`${root.id}_${src.id}`, src.title);
    dest.owner = src.owner;
    if (src.formatting) dest.formatting = structuredClone(src.formatting);
    const localIds = new Map<string, string>();
    for (const srcCard of src.cards) {
      const card = cloneCard(srcCard, dest, true);
      localIds.set(srcCard.id, card.id);
      dest.layout[card.id] = structuredClone(src.layout[srcCard.id] ?? { x: 0, y: 0 });
    }
    for (const srcNote of src.notes) {
      const note = { ...structuredClone(srcNote), id: newNoteId(takenIds(root)) };
      ids.set(srcNote.id, note.id);
      dest.notes.push(note);
    }
    dest.links = src.links.flatMap((l) => {
      const from = localIds.get(l.from);
      const to = localIds.get(l.to);
      return from && to ? [{ ...structuredClone(l), from, to }] : [];
    });
    dest.start = src.start ? localIds.get(src.start) : undefined;
    return dest;
  };

  for (const src of fragment.cards) topIds.push(cloneCard(src, canvas, false).id);
  for (const src of fragment.notes) {
    const note = { ...structuredClone(src), id: newNoteId(takenIds(root)), ...move(src) };
    canvas.notes.push(note);
    ids.set(src.id, note.id);
    topIds.push(note.id);
  }
  for (const l of fragment.links) {
    const from = ids.get(l.from);
    const to = ids.get(l.to);
    if (from && to) canvas.links.push({ ...structuredClone(l), from, to });
  }
  if (!canvas.start) canvas.start = guessStart(canvas)?.id;
  reorderLinks(canvas);
  return topIds;
}

/** Главный NPC холста: владелец, иначе первый персонаж не-игрок. */
export function defaultNpc(project: Project, canvas: Canvas): string | undefined {
  const owner = project.entities.find((e) => e.id === canvas.owner && !e.isPlayer);
  if (owner) return owner.id;
  const used = canvas.cards.find((c) => c.type === "line" && c.speaker && !isPlayerCard(project, c));
  return used?.speaker ?? project.entities.find((e) => !e.isPlayer)?.id;
}

function npcBefore(project: Project, canvas: Canvas, id: string, depth = 0): string | undefined {
  if (depth > 20) return undefined;
  for (const l of canvas.links.filter((l) => l.to === id)) {
    const prev = canvas.cards.find((c) => c.id === l.from);
    if (!prev) continue;
    if (prev.type === "line" && prev.speaker && !isPlayerCard(project, prev)) return prev.speaker;
    const deeper = npcBefore(project, canvas, prev.id, depth + 1);
    if (deeper) return deeper;
  }
  return undefined;
}

/**
 * Спикер следующей реплики (Enter): после игрока отвечает тот, с кем он говорил;
 * после NPC — тот же NPC, если только реплике не предшествовал другой спикер.
 */
export function nextSpeaker(project: Project, canvas: Canvas, from: Card): string | undefined {
  if (from.type !== "line") return defaultNpc(project, canvas);
  if (isPlayerCard(project, from)) return npcBefore(project, canvas, from.id) ?? defaultNpc(project, canvas);
  const prevLink = canvas.links.find((l) => l.to === from.id);
  const prev = prevLink && canvas.cards.find((c) => c.id === prevLink.from);
  if (prev?.type === "line" && prev.speaker && prev.speaker !== from.speaker) return prev.speaker;
  return from.speaker ?? defaultNpc(project, canvas);
}

/** Enter: новая реплика справа от выделенной. */
export function addNextLine(project: Project, canvas: Canvas, fromId: string, root = canvas): Card | null {
  const from = canvas.cards.find((c) => c.id === fromId);
  if (!from) return null;
  const at = canvas.layout[fromId] ?? { x: 0, y: 0 };
  const siblings = canvas.links.filter((l) => l.from === fromId).length;
  const card = addCard(canvas, "line", { x: at.x + (at.w ?? CARD_W) + GAP, y: at.y + siblings * ROW }, { speaker: nextSpeaker(project, canvas, from) }, root);
  if (isPlayerCard(project, card)) card.repeat = "sticky";
  connect(canvas, fromId, card.id);
  return card;
}

/** Tab: ещё один вариант выбора игрока. */
export function addPlayerOption(project: Project, canvas: Canvas, selectedId: string, root = canvas): Card | null {
  const selected = canvas.cards.find((c) => c.id === selectedId);
  const player = project.entities.find((e) => e.isPlayer);
  if (!selected || !player) return null;
  const parentId = isPlayerCard(project, selected) ? canvas.links.find((l) => l.to === selectedId)?.from ?? null : selectedId;
  if (!parentId) return null;
  const options = canvas.links.filter((l) => l.from === parentId).map((l) => canvas.layout[l.to]).filter(Boolean);
  const parentAt = canvas.layout[parentId] ?? { x: 0, y: 0 };
  const y = options.length ? Math.max(...options.map((p) => p.y)) + ROW : parentAt.y;
  const card = addCard(canvas, "line", { x: parentAt.x + (parentAt.w ?? CARD_W) + GAP, y }, { speaker: player.id, repeat: "sticky" }, root);
  connect(canvas, parentId, card.id);
  return card;
}

export function uniqueCanvasId(project: Project, base: string): string {
  const ids = new Set(["main", "globals", ...takenCanvasIds(project.canvases.main ?? Object.values(project.canvases)[0]).map((id) => id.toLowerCase())]);
  let id = ids.has(base.toLowerCase()) ? `${base}_2` : base;
  for (let i = 3; ids.has(id.toLowerCase()); i++) id = `${base}_${i}`;
  return id;
}

/** Новый файл — карточка-вложенность на главном холсте. Возвращает id этой карточки. */
export function addCanvas(project: Project, title: string): string {
  const main = project.canvases.main;
  if (!main) throw new Error("Главный холст не найден");
  const card = addCard(main, "flow", { x: Math.max(-360, ...Object.values(main.layout).map((at) => at.x)) + 360, y: 0 }, { text: title }, main);
  card.flow!.id = uniqueCanvasId(project, toInkName(title) || "flow");
  card.flow!.title = title;
  return card.id;
}

export function renameNestedCanvas(project: Project, path: string[], id: string) {
  const canvas = canvasAtPath(project.canvases.main, path);
  if (!canvas || id === canvas.id) return;
  const fix = (target: string) => target === canvas.id ? id : target.startsWith(canvas.id + ".") ? id + target.slice(canvas.id.length) : target;
  for (const location of canvasLocations(project)) {
    for (const card of location.canvas.cards) if (card.type === "jump" && card.target) card.target = fix(card.target);
  }
  if (project.settings.start) project.settings.start = fix(project.settings.start);
  canvas.id = id;
}

export interface JumpTarget {
  value: string;
  label: string;
  hint?: string;
  /** Сохранённые адреса той же логической цели; отдельные строки для них не нужны. */
  aliases?: string[];
}

export function jumpTargetLocation(project: Project, target: string): { canvas: Canvas; card?: Card } | null {
  const [canvasId, sub] = target.trim().split(".", 2);
  const locations = canvasLocations(project);
  const location = locations.find(({ canvas }) => canvas.id === canvasId)
    ?? locations.find(({ canvas }) => canvas.legacyId === canvasId && isLegacyRoot(project, canvas));
  if (!location) return null;
  const { canvas } = location;
  if (!sub) {
    const entry = canvas.cards.find((card) => card.type === "entry");
    const start = canvas.links.find((link) => link.from === entry?.id)?.to;
    const card = canvas.cards.find((item) => item.id === start && !isBoundaryCard(item));
    return { canvas, ...(card ? { card } : {}) };
  }
  const cards = isLegacyRoot(project, canvas)
    ? flowCards(canvas).filter((item) => item.canvas.legacyId === canvas.legacyId)
    : canvas.cards.map((card) => ({ canvas, card }));
  const name = sub.startsWith("entry_") ? sub.slice(6) : sub;
  const match = cards.find(({ card }) => card.entry === name) ?? cards.find(({ card }) => card.id === sub);
  if (!match || isBoundaryCard(match.card)) return null;
  return { canvas: match.canvas, card: match.card };
}

const TARGET_TYPE: Record<CardType, string> = { line: "Реплика", hub: "Хаб", condition: "Условие", jump: "Переход", flow: "Вложенность", entry: "Вход", exit: "Выход", ink: "Ink" };

/** По одной строке на логическую цель; прежние адреса остаются доступны как alias. */
export function jumpTargets(project: Project): JumpTarget[] {
  project = prepareProject(structuredClone(project));
  const out: JumpTarget[] = [];
  for (const { canvas: c, parent } of canvasLocations(project)) {
    const legacyRoot = !!c.legacyId && parent?.canvas.legacyId !== c.legacyId;
    out.push({ value: c.id, label: c.title, hint: `Файл · ${c.id}`, ...(legacyRoot && c.legacyId && c.legacyId !== c.id ? { aliases: [c.legacyId] } : {}) });
    for (const card of c.cards) {
      if (isBoundaryCard(card)) continue;
      const kind = TARGET_TYPE[card.type];
      const name = card.menuText || card.text || card.condition || (card.type === "jump" ? card.target : "") || kind;
      const addresses = [c.id, ...(c.legacyId ? [c.legacyId] : [])];
      const value = `${c.id}.${card.id}`;
      const aliases = addresses.map((address) => `${address}.${card.id}`).filter((address) => address !== value);
      out.push({ value, label: `${name} · ${card.id}`, hint: `${c.title} · ${kind}`, ...(aliases.length ? { aliases } : {}) });
      if (card.entry) {
        const entryValue = `${c.id}.entry_${card.entry}`;
        const entryAliases = addresses.flatMap((address) => [`${address}.${card.entry}`, `${address}.entry_${card.entry}`])
          .filter((address, index, all) => address !== entryValue && all.indexOf(address) === index);
        out.push({ value: entryValue, label: `Вход: ${card.entry}`, hint: c.title, aliases: entryAliases });
      }
    }
  }
  return out.sort((a, b) => a.label.localeCompare(b.label) || a.value.localeCompare(b.value));
}

// ───────────── переменные ─────────────

const WORD = "\\wЀ-ӿ";

function identRe(name: string): RegExp {
  const escaped = name.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  return new RegExp(`(?<![${WORD}.])${escaped}(?![${WORD}])`, "g");
}

/** Заменяет имя в ink-выражении по границе слова, не трогая строки в кавычках. */
export function replaceIdent(expr: string, from: string, to: string): string {
  const re = identRe(from);
  return expr
    .split(/("[^"]*")/)
    .map((part, i) => (i % 2 ? part : part.replace(re, to)))
    .join("");
}

export function mentions(expr: string | undefined, name: string): boolean {
  if (!expr) return false;
  const re = new RegExp(identRe(name).source);
  return expr.split(/"[^"]*"/).some((part) => re.test(part));
}

export const logicalName = (item: { name: string; owner?: string }) => item.owner ? `${item.owner}.${item.name}` : item.name;

export interface Usage {
  /** файл; у функций — пусто */
  key: string;
  path?: string[];
  card?: string;
  link?: { from: string; to: string; port?: "yes" | "no" };
  /** использование в теле функции */
  func?: string;
  funcOwner?: string;
}

function hasLocal(project: Project, owner: string | undefined, name: string): boolean {
  if (!owner) return false;
  const { vars, lists, functions } = project.variables;
  return [...vars, ...lists, ...functions].some((x) => x.owner === owner && x.name === name);
}

function usageMentions(project: Project, expr: string | undefined, name: string, owner?: string, functionOwner?: string, params: string[] = []): boolean {
  if (owner) {
    return mentions(expr, `${namespaceName(project, owner)}.${name}`) || (functionOwner === owner && !params.includes(name) && mentions(expr, name));
  }
  return !params.includes(name) && !hasLocal(project, functionOwner, name) && mentions(expr, name);
}

function textUsage(project: Project, text: string | undefined, name: string, owner?: string, localNames: string[] = []) {
  if (!text) return false;
  let used = false;
  mapStoryText(project, text, (expression) => {
    if (usageMentions(project, expression, name, owner, undefined, localNames)) used = true;
    return expression;
  }, { localNames });
  return used;
}

/** Где в проекте встречается имя переменной, списка или функции: условия, действия, чистый ink, тела функций и шаблоны реплик. */
export function variableUsages(project: Project, name: string, owner?: string): Usage[] {
  const out: Usage[] = [];
  for (const f of project.variables.functions) {
    if (f.name === name && f.owner === owner) continue;
    if (usageMentions(project, f.body, name, owner, f.owner, f.params)) out.push({ key: "", func: f.name, funcOwner: f.owner });
  }
  for (const [key, c] of Object.entries(project.canvases)) {
    for (const { card, path } of flowCards(c)) {
      const locals = card.inputs?.map((input) => input.name);
      const used = (expr?: string) => usageMentions(project, expr, name, owner, undefined, locals);
      if (used(card.condition) || used(card.action) || card.type === "ink" && used(card.text) || card.type === "line" && (textUsage(project, card.text, name, owner, locals) || textUsage(project, card.menuText, name, owner, locals))) {
        out.push({ key, path, card: card.id });
      }
    }
    const visitLinks = (flow: Canvas, path: string[]) => {
      for (const l of flow.links) {
        const locals = flow.cards.find((card) => card.id === l.from && card.type !== "flow")?.inputs?.map((input) => input.name);
        if ([l.condition, l.action, ...Object.values(l.args ?? {})].some((expr) => usageMentions(project, expr, name, owner, undefined, locals))) out.push({ key, path, link: { from: l.from, to: l.to, ...(l.port ? { port: l.port } : {}) } });
      }
      for (const card of flow.cards) if (card.flow) visitLinks(card.flow, [...path, card.id]);
    };
    visitLinks(c, []);
  }
  return out;
}

/** Переименовывает переменную, список или функцию и все упоминания в той же области. */
export function renameVariable(project: Project, from: string, to: string, owner?: string) {
  if (from === to) return;
  const match = (x: { name: string; owner?: string }) => x.name === from && x.owner === owner;
  const v = project.variables.vars.find(match);
  const l = project.variables.lists.find(match);
  const fn = project.variables.functions.find(match);
  const renameExpr = (expr: string, localOwner?: string, params: string[] = []) => {
    if (owner) {
      let out = replaceIdent(expr, `${namespaceName(project, owner)}.${from}`, `${namespaceName(project, owner)}.${to}`);
      if (localOwner === owner && !params.includes(from)) out = replaceIdent(out, from, to);
      return out;
    }
    return params.includes(from) || hasLocal(project, localOwner, from) ? expr : replaceIdent(expr, from, to);
  };
  for (const f of project.variables.functions) f.body = renameExpr(f.body, f.owner, f.params);
  for (const c of Object.values(project.canvases)) {
    for (const { card } of flowCards(c)) {
      const locals = card.inputs?.map((input) => input.name);
      const rename = (expr: string) => renameExpr(expr, undefined, locals);
      if (card.condition) card.condition = rename(card.condition);
      if (card.action) card.action = rename(card.action);
      if (card.type === "line") {
        rewriteCardExpression(project, card, "text", rename);
        rewriteCardExpression(project, card, "menuText", rename);
      }
      if (card.type === "ink" && card.text) card.text = rename(card.text);
    }
    const visitLinks = (flow: Canvas) => {
      for (const link of flow.links) {
        const locals = flow.cards.find((card) => card.id === link.from && card.type !== "flow")?.inputs?.map((input) => input.name);
        const rename = (expr: string) => renameExpr(expr, undefined, locals);
        if (link.condition) link.condition = rename(link.condition);
        if (link.action) link.action = rename(link.action);
        for (const [key, value] of Object.entries(link.args ?? {})) link.args![key] = rename(value);
      }
      for (const card of flow.cards) if (card.flow) visitLinks(card.flow);
    };
    visitLinks(c);
  }
  if (v) v.name = to;
  if (l) l.name = to;
  if (fn) fn.name = to;
}
