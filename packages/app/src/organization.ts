import { canvasAtPath, flowCards, guessStart, syncEntries, type Project, type Canvas, type Card, type FolderSection } from '@visink/core';
import { moveVariable, moveFunction } from './namespaceOps';
import { replaceIdent } from './ops';

export type TreeItem =
  | { kind: 'folder'; id: string }
  | { kind: 'file'; id: string }
  | { kind: 'entity'; id: string }
  | { kind: 'var' | 'func' | 'list'; name: string; owner?: string }
  | { kind: 'card'; root: string; path: string[]; id: string };
export type TreeDestination = { section: FolderSection; folderId?: string; owner?: string } | { root: string; path: string[] };

export function createFolder(p: Project, section: FolderSection, name: string, parent?: string) {
  name = name.trim();
  if (!name) throw new Error('Введите название папки');
  const folders = p.settings.folders ??= [];
  if (parent && !folders.some((f) => f.id === parent && f.section === section)) throw new Error('Папка назначения не найдена');
  if (folders.some((f) => f.section === section && f.parent === parent && f.name === name)) throw new Error('Папка с таким названием уже существует');
  let n = 1; while (folders.some((f) => f.id === `folder_${n}`)) n++;
  const id = `folder_${n}`; folders.push({ id, name, section, ...(parent ? { parent } : {}) }); return id;
}
export function renameFolder(p: Project, id: string, name: string) {
  const f = p.settings.folders?.find((f) => f.id === id); name = name.trim();
  if (!f || !name) throw new Error('Введите название папки');
  if (p.settings.folders?.some((other) => other.id !== id && other.section === f.section && other.parent === f.parent && other.name === name)) throw new Error('Папка с таким названием уже существует');
  f.name = name;
}
function deleteOwnedMembers(p: Project, owners: Set<string>) {
  p.variables.vars = p.variables.vars.filter((v) => !v.owner || !owners.has(v.owner));
  p.variables.lists = p.variables.lists.filter((v) => !v.owner || !owners.has(v.owner));
  p.variables.functions = p.variables.functions.filter((v) => !v.owner || !owners.has(v.owner));
}

export function deleteEntity(p: Project, id: string) {
  p.entities = p.entities.filter((entity) => entity.id !== id);
  deleteOwnedMembers(p, new Set([id]));
}

export function deleteVariableSet(p: Project, id: string) {
  p.variables.sets = p.variables.sets?.filter((set) => set.id !== id);
  deleteOwnedMembers(p, new Set([id]));
}

export function deleteFolder(p: Project, id: string) {
  const folders = p.settings.folders ?? [];
  const folder = folders.find((f) => f.id === id);
  if (!folder) return;
  const removed = new Set<string>();
  const collect = (parent: string) => {
    if (removed.has(parent)) return;
    removed.add(parent);
    folders.filter((f) => f.parent === parent).forEach((f) => collect(f.id));
  };
  collect(id);
  if (folder.section === 'files') for (const [key, canvas] of Object.entries(p.canvases)) if (canvas.folderId && removed.has(canvas.folderId)) delete p.canvases[key];
  const entities = new Set(p.entities.filter((entity) => entity.folderId && removed.has(entity.folderId)).map((entity) => entity.id));
  if (folder.section === 'entities') p.entities = p.entities.filter((entity) => !entities.has(entity.id));
  deleteOwnedMembers(p, entities);
  p.variables.vars = p.variables.vars.filter((v) => !v.folderId || !removed.has(v.folderId));
  p.variables.lists = p.variables.lists.filter((v) => !v.folderId || !removed.has(v.folderId));
  p.variables.functions = p.variables.functions.filter((v) => !v.folderId || !removed.has(v.folderId));
  p.settings.folders = folders.filter((f) => !removed.has(f.id));
}

