import { memo, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { produce } from 'immer';
import { Braces, ChevronDown, ChevronRight, FileText, Folder, FolderCog, Layers, List, MessageSquare, Pencil, Settings, StickyNote, Trash2, Users, Variable } from 'lucide-react';
import { canvasAtPath, isValidInkName, namespaceError, type CardType, type Project } from '@visink/core';
import { editAtomic, useStore } from '../store';
import { addCanvas, addCard, addNote, defaultNpc } from '../ops';
import { addVariableSet, renameNamespace } from '../namespaceOps';
import { cardTreeId, indexHierarchy, logicTreeId, projectHierarchy, type TreeNode } from '../hierarchy';
import { createFolder, deleteEmptyFolder, moveTreeItems, renameFolder, type TreeItem } from '../organization';
import { beginTreeDrag, draggedItems, endTreeDrag, treeDestination, treeItem, resolveTreeDrop } from '../treeDrag';
import { CreateMenu, type MenuItem } from '../canvas/menus';
import { TYPE_ICON, TYPE_LABEL } from '../canvas/constants';
import { COLORS } from './fields';

const icons = { root: Folder, folder: Folder, scope: Variable, entity: Users, file: FileText, card: MessageSquare, note: StickyNote, group: Layers, var: Variable, list: List, func: Braces };
type Events = {
  activate: (node: TreeNode, event: React.MouseEvent | React.KeyboardEvent) => void;
  context: (node: TreeNode, x: number, y: number) => void;
  drag: (node: TreeNode, event: React.DragEvent) => void;
  over: (node: TreeNode, event: React.DragEvent) => void;
  drop: (node: TreeNode, event: React.DragEvent) => void;
};
const Branch = memo(function Branch({ node, expanded, selected, dropTarget, toggle, events }: { node: TreeNode; expanded: Set<string>; selected: Set<string>; dropTarget: string; toggle: (id: string) => void; events: Events }) {
  const open = expanded.has(node.id), Icon = node.id === "globals" ? Folder : icons[node.kind];
  return <li className="tree-branch" onDragOver={(e) => events.over(node, e)} onDrop={(e) => events.drop(node, e)}>
    <div className={`tree-row ${selected.has(node.id) ? 'on' : ''} ${dropTarget === node.id ? 'tree-drop-target' : ''}`} data-tree-id={node.id} role="button" tabIndex={0} title={node.title} aria-current={selected.has(node.id) ? 'true' : undefined}
      draggable={!!treeItem(node)} onDragStart={(e) => events.drag(node, e)} onDragEnd={endTreeDrag} onDragOver={(e) => events.over(node, e)} onDrop={(e) => events.drop(node, e)}
      onContextMenu={(e) => { e.preventDefault(); e.stopPropagation(); events.context(node, e.clientX, e.clientY); }}
      onClick={(e) => events.activate(node, e)} onDoubleClick={() => { if (node.kind === 'file') useStore.getState().openEditor(); }}
      onKeyDown={(e) => {
        if (e.target !== e.currentTarget) return;
        if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); events.activate(node, e); }
        if (e.key === 'ArrowRight' && !open || e.key === 'ArrowLeft' && open) { e.preventDefault(); toggle(node.id); }
        if (e.key === 'ContextMenu' || e.key === 'F10' && e.shiftKey) { e.preventDefault(); const r = e.currentTarget.getBoundingClientRect(); events.context(node, r.left, r.bottom); }
      }}>
      {node.children.length || node.kind === 'folder' ? <button className="tree-toggle" aria-label={`${open ? 'Свернуть' : 'Развернуть'}: ${node.title}`} aria-expanded={open} onClick={(e) => { e.stopPropagation(); toggle(node.id); }}>{open ? <ChevronDown size={12} /> : <ChevronRight size={12} />}</button> : <span className="tree-toggle-spacer" />}
      <Icon size={13} className="tree-type-icon" /><span className="ellipsis">{node.title}</span>
    </div>
    {open && node.children.length > 0 && <ul className="tree nested-tree">{node.children.map((child) => <Branch key={child.id} node={child} expanded={expanded} selected={selected} dropTarget={dropTarget} toggle={toggle} events={events} />)}</ul>}
  </li>;
});

