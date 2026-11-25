import { describe, it, expect } from 'vitest';
import { produce } from 'immer';
import { createProject, createCanvas, createCard, loadProject, saveProject, serializeProject, MemoryFs, canvasLocations } from '@visink/core';
import { checkProject } from '@visink/checker';
import { createFolder, moveTreeItems, moveCards, renameFolder, deleteFolder, deleteVariableSet, deleteEntity } from '../src/organization';
import { projectHierarchy, indexHierarchy } from '../src/hierarchy';
import { useStore, editAtomic, undo, redo } from '../src/store';
import { beginTreeDrag, draggedItems, variableDrop, jumpDrop, endTreeDrag } from '../src/treeDrag';

function fixture() {
  const p = createProject('Перенос');
  const a = createCanvas('a', 'Первый'), b = createCanvas('b', 'Второй');
  a.cards = [createCard('start', 'hub'), createCard('one', 'line', { text: 'Первая', entry: 'meeting' }), createCard('two', 'line', { text: 'Вторая' }), createCard('jump', 'jump', { target: 'a.entry_meeting' })];
  a.start = 'start'; a.links = [{ from: 'one', to: 'two', order: 0, kind: 'divert', action: 'met = true' }];
  a.layout = { one: { x: 50, y: 20, w: 310, h: 140 }, two: { x: 400, y: 20 } };
  a.groups = [{ title: 'Разговор', cards: ['one', 'two'] }];
  b.cards = [createCard('one', 'hub', { entry: 'meeting' })]; b.start = 'one';
  p.canvases = { a, b }; p.settings.start = 'a.entry_meeting';
  p.variables.vars.push({ name: 'met', type: 'bool', default: false });
  return p;
}