/** Mutates an Immer draft. The caller commits the whole operation or nothing. */
export function moveTreeItems(p: Project, items: TreeItem[], dest: TreeDestination): string[] {
  if (!items.length) throw new Error('Ничего не выбрано');
  if ('root' in dest) {
    if (!items.every((i) => i.kind === 'card')) throw new Error('В холст можно перенести только карточки');
    const cards = items as Extract<TreeItem, { kind: 'card' }>[]; const first = cards[0];
    if (cards.some((c) => c.root !== first.root || c.path.join('/') !== first.path.join('/'))) throw new Error('Выберите карточки одного холста');
    return moveCards(p, first.root, first.path, cards.map((c) => c.id), dest.root, dest.path);
  }
  const folders = p.settings.folders ?? [];
  if (dest.folderId && !folders.some((f) => f.id === dest.folderId && f.section === dest.section)) throw new Error('Несовместимая папка');
  if (dest.owner && dest.section !== 'variables') throw new Error('Несовместимая область');
  // A parent folder carries its children; skip any selected descendants.
  const selectedFolders = new Set(items.filter((i) => i.kind === 'folder').map((i) => i.id));
  const underSelected = (id?: string) => { const seen = new Set<string>(); while (id && !seen.has(id)) { if (selectedFolders.has(id)) return true; seen.add(id); id = folders.find((f) => f.id === id)?.parent; } return false; };
  for (const item of items) {
    if (item.kind === 'card') throw new Error('Карточки переносятся в файлы или вложенности');
    if (item.kind === 'folder') {
      const f = folders.find((f) => f.id === item.id);
      if (!f || f.section !== dest.section || dest.owner) throw new Error('Папки разных разделов несовместимы');
      if (dest.folderId === f.id || underSelected(dest.folderId)) throw new Error('Нельзя поместить папку внутрь себя');
      if (underSelected(f.parent)) continue;
      if (folders.some((other) => other.id !== f.id && other.section === f.section && other.parent === dest.folderId && other.name === f.name)) throw new Error('В целевой папке уже есть папка с таким названием');
      f.parent = dest.folderId; continue;
    }
    if (item.kind === 'file' || item.kind === 'entity') {
      if (dest.section !== (item.kind === 'file' ? 'files' : 'entities')) throw new Error('Эти разделы несовместимы');
      const value = item.kind === 'file' ? p.canvases[item.id] : p.entities.find((e) => e.id === item.id);
      if (!value) throw new Error('Элемент не найден');
      if (!underSelected(value.folderId)) value.folderId = dest.folderId;
      continue;
    }
    if (dest.section !== 'variables') throw new Error('Переменные переносятся только в раздел переменных');
    const collection = item.kind === 'var' ? p.variables.vars : item.kind === 'func' ? p.variables.functions : p.variables.lists;
    const value = collection.find((v) => v.name === item.name && v.owner === item.owner);
    if (!value) throw new Error('Элемент не найден');
    if (underSelected(value.folderId)) continue;
    if (item.owner !== dest.owner) {
      if (item.kind === 'list') throw new Error('LIST нельзя переносить между областями');
      if (item.owner && p.entities.some((e) => e.id === item.owner)) throw new Error('Переменные сущности остаются внутри сущности');
      (item.kind === 'func' ? moveFunction : moveVariable)(p, item.name, item.owner, dest.owner);
    }
    value.folderId = dest.owner ? undefined : dest.folderId;
  }
  return [];
}

