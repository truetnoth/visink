import { describe, expect, it } from 'vitest';
import { produce } from 'immer';
import { createCanvas, createCard, createProject, loadProject, saveProject, MemoryFs, canvasLocations } from '@visink/core';
import { buildProject } from '@visink/compiler';
import { checkProject } from '@visink/checker';
import { projectHierarchy, indexHierarchy } from '../src/hierarchy';
import { createFolder } from '../src/organization';
import { resolveTreeDrop, treeItem } from '../src/treeDrag';
import { setCardEntry } from '../src/cardEditing';
import { defaultNpc } from '../src/ops';
import { searchProject } from '../src/search';
import { projectStats } from '../src/stats';

function fixture() {
  const p = createProject('Second wave');
  const c = createCanvas('scene', 'Сцена');
  c.cards = [createCard('line', 'line', { speaker: 'ent_narrator', text: 'Hello', entry: 'meeting', emotion: 'calm', status: 'final', note: 'private', tags: { custom: 'old' } }), createCard('jump', 'jump', { target: 'scene.entry_meeting' })];
  c.start = 'line'; p.canvases.scene = c; p.settings.start = 'scene.entry_meeting';
  return p;
}

describe('вторая волна', () => {
  it('экспортирует старые типы сущностей и выбирает их спикерами без изменения ID', () => {
    const p = fixture();
    p.entities = [{ id: 'artifact', name: 'Артефакт', kind: 'item', inkName: 'АРТЕФАКТ', color: '#008bb5', description: 'Помнит прошлое' }];
    p.canvases.scene.owner = 'artifact'; p.canvases.scene.cards[0].speaker = 'artifact';
    expect(defaultNpc(p, p.canvases.scene)).toBe('artifact');
    expect(buildProject(p).manifest.characters.map((e) => e.id)).toEqual(['artifact']);
    expect(searchProject(p, 'Помнит').get('entity')?.[0].id).toBe('artifact');
    expect(checkProject(p).diagnostics.filter((d) => d.severity === 'error')).toEqual([]);
  });
  it('сохраняет описание сущности и скрытые поля карточки при повторном открытии, не меняя Ink', async () => {
    const p = fixture(); p.entities[0].description = 'История героя';
    const before = buildProject(p); const fs = new MemoryFs();
    await saveProject(fs, p); const reopened = await loadProject(fs);
    expect(reopened.entities[0].description).toBe('История героя');
    expect(canvasLocations(reopened).find(({ canvas }) => canvas.id === 'scene')!.canvas.cards.find((card) => card.id === 'line')).toMatchObject({ emotion: 'calm', status: 'final', note: 'private', tags: { custom: 'old' } });
    expect(buildProject(reopened).files).toEqual(before.files);
  });
  it('переименовывает точку входа, сохраняет переходы и запуск; очистка ведёт к самой карточке', () => {
    const p = fixture(); setCardEntry(p, 'scene', 'line', 'again');
    expect(p.settings.start).toBe('scene.entry_again');
    expect(p.canvases.scene.cards[1].target).toBe('scene.entry_again');
    expect(checkProject(p).diagnostics.filter((d) => d.severity === 'error')).toEqual([]);
    setCardEntry(p, 'scene', 'line', '');
    expect(p.settings.start).toBe('scene.line');
    expect(p.canvases.scene.cards[1].target).toBe('scene.line');
    expect(p.canvases.scene.cards[0].entry).toBeUndefined();
    expect(checkProject(p).diagnostics.filter((d) => d.severity === 'error')).toEqual([]);
  });
  it('отклоняет неверные и конфликтующие точки входа атомарно, включая вложенности', () => {
    const p = fixture(); const flow = createCard('flow', 'flow');
    flow.flow!.cards = [createCard('nested', 'hub', { entry: 'reserved' })]; p.canvases.scene.cards.push(flow);
    for (const value of ['reserved', 'bad name']) expect(() => produce(p, (d) => setCardEntry(d, 'scene', 'line', value))).toThrow();
    expect(p.canvases.scene.cards[0].entry).toBe('meeting');
    setCardEntry(p, 'scene', 'nested', 'new_entry');
    expect(flow.flow!.cards[0].entry).toBe('new_entry');
  });
  it('оставляет в дереве только глобальную область и наборы, не теряя содержимое скрытых папок', () => {
    const p = fixture(); const folderId = createFolder(p, 'variables', 'Старые');
    p.variables.vars = [{ name: 'old', type: 'bool', default: false, folderId }];
    p.variables.functions = [{ name: 'fn', params: [], body: '~ return true' }];
    p.variables.lists = [{ name: 'Things', items: ['one'], initial: [] }];
    p.variables.sets = [{ id: 'q', name: 'quest' }];
    const roots = projectHierarchy(p); const index = indexHierarchy(roots);
    expect(roots[0].id).toBe('globals');
    expect(roots[0].children.map((n) => n.id)).toEqual(['scope:q']);
    expect([...index.nodes.values()].some((n) => ['var', 'func', 'list'].includes(n.kind))).toBe(false);
    expect(index.nodes.has(`folder:${folderId}`)).toBe(false);
    expect(searchProject(p, 'old').get('var')?.[0].id).toBe('old');
  });
  it('статистика считает авторский текст и элементы без технических границ', () => {
    const p = createProject('Stats');
    const box = createCard('box', 'flow', { text: 'Название не считается', description: 'Описание блока' });
    box.flow!.cards.push(createCard('nested', 'line', { speaker: 'ent_narrator', text: 'Привет мир' }));
    const hub = createCard('hub', 'hub', { text: 'Тоже не считается' });
    const raw = createCard('raw', 'ink', { text: '-> END' });
    const player = createCard('player', 'line', { speaker: 'ent_player', text: 'Пойду', menuText: 'Да' });
    p.canvases.main.cards.push(box, hub, raw, player);
    p.canvases.main.links.push({ from: 'hub', to: 'player', order: 0, kind: 'divert' });
    p.canvases.main.notes.push({ id: 'note', text: 'Два слова', x: 0, y: 0 });
    expect(projectStats(p)).toMatchObject({ words: 8, elements: 6, lines: 2, playerOptions: 1, hubs: 1, inkCards: 1, notes: 1, flows: 1, links: 1 });
  });
  it('сохраняет пользовательские цвета карточки и заметки при повторном открытии', async () => {
    const p = createProject('Colors');
    p.canvases.main.cards.push(createCard('colored', 'flow', { text: 'Цветной блок', color: '#ef4444' }));
    p.canvases.main.notes.push({ id: 'colored_note', text: 'Цвет', color: '#10b981', x: 0, y: 0 });
    const fs = new MemoryFs();
    await saveProject(fs, p);
    const loaded = await loadProject(fs);
    expect(loaded.canvases.main.cards.find((card) => card.id === 'colored')?.color).toBe('#ef4444');
    expect(loaded.canvases.main.notes.find((note) => note.id === 'colored_note')?.color).toBe('#10b981');
  });
  it('делает главный канвас корнем дерева без дубля файла, заметок и префикса вложенности', () => {
    const p = fixture();
    const container = createCard('container', 'flow', { text: 'Контейнер' });
    p.canvases.main.cards.push(container, createCard('gate', 'condition', { condition: 'true' }), createCard('go', 'jump', { target: 'main.container' }));
    p.canvases.main.notes.push({ id: 'root_note', text: 'Не показывать', x: 0, y: 0 });
    const roots = projectHierarchy(p); const index = indexHierarchy(roots);
    const files = roots.find((node) => node.id === 'files')!;
    expect(files).toMatchObject({ title: 'Second wave', root: 'main', path: [] });
    expect(index.nodes.has('file:main')).toBe(false);
    expect(index.nodes.has('file:scene')).toBe(true);
    expect(index.nodes.has('note:main:root_note')).toBe(false);
    expect(index.nodes.get('card:main:container')?.title).toBe('Контейнер');
    expect(index.nodes.get('card:main:go')?.title).toBe('Переход → Контейнер');
    expect(index.nodes.get('card:main:gate')?.cardType).toBe('condition');
  });
  it('принимает перенос в содержимое папки, отдавая приоритет вложенному контейнеру', () => {
    const p = fixture(); const f = createFolder(p, 'files', 'Сцены'); const inner = createFolder(p, 'files', 'Акт', f);
    p.canvases.scene.folderId = inner;
    const nested = createCard('nested', 'flow'); p.canvases.scene.cards.push(nested);
    const index = indexHierarchy(projectHierarchy(p));
    const file = { kind: 'file' as const, id: 'other' };
    expect(resolveTreeDrop(index.nodes.get('card:scene:line')!, [file], index)?.id).toBe(`folder:${inner}`);
    expect(resolveTreeDrop(index.nodes.get(`folder:${f}`)!, [file], index)?.id).toBe(`folder:${f}`);
    const card = { kind: 'card' as const, id: 'outside', root: 'other', path: [] };
    expect(resolveTreeDrop(index.nodes.get('card:scene:line')!, [card], index)?.id).toBe('file:scene');
    expect(resolveTreeDrop(index.nodes.get('card:scene:nested')!, [card], index)?.id).toBe('card:scene:nested');
    expect(resolveTreeDrop(index.nodes.get('entities')!, [card], index)).toBeNull();
    expect(treeItem(index.nodes.get('globals')!)).toBeNull();
  });
});