describe('организация проекта', () => {
  it('мигрирует старые группы, сохраняет пустые вложенные папки и точную копию v2', async () => {
    const p = fixture(); p.canvases.a.group = 'Акт/Сцены'; p.entities[0].group = 'Герои'; p.variables.vars[0].group = 'Состояние';
    const fs = new MemoryFs();
    fs.files.set('project.json', JSON.stringify({ ...p.settings, formatVersion: 2 }));
    fs.files.set('canvases/a.canvas.json', JSON.stringify(p.canvases.a));
    fs.files.set('canvases/b.canvas.json', JSON.stringify(p.canvases.b));
    fs.files.set('entities.json', JSON.stringify(p.entities)); fs.files.set('variables.json', JSON.stringify(p.variables));
    const before = new Map(fs.files);
    const loaded = await loadProject(fs);
    expect(loaded.settings.folders?.map((f) => f.name)).toEqual(['Акт', 'Сцены', 'Герои', 'Состояние']);
    const parent = canvasLocations(loaded).find(({ canvas }) => canvas.id === 'a')!.canvas.folderId!;
    const empty = createFolder(loaded, 'files', 'Пустая', parent);
    await saveProject(fs, loaded);
    for (const [path, text] of before) expect(fs.files.get(`.backups/pre-v3/${path}`)).toBe(text);
    const again = await loadProject(fs);
    expect(again.settings.folders?.find((f) => f.id === empty)?.parent).toBe(parent);
    expect(await saveProject(fs, again)).toEqual([]);
    expect(indexHierarchy(projectHierarchy(again)).parents.get('card:main:file_a')).toBe(`folder:${parent}`);
  });
  it('переносит несколько файлов, папки целиком, запрещает циклы и несовместимые разделы', () => {
    let p = fixture(); const f = createFolder(p, 'files', 'Акт'), child = createFolder(p, 'files', 'Сцены', f);
    p = produce(p, (d) => { moveTreeItems(d, [{ kind: 'file', id: 'a' }, { kind: 'file', id: 'b' }], { section: 'files', folderId: child }); });
    expect(Object.values(p.canvases).every((c) => c.folderId === child)).toBe(true);
    expect(() => produce(p, (d) => moveTreeItems(d, [{ kind: 'folder', id: f }], { section: 'files', folderId: child }))).toThrow('внутрь себя');
    expect(() => produce(p, (d) => moveTreeItems(d, [{ kind: 'file', id: 'a' }], { section: 'entities' }))).toThrow();
    p = produce(p, (d) => { renameFolder(d, child, 'Диалоги'); });
    expect(p.canvases.a.id).toBe('a');
    expect(p.settings.folders?.find((f) => f.id === child)?.name).toBe('Диалоги');
  });
  it('каскадно удаляет непустую папку и восстанавливает всё поддерево через undo', () => {
    const p = fixture();
    const parent = createFolder(p, 'files', 'Акт'), child = createFolder(p, 'files', 'Сцены', parent);
    p.canvases.a.folderId = child; p.canvases.b.folderId = child;
    useStore.getState().openInMemory(p);
    useStore.getState().edit((draft) => { draft.settings.name = 'Перед удалением папки'; });
    editAtomic((draft) => deleteFolder(draft, parent));
    expect(useStore.getState().project!.canvases.main.cards.filter((card) => card.type === 'flow')).toEqual([]);
    expect(useStore.getState().project!.settings.folders ?? []).toEqual([]);
    undo();
    const restored = useStore.getState().project!;
    expect(canvasLocations(restored).map(({ canvas }) => canvas.id).sort()).toEqual(['a', 'b', 'main']);
    expect(restored.settings.folders?.map((folder) => folder.id)).toEqual([parent, child]);
    redo();
    expect(useStore.getState().project!.canvases.main.cards.filter((card) => card.type === 'flow')).toEqual([]);
  });
  it('удаляет набор вместе с vars/lists/functions и восстанавливает их через undo', () => {
    const p = fixture();
    p.variables.sets = [{ id: 'q', name: 'quest' }];
    p.variables.vars.push({ name: 'score', owner: 'q', type: 'int', default: 3 });
    p.variables.lists.push({ name: 'Flags', owner: 'q', items: ['a'], initial: [] });
    p.variables.functions.push({ name: 'check', owner: 'q', params: [], body: '~ return true' });
    useStore.getState().openInMemory(p);
    useStore.getState().edit((draft) => { draft.settings.name = 'Перед удалением набора'; });
    editAtomic((draft) => deleteVariableSet(draft, 'q'));
    expect(useStore.getState().project!.variables.sets).toEqual([]);
    expect(useStore.getState().project!.variables.vars.map((v) => v.name)).toEqual(['met']);
    expect(useStore.getState().project!.variables.lists).toEqual([]);
    expect(useStore.getState().project!.variables.functions).toEqual([]);
    undo();
    const restored = useStore.getState().project!;
    expect(restored.variables.sets?.map((set) => set.id)).toEqual(['q']);
    expect(restored.variables.vars.map((v) => v.name).sort()).toEqual(['met', 'score']);
    expect(restored.variables.lists.map((v) => v.name)).toEqual(['Flags']);
    expect(restored.variables.functions.map((v) => v.name)).toEqual(['check']);
  });
  it('блокирует удаление сущности с собственными переменными, LIST и функциями без частичных изменений', () => {
    const p = fixture(), id = p.entities[0].id;
    p.variables.vars.push({ name: 'owned', owner: id, type: 'int', default: 1 });
    p.variables.lists.push({ name: 'Owned', owner: id, items: ['a'], initial: [] });
    p.variables.functions.push({ name: 'owned', owner: id, params: [], body: '~ return true' });
    const before = structuredClone(p);
    expect(() => deleteEntity(p, id)).toThrow('битые ссылки');
    expect(p).toEqual(before);
  });
  it('заменяет удалённого спикера и владельца холста на рассказчика, включая вложенности', () => {
    const p = fixture();
    p.entities.push({ id: 'ent_guest', kind: 'character', name: 'Гость', inkName: 'ГОСТЬ', color: '#fff' });
    p.canvases.a.owner = 'ent_guest';
    p.canvases.a.cards.find((card) => card.id === 'one')!.speaker = 'ent_guest';
    const box = createCard('box', 'flow');
    box.flow!.cards.push(createCard('nested', 'line', { speaker: 'ent_guest', text: 'Внутри' }));
    p.canvases.b.cards.push(box);
    deleteEntity(p, 'ent_guest');
    expect(p.canvases.a.owner).toBe('ent_narrator');
    expect(p.canvases.a.cards.find((card) => card.id === 'one')?.speaker).toBe('ent_narrator');
    expect(p.canvases.b.cards.find((card) => card.id === 'box')?.flow?.cards.find((card) => card.id === 'nested')?.speaker).toBe('ent_narrator');
    expect(p.entities.some((entity) => entity.id === 'ent_guest')).toBe(false);
    expect(checkProject(p).diagnostics.filter((d) => d.severity === 'error')).toEqual([]);
  });
  it('без штатного рассказчика оставляет чистый текст вместо подстановки постороннего NPC', () => {
    const p = fixture();
    p.entities.push({ id: 'ent_other', kind: 'character', name: 'Другой', inkName: 'ДРУГОЙ', color: '#fff' });
    p.canvases.a.owner = 'ent_other';
    p.canvases.a.cards.find((card) => card.id === 'one')!.speaker = 'ent_other';
    deleteEntity(p, 'ent_narrator');
    deleteEntity(p, 'ent_other');
    expect(p.canvases.a.owner).toBeUndefined();
    expect(p.canvases.a.cards.find((card) => card.id === 'one')?.speaker).toBeUndefined();
    expect(p.entities.find((entity) => entity.id === 'ent_player')).toBeDefined();
  });
  it('применяет те же правила при удалении папки сущностей', () => {
    const p = fixture();
    const folder = createFolder(p, 'entities', 'Герои');
    p.entities.push({ id: 'ent_guest', kind: 'character', name: 'Гость', inkName: 'ГОСТЬ', color: '#fff', folderId: folder });
    p.canvases.a.cards.find((card) => card.id === 'one')!.speaker = 'ent_guest';
    deleteFolder(p, folder);
    expect(p.canvases.a.cards.find((card) => card.id === 'one')?.speaker).toBe('ent_narrator');
    expect(p.entities.some((entity) => entity.id === 'ent_guest')).toBe(false);

    const blocked = createFolder(p, 'entities', 'С логикой');
    p.entities.push({ id: 'ent_owned', kind: 'character', name: 'Владелец', inkName: '', color: '#fff', folderId: blocked });
    p.variables.vars.push({ name: 'owned', owner: 'ent_owned', type: 'bool', default: false });
    expect(() => deleteFolder(p, blocked)).toThrow('битые ссылки');
    expect(p.entities.some((entity) => entity.id === 'ent_owned')).toBe(true);
    expect(p.settings.folders?.some((item) => item.id === blocked)).toBe(true);
  });
  it('переносит функции с обновлением вызовов, сохраняя параметры и зависимости исходного набора', () => {
    const p = fixture();
    p.variables.sets = [{ id: 'q', name: 'quest' }, { id: 'r', name: 'other' }];
    p.variables.vars.push({ name: 'score', owner: 'q', type: 'int', default: 3 }, { name: 'score', owner: 'r', type: 'int', default: 9 });
    p.variables.functions.push({ name: 'check', owner: 'q', params: ['value'], body: '~ return score > value' }, { name: 'call', owner: 'q', params: [], body: '~ return check(1)' });
    p.canvases.a.cards[0].condition = 'quest.check(2)';
    const next = produce(p, (d) => { moveTreeItems(d, [{ kind: 'func', name: 'check', owner: 'q' }], { section: 'variables', owner: 'r' }); });
    expect(next.variables.functions[0].owner).toBe('r');
    expect(next.variables.functions[0].body).toBe('~ return quest.score > value');
    expect(next.variables.functions[1].body).toBe('~ return other.check(1)');
    expect(next.canvases.a.cards[0].condition).toBe('other.check(2)');
    expect(checkProject(next).diagnostics.filter((d) => d.severity === 'error')).toEqual([]);
    const global = produce(next, (d) => { moveTreeItems(d, [{ kind: 'func', name: 'check', owner: 'r' }], { section: 'variables' }); });
    expect(global.variables.functions[1].body).toBe('~ return check(1)');
    expect(global.variables.functions[0].body).toBe('~ return quest.score > value');
  });
  it('не меняет параметры функции и атомарно запрещает конфликты имён при переносе', () => {
    const p = fixture(); p.variables.sets = [{ id: 'q', name: 'quest' }];
    p.variables.functions.push({ name: 'test', params: ['met'], body: '~ return met' });
    const next = produce(p, (d) => { moveTreeItems(d, [{ kind: 'func', name: 'test' }], { section: 'variables', owner: 'q' }); });
    expect(next.variables.functions[0].body).toBe('~ return met');
    const collision = produce(p, (d) => { d.variables.vars.push({ name: 'test', owner: 'q', type: 'bool', default: false }); });
    expect(() => produce(collision, (d) => { moveTreeItems(d, [{ kind: 'func', name: 'test' }], { section: 'variables', owner: 'q' }); })).toThrow('имя уже занято');
    expect(p.variables.functions[0].owner).toBeUndefined();
  });
  it('переносит переменные между наборами и папками, атомарно отклоняет пакет при конфликте', () => {
    let p = fixture(); p.variables.sets = [{ id: 'q', name: 'quest' }];
    p.canvases.a.cards[0].condition = 'met';
    p = produce(p, (d) => { moveTreeItems(d, [{ kind: 'var', name: 'met' }], { section: 'variables', owner: 'q' }); });
    expect(p.canvases.a.cards[0].condition).toBe('quest.met');
    expect(p.variables.vars[0].owner).toBe('q');
    p = produce(p, (d) => { const folder = createFolder(d, 'variables', 'Общие'); moveTreeItems(d, [{ kind: 'var', name: 'met', owner: 'q' }], { section: 'variables', folderId: folder }); });
    expect(p.variables.vars[0].owner).toBeUndefined(); expect(p.variables.vars[0].folderId).toBeTruthy();
    expect(p.canvases.a.cards[0].condition).toBe('met');
    expect(() => produce(p, (d) => { moveTreeItems(d, [{ kind: 'var', name: 'met' }, { kind: 'var', name: 'missing' }], { section: 'variables', owner: 'q' }); })).toThrow();
    expect(p.variables.vars[0].owner).toBeUndefined();
  });
});

