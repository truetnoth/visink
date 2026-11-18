import { describe, expect, it } from 'vitest';
import { produce } from 'immer';
import { createCanvas, createCard, createProject, loadProject, saveProject, MemoryFs } from '@visink/core';
import { buildProject } from '@visink/compiler';
import { checkProject } from '@visink/checker';
import { projectHierarchy, indexHierarchy } from '../src/hierarchy';
import { createFolder } from '../src/organization';
import { resolveTreeDrop, treeItem } from '../src/treeDrag';
import { setCardEntry } from '../src/cardEditing';
import { defaultNpc } from '../src/ops';
import { searchProject } from '../src/search';

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
    expect(reopened.canvases.scene.cards[0]).toMatchObject({ emotion: 'calm', status: 'final', note: 'private', tags: { custom: 'old' } });
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
