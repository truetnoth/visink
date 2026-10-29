// Операции правки проекта. Все мутируют черновик (копию), store сам делает копию и пишет историю.
import type { Canvas, Card, CardType, Point, Project } from "@visink/core";
import { canvasPath, createCanvas, createCard, guessStart, isPlayerCard, newCardId, newNoteId, toInkName } from "@visink/core";

export const CARD_W = 280;
export const COL = 360;
/** зазор между карточкой и следующей справа */
const GAP = COL - CARD_W;
export const ROW = 200;

function takenIds(canvas: Canvas): string[] {
  return [...canvas.cards.map((c) => c.id), ...canvas.graveyard, ...canvas.notes.map((n) => n.id)];
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

export function addCard(canvas: Canvas, type: CardType, at: Point, init: Partial<Card> = {}): Card {
  const card = createCard(newCardId(takenIds(canvas)), type, init);
  canvas.cards.push(card);
  canvas.layout[card.id] = { x: Math.round(at.x), y: Math.round(at.y) };
  return card;
}

export function addNote(canvas: Canvas, at: Point) {
  const note = { id: newNoteId(takenIds(canvas)), text: "Заметка", x: Math.round(at.x), y: Math.round(at.y) };
  canvas.notes.push(note);
  return note;
}

export function connect(canvas: Canvas, from: string, to: string, port?: "yes" | "no") {
  if (from === to) return;
  if (canvas.links.some((l) => l.from === from && l.to === to && l.port === port)) return;
  if (port) canvas.links = canvas.links.filter((l) => !(l.from === from && l.port === port));
  canvas.links.push({ from, to, order: 999, kind: "divert", ...(port ? { port } : {}) });
  reorderLinks(canvas);
}

export function deleteCards(canvas: Canvas, ids: string[]) {
  const set = new Set(ids);
  const removed = canvas.cards.filter((c) => set.has(c.id)).map((c) => c.id);
  canvas.cards = canvas.cards.filter((c) => !set.has(c.id));
  canvas.notes = canvas.notes.filter((n) => !set.has(n.id));
  canvas.links = canvas.links.filter((l) => !set.has(l.from) && !set.has(l.to));
  for (const id of ids) delete canvas.layout[id];
  canvas.groups = canvas.groups.map((g) => ({ ...g, cards: g.cards.filter((c) => !set.has(c)) }));
  for (const id of removed) if (!canvas.graveyard.includes(id)) canvas.graveyard.push(id);
  // удалили начало файла — началом становится следующая подходящая карточка
  if (canvas.start && set.has(canvas.start)) {
    const next = guessStart(canvas);
    if (next) canvas.start = next.id;
    else delete canvas.start;
  }
  reorderLinks(canvas);
}

export function deleteLink(canvas: Canvas, from: string, to: string, port?: string) {
  canvas.links = canvas.links.filter((l) => !(l.from === from && l.to === to && (l.port ?? undefined) === (port ?? undefined)));
  reorderLinks(canvas);
}

/** Главный NPC холста: владелец, иначе первый персонаж не-игрок. */
export function defaultNpc(project: Project, canvas: Canvas): string | undefined {
  const owner = project.entities.find((e) => e.id === canvas.owner && e.kind === "character" && !e.isPlayer);
  if (owner) return owner.id;
  const used = canvas.cards.find((c) => c.type === "line" && c.speaker && !isPlayerCard(project, c));
  return used?.speaker ?? project.entities.find((e) => e.kind === "character" && !e.isPlayer)?.id;
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
export function addNextLine(project: Project, canvas: Canvas, fromId: string): Card | null {
  const from = canvas.cards.find((c) => c.id === fromId);
  if (!from) return null;
  const at = canvas.layout[fromId] ?? { x: 0, y: 0 };
  const siblings = canvas.links.filter((l) => l.from === fromId).length;
  const card = addCard(canvas, "line", { x: at.x + (at.w ?? CARD_W) + GAP, y: at.y + siblings * ROW }, { speaker: nextSpeaker(project, canvas, from) });
  connect(canvas, fromId, card.id);
  return card;
}

/** Tab: ещё один вариант выбора игрока. */
export function addPlayerOption(project: Project, canvas: Canvas, selectedId: string): Card | null {
  const selected = canvas.cards.find((c) => c.id === selectedId);
  const player = project.entities.find((e) => e.isPlayer);
  if (!selected || !player) return null;
  const parentId = isPlayerCard(project, selected) ? canvas.links.find((l) => l.to === selectedId)?.from ?? null : selectedId;
  if (!parentId) return null;
  const options = canvas.links.filter((l) => l.from === parentId).map((l) => canvas.layout[l.to]).filter(Boolean);
  const parentAt = canvas.layout[parentId] ?? { x: 0, y: 0 };
  const y = options.length ? Math.max(...options.map((p) => p.y)) + ROW : parentAt.y;
  const card = addCard(canvas, "line", { x: parentAt.x + (parentAt.w ?? CARD_W) + GAP, y }, { speaker: player.id });
  connect(canvas, parentId, card.id);
  return card;
}

export function uniqueCanvasId(project: Project, base: string): string {
  const ids = new Set(Object.values(project.canvases).map((c) => c.id));
  let id = base;
  for (let i = 2; ids.has(id); i++) id = `${base}_${i}`;
  return id;
}

/** Новый холст с одной пустой репликой — с неё узел и начнётся. */
export function addCanvas(project: Project, title: string): string {
  const canvas = createCanvas(uniqueCanvasId(project, toInkName(title)), title);
  canvas.start = addCard(canvas, "line", { x: 0, y: 0 }, { speaker: defaultNpc(project, canvas) }).id;
  const key = canvasPath(canvas);
  project.canvases[key] = canvas;
  return key;
}

/** Меняет имя узла ink и чинит все переходы на него. Возвращает новый ключ. */
export function renameCanvas(project: Project, key: string, patch: { id?: string }): string {
  const canvas = project.canvases[key];
  const oldId = canvas.id;
  const newId = patch.id ?? oldId;
  const fix = (t: string) => (t === oldId ? newId : t.startsWith(oldId + ".") ? newId + t.slice(oldId.length) : t);
  if (newId !== oldId) {
    for (const c of Object.values(project.canvases)) {
      for (const card of c.cards) if (card.type === "jump" && card.target) card.target = fix(card.target);
    }
    if (project.settings.start) project.settings.start = fix(project.settings.start);
  }
  delete project.canvases[key];
  canvas.id = newId;
  const newKey = canvasPath(canvas);
  project.canvases[newKey] = canvas;
  return newKey;
}

/** Все цели переходов в проекте: холст, его точки входа. Для подсказок в поле «цель». */
export function jumpTargets(project: Project): string[] {
  const out: string[] = [];
  for (const c of Object.values(project.canvases)) {
    out.push(c.id);
    for (const card of c.cards) if (card.entry) out.push(`${c.id}.${card.entry}`);
  }
  return out.sort();
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

export interface Usage {
  /** файл; у функций — пусто */
  key: string;
  card?: string;
  link?: { from: string; to: string; port?: "yes" | "no" };
  /** использование в теле функции */
  func?: string;
}

/** Где в проекте встречается имя переменной, списка или функции: условия, действия, чистый ink, тела функций. */
export function variableUsages(project: Project, name: string): Usage[] {
  const out: Usage[] = [];
  for (const f of project.variables.functions) {
    if (f.name !== name && !f.params.includes(name) && mentions(f.body, name)) out.push({ key: "", func: f.name });
  }
  for (const [key, c] of Object.entries(project.canvases)) {
    for (const card of c.cards) {
      if (mentions(card.condition, name) || mentions(card.action, name) || (card.type === "ink" && mentions(card.text, name))) {
        out.push({ key, card: card.id });
      }
    }
    for (const l of c.links) {
      if (mentions(l.condition, name) || mentions(l.action, name)) out.push({ key, link: { from: l.from, to: l.to, ...(l.port ? { port: l.port } : {}) } });
    }
  }
  return out;
}

/** Переименовывает переменную, список или функцию и все упоминания: условия, действия, чистый ink, тела функций. */
export function renameVariable(project: Project, from: string, to: string) {
  if (from === to) return;
  const v = project.variables.vars.find((x) => x.name === from);
  if (v) v.name = to;
  const l = project.variables.lists.find((x) => x.name === from);
  if (l) l.name = to;
  const fn = project.variables.functions.find((x) => x.name === from);
  if (fn) fn.name = to;
  for (const f of project.variables.functions) {
    // параметр с тем же именем перекрывает глобальное — внутри такой функции не трогаем
    if (!f.params.includes(from)) f.body = replaceIdent(f.body, from, to);
  }
  for (const c of Object.values(project.canvases)) {
    for (const card of c.cards) {
      if (card.condition) card.condition = replaceIdent(card.condition, from, to);
      if (card.action) card.action = replaceIdent(card.action, from, to);
      if (card.type === "ink" && card.text) card.text = replaceIdent(card.text, from, to);
    }
    for (const link of c.links) {
      if (link.condition) link.condition = replaceIdent(link.condition, from, to);
      if (link.action) link.action = replaceIdent(link.action, from, to);
    }
  }
}
