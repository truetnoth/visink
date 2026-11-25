import { type Canvas, type Project, type FolderSection, type CardType, isBoundaryCard } from "@visink/core";
import { projectCardLabels, jumpDestination } from "./cardLabels";

export interface TreeNode {
  id: string;
  title: string;
  kind: "root" | "folder" | "scope" | "entity" | "file" | "card" | "group" | "var" | "list" | "func";
  children: TreeNode[];
  root?: string;
  path?: string[];
  card?: string;
  cardType?: CardType;
  owner?: string;
  name?: string;
  members?: string[];
  section?: FolderSection;
  folderId?: string;
  nested?: boolean;
  group?: number;
}
export const cardTreeId = (root: string, id: string, path: string[] = []) => `card:${root}:${path.length ? `${path.join("/")}:` : ""}${id}`;
export const logicTreeId = (kind: string, name: string, owner?: string) => `logic:${kind}:${owner ?? ""}:${name}`;
const title = (text: string) => text.replace(/\s+/g, " ").slice(0, 100);

/** Производное дерево: данные объектов и графа не копируются в формат проекта. */
export function projectHierarchy(project: Project): TreeNode[] {
  const node = (id: string, label: string, kind: TreeNode["kind"], extra: Partial<TreeNode> = {}): TreeNode => ({ id, title: label, kind, children: [], ...extra });
  const { describeCard, targets } = projectCardLabels(project);
  const canvasNodes = (canvas: Canvas, root: string, path: string[]): TreeNode[] => {
    const cards = canvas.cards.filter((c) => !isBoundaryCard(c)).map((c) => {
      const base = { root, path, card: c.id, cardType: c.type };
      const id = cardTreeId(root, c.id, path);
      const label = c.type === "jump"
        ? `Переход → ${jumpDestination(targets, c.target)}`
        : describeCard(c);
      const row = node(id, title(label), "card", { ...base, nested: !!c.flow, ...(path.length === 0 && c.flow?.folderId ? { folderId: c.flow.folderId } : {}) });
      if (c.flow) row.children.push(...canvasNodes(c.flow, root, [...path, c.id]));
      return row;
    });
    return [...cards,
      ...canvas.groups.map((g, i) => node(`group:${root}:${path.join("/")}:${i}`, `${g.title} (${g.cards.length})`, "group", { root, path, members: g.cards, group: i })),
    ];
  };
  const organized = (items: TreeNode[], section: FolderSection): TreeNode[] => {
    const folders = (project.settings.folders ?? []).filter((f) => f.section === section);
    const build = (parent?: string, seen = new Set<string>()): TreeNode[] => [
      ...folders.filter((f) => f.parent === parent && !seen.has(f.id)).map((f) => node(`folder:${f.id}`, f.name, "folder", { section, folderId: f.id, children: build(f.id, new Set([...seen, f.id])) })),
      ...items.filter((item) => item.folderId === parent || (!parent && item.folderId && !folders.some((f) => f.id === item.folderId))),
    ];
    return build();
  };
  const entries = Object.entries(project.canvases);
  const mainEntry = entries.find(([, canvas]) => canvas.id === "main");
  const mainKey = mainEntry?.[0];
  const otherFiles = entries.filter(([key]) => key !== mainKey).map(([key, canvas]) => node(`file:${key}`, canvas.title, "file", { section: "files", folderId: canvas.folderId, root: key, path: [], children: canvasNodes(canvas, key, []) }));
  const files = mainEntry
    ? node("files", project.settings.name, "root", { section: "files", root: mainKey, path: [], children: organized([...canvasNodes(mainEntry[1], mainKey!, []), ...otherFiles], "files") })
    : node("files", "Файлы Ink", "root", { section: "files", children: organized(otherFiles, "files") });
  return [
    node("globals", "Глобальные переменные", "scope", { section: "variables", children: (project.variables.sets ?? []).map((s) => node(`scope:${s.id}`, s.name, "scope", { section: "variables", owner: s.id })) }),
    files,
    node("entities", "Сущности", "root", { section: "entities", children: organized(project.entities.map((e) => node(`entity:${e.id}`, e.name, "entity", { section: "entities", folderId: e.folderId, owner: e.id, children: [] })), "entities") }),
  ];
}

export function indexHierarchy(roots: TreeNode[]) {
  const nodes = new Map<string, TreeNode>(); const parents = new Map<string, string>();
  const visit = (node: TreeNode, parent?: string) => { nodes.set(node.id, node); if (parent) parents.set(node.id, parent); node.children.forEach((child) => visit(child, node.id)); };
  roots.forEach((node) => visit(node));
  return { nodes, parents };
}
