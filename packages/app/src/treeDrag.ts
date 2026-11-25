import { canvasLocations, flowCards, qualifiedName, type Project } from '@visink/core';
import type { TreeNode } from './hierarchy';
import type { TreeItem, TreeDestination } from './organization';

const MIME = 'application/x-visink-tree';
let current: { project: Project; items: TreeItem[] } | null = null;
export function treeItem(node: TreeNode): TreeItem | null {
  if (node.kind === 'folder') return { kind: 'folder', id: node.folderId! };
  if (node.kind === 'file') return { kind: 'file', id: node.root! };
  if (node.kind === 'entity') return { kind: 'entity', id: node.owner! };
  if (node.kind === 'card') return { kind: 'card', root: node.root!, path: node.path ?? [], id: node.card! };

  return null;
}
export function treeDestination(node: TreeNode, cards = false): TreeDestination | null {
  if (cards) {
    if (node.kind === 'file' || node.kind === 'root' && node.root) return { root: node.root!, path: [] };
    if (node.kind === 'card' && node.nested) return { root: node.root!, path: [...(node.path ?? []), node.card!] };
    return null;
  }
  if (node.kind === 'folder') return { section: node.section!, folderId: node.folderId };
  if (node.kind === 'root' && node.section) return { section: node.section };
  if (node.kind === 'scope') return { section: 'variables', owner: node.owner };
  return null;
}
export function beginTreeDrag(dt: DataTransfer, project: Project, items: TreeItem[]) {
  current = { project, items }; dt.setData(MIME, '1'); dt.effectAllowed = 'copyMove';
}
export function syncTreeDragProject(project: Project) { if (current) current.project = project; }
export function endTreeDrag() { current = null; }
export function draggedItems(dt: DataTransfer, project: Project): TreeItem[] | null {
  return current?.project === project && dt.types.includes(MIME) ? current.items : null;
}
export function variableDrop(dt: DataTransfer, project: Project): string | null {
  const items = draggedItems(dt, project); const item = items?.length === 1 ? items[0] : null;
  if (item?.kind !== 'var') return null;
  const variable = project.variables.vars.find((v) => v.name === item.name && v.owner === item.owner);
  return variable ? qualifiedName(project, variable) : null;
}
export function jumpDrop(dt: DataTransfer, project: Project): string | null {
  const items = draggedItems(dt, project); const item = items?.length === 1 ? items[0] : null;
  if (item?.kind === 'file') return canvasLocations(project).find(({ canvas }) => canvas.id === item.id)?.canvas.id ?? null;
  if (item?.kind === 'card') {
    const root = project.canvases[item.root];
    const found = root && flowCards(root).find(({ card }) => card.id === item.id);
    if (found) {
      const flow = found.card.flow;
      return flow && flow.legacyId === flow.id ? flow.id : `${found.canvas.legacyId ?? found.canvas.id}.${item.id}`;
    }
  }
  return null;
}

/** A row inside an open container accepts the same drop as that container.
 * Explicit containers win; a rejected nested container never falls back to its parent. */
export function resolveTreeDrop(node: TreeNode, items: TreeItem[], index: { nodes: Map<string, TreeNode>; parents: Map<string, string> }): TreeNode | null {
  const cards = items[0]?.kind === 'card';
  let current: TreeNode | undefined = node;
  while (current) {
    if (treeDestination(current, cards)) return current;
    const parent: string | undefined = index.parents.get(current.id);
    current = parent ? index.nodes.get(parent) : undefined;
  }
  return null;
}