export function moveCards(p: Project, sourceKey: string, sourcePath: string[], ids: string[], targetKey: string, targetPath: string[]): string[] {
  const sourceRoot = p.canvases[sourceKey], targetRoot = p.canvases[targetKey];
  const source = sourceRoot && canvasAtPath(sourceRoot, sourcePath), target = targetRoot && canvasAtPath(targetRoot, targetPath);
  if (!source || !target) throw new Error('Холст не найден');
  if (source === target) throw new Error('Карточки уже находятся на этом холсте');
  const selected = new Set(ids);
  const moving = source.cards.filter((c) => selected.has(c.id));
  if (moving.length !== selected.size || !moving.length) throw new Error('Карточки не найдены');
  const all: Card[] = moving.flatMap((c) => [c, ...(c.flow ? flowCards(c.flow).map((x) => x.card) : [])]);
  const movedIds = new Set(all.map((c) => c.id));
  if (sourceRoot === targetRoot && targetPath.some((id) => movedIds.has(id))) throw new Error('Нельзя переместить карточку внутрь себя');
  if (!sourcePath.length && selected.has(source.start ?? guessStart(source)?.id ?? '')) throw new Error('Сначала назначьте другое начало исходного файла');
  if (source.links.some((l) => selected.has(l.from) !== selected.has(l.to))) throw new Error('Есть связи с оставшимися карточками. Перенесите связанные карточки вместе или удалите внешние связи');
  const sameRoot = sourceRoot === targetRoot;
  const taken = new Set<string>();
  const collectIds = (c: Canvas) => { c.graveyard.forEach((id) => taken.add(id)); c.notes.forEach((n) => taken.add(n.id)); for (const card of c.cards) { if (!sameRoot || !movedIds.has(card.id)) taken.add(card.id); if (card.flow) collectIds(card.flow); } };
  collectIds(targetRoot);
  for (const { card } of flowCards(targetRoot)) if (card.entry && (!sameRoot || !movedIds.has(card.id))) taken.add(`entry_${card.entry}`);
  const mapping = new Map<string, string>();
  const allocate = (id: string) => { let next = id; for (let n = 2; taken.has(next); n++) next = `${id}_${n}`; taken.add(next); return next; };
  // Reserve unchanged names first so renamed IDs cannot steal another moving ID.
  for (const c of all) if (!taken.has(c.id)) { mapping.set(c.id, c.id); taken.add(c.id); }
  for (const c of all) if (!mapping.has(c.id)) mapping.set(c.id, allocate(c.id));
  const entries = new Set(flowCards(targetRoot).filter(({ card }) => !sameRoot || !movedIds.has(card.id)).map(({ card }) => card.entry).filter(Boolean));
  const addresses = new Map<string, string>();
  for (const c of all) addresses.set(`${sourceRoot.id}.${c.id}`, `${targetRoot.id}.${mapping.get(c.id)!}`);
  for (const c of all) {
    if (c.entry) {
      let entry = c.entry; for (let n = 2; entries.has(entry) || taken.has(`entry_${entry}`); n++) entry = `${c.entry}_${n}`;
      entries.add(entry);
      addresses.set(`${sourceRoot.id}.${c.entry}`, `${targetRoot.id}.entry_${entry}`);
      addresses.set(`${sourceRoot.id}.entry_${c.entry}`, `${targetRoot.id}.entry_${entry}`);
      c.entry = entry;
    }
  }
  const mapId = (id: string) => mapping.get(id) ?? id;
  const remapCanvas = (c: Canvas) => {
    c.start = c.start ? mapId(c.start) : undefined;
    c.links.forEach((l) => { l.from = mapId(l.from); l.to = mapId(l.to); });
    c.layout = Object.fromEntries(Object.entries(c.layout).map(([id, pos]) => [mapId(id), pos]));
    c.groups.forEach((g) => { g.cards = g.cards.map(mapId); });
    for (const note of c.notes) if (!sameRoot) note.id = allocate(note.id);
    for (const card of c.cards) { card.id = mapId(card.id); if (card.flow) remapCanvas(card.flow); }
    c.entries = syncEntries(c).entries;
  };
  const links = source.links.filter((l) => selected.has(l.from) && selected.has(l.to));
  source.links = source.links.filter((l) => !selected.has(l.from) && !selected.has(l.to));
  const maxX = Math.max(-360, ...Object.values(target.layout).map((at) => at.x));
  const minX = Math.min(...moving.map((c) => source.layout[c.id]?.x ?? 0));
  const groups = source.groups.map((g) => ({ title: g.title, cards: g.cards.filter((id) => selected.has(id)).map(mapId) })).filter((g) => g.cards.length);
  source.groups = source.groups.map((g) => ({ ...g, cards: g.cards.filter((id) => !selected.has(id)) })).filter((g) => g.cards.length);
  source.cards = source.cards.filter((c) => !selected.has(c.id));
  const result: string[] = [];
  for (const card of moving) {
    const oldId = card.id; const at = source.layout[oldId] ?? { x: 0, y: 0 };
    card.id = mapId(oldId); result.push(card.id);
    if (card.flow) remapCanvas(card.flow);
    target.cards.push(card); target.layout[card.id] = { ...at, x: at.x - minX + maxX + 360 };
    delete source.layout[oldId];
  }
  target.links.push(...links.map((l) => ({ ...l, from: mapId(l.from), to: mapId(l.to) })));
  target.groups.push(...groups);
  if (!sameRoot) source.graveyard.push(...[...movedIds].filter((id) => !source.graveyard.includes(id)));
  if (source.start && selected.has(source.start)) source.start = guessStart(source)?.id;
  target.start ??= guessStart(target)?.id;
  source.entries = syncEntries(source).entries; target.entries = syncEntries(target).entries;
  // One-pass token replacement avoids chained replacements when IDs collide.
  const rewrite = (text: string) => {
    const placeholders = new Map<string, string>(); let out = text; let i = 0;
    for (const [from, to] of addresses) { const temp = `__visink_move_${i++}__`; out = replaceIdent(out, from, temp); placeholders.set(temp, to); }
    for (const [temp, to] of placeholders) out = replaceIdent(out, temp, to);
    return out;
  };
  if (p.settings.start) p.settings.start = addresses.get(p.settings.start) ?? p.settings.start;
  for (const root of Object.values(p.canvases)) for (const { card } of flowCards(root)) {
    if (card.target) card.target = addresses.get(card.target.trim()) ?? card.target;
    if (card.condition) card.condition = rewrite(card.condition);
    if (card.action) card.action = rewrite(card.action);
    if (card.type === 'ink' && card.text) card.text = rewrite(card.text);
  }
  const rewriteLinks = (c: Canvas) => { for (const l of c.links) { if (l.condition) l.condition = rewrite(l.condition); if (l.action) l.action = rewrite(l.action); } c.cards.forEach((c) => { if (c.flow) rewriteLinks(c.flow); }); };
  Object.values(p.canvases).forEach(rewriteLinks);
  p.variables.functions.forEach((f) => { f.body = rewrite(f.body); });
  return result;
}