export function ProjectTree() {
  const project = useStore((s) => s.project)!;
  const active = useStore((s) => s.activeCanvas), path = useStore((s) => s.flowPath), selection = useStore((s) => s.selection);
  const entity = useStore((s) => s.selectedEntity), inspect = useStore((s) => s.inspect), owner = useStore((s) => s.logicOwner), view = useStore((s) => s.view);
  const nodes = useMemo(() => projectHierarchy(project), [project]);
  const index = useMemo(() => indexHierarchy(nodes), [nodes]);
  const [expanded, setExpanded] = useState(() => new Set(['variables', 'globals', 'files', 'entities']));
  const [picked, setPicked] = useState<string[]>([]);
  const anchor = useRef('');
  const [error, setError] = useState(''), [dropTarget, setDropTarget] = useState('');
  const [menu, setMenu] = useState<{ node: TreeNode; x: number; y: number } | null>(null);
  const [prompt, setPrompt] = useState<{ title: string; value: string; apply: (name: string) => void } | null>(null);
  const [promptError, setPromptError] = useState('');
  const ref = useRef<HTMLDivElement>(null);
  let base = view === 'logic' ? owner ? `scope:${owner}` : 'globals' : view === 'characters' && entity ? `entity:${entity}` : active ? `file:${active}` : '';
  if (inspect) base = inspect.owner ? project.entities.some((e) => e.id === inspect.owner) ? `entity:${inspect.owner}` : `scope:${inspect.owner}` : 'globals';
  else if (view === 'canvas' && active) {
    if (selection.length === 1) base = index.nodes.has(cardTreeId(active, selection[0])) ? cardTreeId(active, selection[0]) : `note:${active}:${selection[0]}`;
    else if (path.length) base = cardTreeId(active, path[path.length - 1]);
  }
  useEffect(() => { setPicked([]); }, [base, selection]);
  const selected = useMemo(() => new Set(picked.length ? picked : view === 'canvas' && active && selection.length > 1 ? selection.map((id) => cardTreeId(active, id)) : [base]), [picked, base, view, active, selection]);
  const focusNonce = useStore((s) => s.focus?.nonce ?? 0);
  const revealKey = `${focusNonce}|${base}|${[...selected].join(',')}`;
  const lastReveal = useRef('');
  const skipReveal = useRef(false);
  useEffect(() => {
    if (skipReveal.current) { skipReveal.current = false; lastReveal.current = revealKey; return; }
    if (lastReveal.current === revealKey) return;
    lastReveal.current = revealKey;
    setExpanded((old) => { const next = new Set(old); for (const id of selected) { let parent = index.parents.get(id); while (parent) { next.add(parent); parent = index.parents.get(parent); } } return next.size === old.size ? old : next; });
    const frame = requestAnimationFrame(() => ref.current?.querySelector<HTMLElement>(`[data-tree-id="${CSS.escape(base)}"]`)?.scrollIntoView({ block: 'nearest' }));
    return () => cancelAnimationFrame(frame);
  }, [base, index, selected, revealKey]);
  const toggle = useCallback((id: string) => setExpanded((old) => { const next = new Set(old); if (next.has(id)) next.delete(id); else next.add(id); return next; }), []);
  const open = (node: TreeNode) => {
    const st = useStore.getState();
    if (node.kind === 'root' || node.kind === 'folder') { toggle(node.id); setPicked([node.id]); return; }
    if (node.kind === 'scope') { st.selectLogicScope(node.owner ?? null); return; }
    if (node.kind === 'entity') { st.selectEntity(node.owner!); return; }
    if (node.kind === 'var' || node.kind === 'list' || node.kind === 'func') { st.inspectVariable(node.kind, node.name!, node.owner); return; }
    if (!node.root) return;
    st.setActiveCanvas(node.root, node.path);
    if (node.kind === 'file') return;
    if (node.kind === 'group') { st.setSelection(node.members ?? []); return; }
    st.setSelection([node.card!]);
    useStore.setState({ focus: { canvas: node.root, card: node.card!, nonce: Date.now() } });
    if (node.kind === 'note') st.openEditor();
  };
  const dragCache = useRef<{ project: Project; items: TreeItem[]; results: Map<string, string> } | null>(null);
  const canDrop = (node: TreeNode, items: TreeItem[]) => {
    if (dragCache.current?.project !== project || dragCache.current.items !== items) dragCache.current = { project, items, results: new Map() };
    const cache = dragCache.current.results;
    if (cache.has(node.id)) return cache.get(node.id)!;
    let result = '';
    try {
      const dest = treeDestination(node, items[0]?.kind === 'card');
      if (!dest) throw new Error('Нельзя перенести сюда');
      produce(project, (p) => { moveTreeItems(p, items, dest); });
    } catch (e) { result = (e as Error).message; }
    cache.set(node.id, result); return result;
  };
  const events: Events = {
    activate(node, e) {
      setMenu(null); setError('');
      if (e.ctrlKey || e.metaKey) { const next = new Set(selected); if (next.has(node.id)) next.delete(node.id); else next.add(node.id); setPicked([...next]); anchor.current = node.id; return; }
      if (e.shiftKey && anchor.current) {
        const visible: string[] = []; const walk = (n: TreeNode) => { visible.push(n.id); if (expanded.has(n.id)) n.children.forEach(walk); }; nodes.forEach(walk);
        const a = visible.indexOf(anchor.current), b = visible.indexOf(node.id);
        if (a >= 0 && b >= 0) { setPicked(visible.slice(Math.min(a, b), Math.max(a, b) + 1)); return; }
      }
      setPicked([]); anchor.current = node.id; open(node);
    },
    context(node, x, y) { setMenu({ node, x, y }); setError(''); },
    drag(node, e) {
      const ids = selected.has(node.id) ? [...selected] : [node.id];
      const items = ids.map((id) => index.nodes.get(id)).map((n) => n && treeItem(n)).filter((i): i is TreeItem => !!i);
      if (!items.length || items.length !== ids.length) { e.preventDefault(); return; }
      beginTreeDrag(e.dataTransfer, project, items); setMenu(null); setPicked(ids); setError('');
    },
    over(node, e) {
      const items = draggedItems(e.dataTransfer, project); if (!items) return;
      e.preventDefault(); e.stopPropagation(); const target = resolveTreeDrop(node, items, index);
      const why = !target || canDrop(target, items);
      e.dataTransfer.dropEffect = why ? 'none' : 'move'; setDropTarget(why ? '' : target!.id);
    },
    drop(node, e) {
      const items = draggedItems(e.dataTransfer, project); if (!items) return;
      e.preventDefault(); e.stopPropagation(); setDropTarget('');
      const target = resolveTreeDrop(node, items, index);
      if (!target || canDrop(target, items)) { endTreeDrag(); return; }
      const dest = treeDestination(target, items[0]?.kind === 'card')!;
      try {
        skipReveal.current = true;
        let ids: string[] = []; editAtomic((p) => { ids = moveTreeItems(p, items, dest); });
        setPicked([]); setError('');
        if ('root' in dest) { useStore.getState().setActiveCanvas(dest.root, dest.path); useStore.getState().setSelection(ids); }
      } catch { skipReveal.current = false; /* Rejected drops are indicated only by the native forbidden cursor. */ }
      endTreeDrag();
    },
  };
  const ask = (title: string, value: string, apply: (name: string) => void) => { setPromptError(''); setPrompt({ title, value, apply }); };
  const menuItems = (): MenuItem[] => {
    if (!menu) return [];
    const n = menu.node, items: MenuItem[] = [];
    const parent = index.parents.get(n.id); const context = treeDestination(n) ?? (parent ? treeDestination(index.nodes.get(parent)!) : null);
    const place = (n.kind === 'var' || n.kind === 'func' || n.kind === 'list') && n.owner ? { section: 'variables' as const, owner: n.owner } : context && 'section' in context ? context : null;
    if (place && place.section !== 'variables' && !place.owner) items.push({ label: 'Создать папку', icon: Folder, run: () => ask('Название папки', 'Новая папка', (name) => {
      let id = ''; editAtomic((p) => { id = createFolder(p, place.section, name, place.folderId); }); setPicked([`folder:${id}`]); setExpanded((old) => new Set([...old, n.id]));
    }) });
    if (n.kind === 'folder') {
      items.push({ label: 'Переименовать папку', icon: Pencil, run: () => ask('Название папки', n.title, (name) => editAtomic((p) => renameFolder(p, n.folderId!, name))) });
      items.push({ label: 'Удалить пустую папку', icon: Trash2, run: () => editAtomic((p) => deleteEmptyFolder(p, n.folderId!)) });
    }
    if (place?.section === 'files') items.push({ label: 'Создать файл', icon: FileText, run: () => ask('Название файла', 'Новый файл', (name) => {
      let id = ''; editAtomic((p) => { id = addCanvas(p, name); p.canvases[id].folderId = place.folderId; }); useStore.getState().setActiveCanvas(id);
    }) });
    if (place?.section === 'entities') items.push({ label: 'Создать сущность', icon: Users, run: () => ask('Название сущности', 'Новая сущность', (name) => {
      let id = ''; editAtomic((p) => {
        const used = new Set([...p.entities.map((e) => e.id), ...(p.variables.sets ?? []).map((s) => s.id)]);
        let i = 1; while (used.has(`ent_${i}`)) i++; id = `ent_${i}`;
        let technicalName = id; for (let j = 2; namespaceError(p, technicalName); j++) technicalName = `${id}_${j}`;
        p.entities.push({ id, technicalName, name, kind: 'character', inkName: '', color: COLORS[p.entities.length % COLORS.length], folderId: place.folderId });
      }); useStore.getState().selectEntity(id);
    }) });
    const variableOwner = n.kind === 'entity' ? n.owner : place?.owner;
    if (place?.section === 'variables' || n.kind === 'entity') {
      if (!variableOwner) items.push({ label: 'Создать набор', icon: Variable, run: () => ask('Имя набора', 'new_set', (name) => {
        let id = ''; editAtomic((p) => { id = addVariableSet(p); renameNamespace(p, id, name); }); useStore.getState().selectLogicScope(id);
      }) });
      items.push({ label: 'Создать переменную', icon: Variable, run: () => ask('Имя переменной', 'new_variable', (name) => {
        editAtomic((p) => {
          if (!isValidInkName(name) || [...p.variables.vars, ...p.variables.lists, ...p.variables.functions].some((v) => v.owner === variableOwner && v.name === name) || (!variableOwner && namespaceError(p, name))) throw new Error('Имя занято или недопустимо');
          p.variables.vars.push({ name, owner: variableOwner, type: 'bool', default: false, folderId: variableOwner ? undefined : place?.folderId });
        }); useStore.getState().inspectVariable('var', name, variableOwner);
      }) });
    }
    const canvasDest = n.kind === 'file' ? { root: n.root!, path: [] } : n.root && n.kind !== 'folder' ? { root: n.root, path: n.kind === 'card' && n.nested ? [...(n.path ?? []), n.card!] : n.path ?? [] } : null;
    if (canvasDest) {
      for (const type of ['line', 'hub', 'condition', 'jump', 'flow', 'ink'] as CardType[]) items.push({ label: `Создать: ${TYPE_LABEL[type]}`, icon: TYPE_ICON[type], run: () => {
        let id = ''; editAtomic((p) => {
          const root = p.canvases[canvasDest.root], c = canvasAtPath(root, canvasDest.path)!;
          const x = Math.max(-360, ...Object.values(c.layout).map((at) => at.x)) + 360;
          const card = addCard(c, type, { x, y: 0 }, type === 'line' ? { speaker: defaultNpc(p, c) } : {}, root); id = card.id; c.start ??= id;
        }); useStore.getState().focusCard(canvasDest.root, id);
      } });
      items.push({ label: 'Создать заметку', icon: StickyNote, run: () => {
        let id = ''; editAtomic((p) => { const root = p.canvases[canvasDest.root]; id = addNote(canvasAtPath(root, canvasDest.path)!, { x: 0, y: 0 }, root).id; });
        useStore.getState().setActiveCanvas(canvasDest.root, canvasDest.path); useStore.getState().setSelection([id]);
      } });
    }
    return items;
  };
  return <div className="project-tree" ref={ref} onDragLeave={(e) => { if (!e.currentTarget.contains(e.relatedTarget as Node | null)) setDropTarget(''); }}>
    <button className="tree-root" onClick={() => { useStore.getState().setActiveCanvas(null); useStore.getState().openEditor(); }}><Settings size={15} />Настройки проекта</button>
    <ul className="tree">{nodes.map((node) => <Branch key={node.id} node={node} expanded={expanded} selected={selected} dropTarget={dropTarget} toggle={toggle} events={events} />)}</ul>
    {error && <div className="tree-error" role="alert">{error}<button aria-label="Закрыть сообщение" onClick={() => setError('')}>×</button></div>}
    {menu && createPortal(<CreateMenu menu={{ ...menu, x: Math.min(menu.x, window.innerWidth - 280), y: Math.min(menu.y, window.innerHeight - 440), at: { x: 0, y: 0 } }} items={menuItems()} onClose={() => setMenu(null)} onPick={(item) => { setMenu(null); try { item.run?.(); } catch (e) { setError((e as Error).message); } }} />, document.body)}
    {prompt && createPortal(<div className="modal-backdrop" onMouseDown={(e) => { if (e.target === e.currentTarget) setPrompt(null); }}><form className="modal tree-prompt" role="dialog" aria-label={prompt.title} onKeyDown={(e) => { e.stopPropagation(); if (e.key === 'Escape') setPrompt(null); }} onSubmit={(e) => { e.preventDefault(); try { if (!prompt.value.trim()) throw new Error('Введите название'); prompt.apply(prompt.value.trim()); setPrompt(null); } catch (err) { setPromptError((err as Error).message); } }}>
      <label className="field">{prompt.title}<input autoFocus value={prompt.value} onFocus={(e) => e.currentTarget.select()} onChange={(e) => setPrompt({ ...prompt, value: e.target.value })} /></label>
      {promptError && <p role="alert" className="bad">{promptError}</p>}<div className="row"><button type="button" onClick={() => setPrompt(null)}>Отмена</button><button className="primary" type="submit">Сохранить</button></div>
    </form></div>, document.body)}
  </div>;
}