describe('перенос карточек', () => {
  it('переносит группу со связями, разрешает конфликты ID/входов и обновляет переходы, собирается в Ink', () => {
    const p = fixture();
    const next = produce(p, (d) => { moveCards(d, 'a', [], ['one', 'two'], 'b', []); });
    const b = next.canvases.b;
    expect(b.cards.map((c) => c.id)).toEqual(['one', 'one_2', 'two']);
    expect(b.cards[1].entry).toBe('meeting_2');
    expect(b.links).toEqual([{ from: 'one_2', to: 'two', order: 0, kind: 'divert', action: 'met = true' }]);
    expect(b.layout.one_2.w).toBe(310); expect(b.groups[0].cards).toEqual(['one_2', 'two']);
    expect(next.canvases.a.cards.find((c) => c.id === 'jump')?.target).toBe('b.entry_meeting_2');
    expect(next.settings.start).toBe('b.entry_meeting_2');
    expect(next.canvases.a.graveyard).toContain('one');
    expect(checkProject(next).diagnostics.filter((d) => d.severity === 'error')).toEqual([]);
    expect(p.canvases.a.cards).toHaveLength(4);
  });
  it('атомарно отклоняет внешние связи без частичных изменений', () => {
    const p = fixture();
    expect(() => produce(p, (d) => { moveCards(d, 'a', [], ['one'], 'b', []); })).toThrow('связи');
    expect(p.canvases.b.cards).toHaveLength(1);
  });
  it('сохраняет вложенное содержимое, старт, заметки, группы, ссылки и допускает перенос между слоями', () => {
    const p = fixture(), outer = createCard('outer', 'flow');
    outer.flow!.cards = [createCard('one', 'hub'), createCard('inner', 'jump', { target: 'a.one' })];
    outer.flow!.notes = [{ id: 'n1', text: 'Текст', x: 1, y: 2 }]; outer.flow!.groups = [{ title: 'Внутри', cards: ['one', 'inner'] }];
    outer.flow!.start = 'one'; outer.flow!.links = [{ from: 'one', to: 'inner', order: 0, kind: 'divert' }];
    // Use a valid root with unique IDs.
    p.canvases.a.cards = [createCard('start', 'hub'), outer]; p.canvases.a.links = []; p.settings.start = 'a';
    p.canvases.b.notes = [{ id: 'n1', text: 'Другая', x: 0, y: 0 }];
    const next = produce(p, (d) => { moveCards(d, 'a', [], ['outer'], 'b', []); });
    const inside = next.canvases.b.cards[1].flow!;
    expect(inside.start).toBe('one_2'); expect(inside.links[0].from).toBe('one_2');
    expect(inside.groups[0].cards).toEqual(['one_2', 'inner']);
    expect(inside.notes[0]).toEqual({ id: 'n1_2', text: 'Текст', x: 1, y: 2 });
    expect(inside.cards[1].target).toBe('b.one_2');
    expect(() => produce(next, (d) => { moveCards(d, 'b', [], ['outer'], 'b', ['outer']); })).toThrow('внутрь себя');
    const flat = produce(next, (d) => { moveCards(d, 'b', ['outer'], ['one_2', 'inner'], 'b', []); });
    expect(flat.canvases.b.cards.map((c) => c.id)).toEqual(['one', 'outer', 'one_2', 'inner']);
    expect(flat.canvases.b.cards[1].flow!.cards).toHaveLength(0);
  });
  it('Undo/Redo отменяет весь перенос одним шагом отдельно от соседних правок', () => {
    useStore.getState().openInMemory(fixture());
    useStore.getState().edit((p) => { p.settings.name = 'Перед переносом'; });
    editAtomic((p) => { moveCards(p, 'main', ['file_a'], ['one', 'two'], 'main', ['file_b']); });
    undo(); expect(canvasLocations(useStore.getState().project!).find(({ canvas }) => canvas.id === 'a')!.canvas.cards.filter((card) => !['entry', 'exit'].includes(card.type))).toHaveLength(4);
    expect(useStore.getState().project!.settings.name).toBe('Перед переносом');
    redo(); expect(canvasLocations(useStore.getState().project!).find(({ canvas }) => canvas.id === 'b')!.canvas.cards.filter((card) => !['entry', 'exit'].includes(card.type))).toHaveLength(3);
  });
});

describe('типизированные ссылки', () => {
  it('принимает только совместимые объекты из текущего проекта', () => {
    const p = fixture(); const types: string[] = [];
    const dt = { types, setData: (type: string) => { types.push(type); }, effectAllowed: '' } as unknown as DataTransfer;
    beginTreeDrag(dt, p, [{ kind: 'var', name: 'met' }]);
    expect(variableDrop(dt, p)).toBe('met'); expect(jumpDrop(dt, p)).toBeNull();
    expect(draggedItems(dt, fixture())).toBeNull();
    beginTreeDrag(dt, p, [{ kind: 'card', root: 'a', path: [], id: 'one' }]);
    expect(jumpDrop(dt, p)).toBe('a.one'); expect(variableDrop(dt, p)).toBeNull();
    endTreeDrag(); expect(jumpDrop(dt, p)).toBeNull();
  });
});
