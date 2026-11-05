// дерево проекта слева: библиотека, поиск, список файлов/переменных/персонажей
import { Fragment, useMemo, useState } from "react";
import { create } from "zustand";
import type { Canvas, Entity, InkFunction, VarType } from "@visink/core";
import { ChevronDown, ChevronRight, Search, X } from "lucide-react";
import type { Hit } from "../search";
import { HIT_GROUPS, searchProject } from "../search";
import { isValidInkName } from "@visink/core";
import { useStore } from "../store";
import { addCanvas } from "../ops";
import { TYPE_LABEL } from "../CanvasView";
import { COLORS } from "./fields";

// ───────────── библиотека ─────────────

export function Library() {
  const [query, setQuery] = useState("");
  return (
    <aside className="library">
      <div className="library-search">
        <Search size={14} className="muted" />
        <input
          placeholder="Поиск по проекту…"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          onKeyDown={(e) => e.key === "Escape" && setQuery("")}
        />
        {query && (
          <button className="clear" aria-label="Очистить поиск" onClick={() => setQuery("")}>
            <X size={14} />
          </button>
        )}
      </div>
      <div className="library-body">{query.trim() ? <SearchResults query={query} /> : <ProjectTree />}</div>
    </aside>
  );
}

const COLLAPSED_KEY = "visink-collapsed-folders";

/** Свёрнутые папки на панелях слева — удобство этого компьютера, не часть проекта. Одно на все списки. */
function readCollapsed(): Set<string> {
  try {
    return new Set(JSON.parse(localStorage.getItem(COLLAPSED_KEY) ?? "[]"));
  } catch {
    return new Set();
  }
}

export const useCollapsed = create<{ ids: Set<string>; toggle: (id: string) => void }>()((set, get) => ({
  ids: readCollapsed(),
  toggle(id) {
    const ids = new Set(get().ids);
    if (ids.has(id)) ids.delete(id);
    else ids.add(id);
    try {
      localStorage.setItem(COLLAPSED_KEY, JSON.stringify([...ids]));
    } catch {
      // не запомним — не страшно
    }
    set({ ids });
  },
}));

/** Кнопка-треугольник сворачивания: показывает стрелку при наличии вложенностей, иначе место-заполнитель. */
export function TreeToggle({ id, has }: { id: string; has: boolean }) {
  const open = useCollapsed((s) => !s.ids.has(id));
  if (!has) return <span className="tree-toggle-spacer" />;
  return <button className="tree-toggle" aria-label={open ? "Скрыть вложенности" : "Показать вложенности"} aria-expanded={open} onClick={(e) => { e.stopPropagation(); useCollapsed.getState().toggle(id); }}>{open ? <ChevronDown size={12} /> : <ChevronRight size={12} />}</button>;
}

export function NestedFlowTree({ rootKey, canvas, path }: { rootKey: string; canvas: Canvas; path: string[] }) {
  const { activeCanvas, flowPath, setActiveCanvas } = useStore.getState();
  const collapsed = useCollapsed((s) => s.ids);
  const nested = canvas.cards.filter((card) => card.flow);
  if (!nested.length) return null;
  return (
    <ul className="tree nested-tree">
      {nested.map((card) => {
        const nextPath = [...path, card.id];
        const active = activeCanvas === rootKey && flowPath.length === nextPath.length && flowPath.every((id, i) => id === nextPath[i]);
        const hasChildren = card.flow!.cards.some((child) => child.flow);
        const collapseId = `flow:${rootKey}:${nextPath.join("/")}`;
        const open = !collapsed.has(collapseId);
        const title = card.text || card.menuText || card.condition || TYPE_LABEL[card.type];
        return (
          <li key={card.id} className={active ? "on" : ""} onClick={(e) => { e.stopPropagation(); setActiveCanvas(rootKey, nextPath); }}>
            <TreeToggle id={collapseId} has={hasChildren} />
            <span className="ellipsis" title={title}>{title}</span>
            {hasChildren && open && <NestedFlowTree rootKey={rootKey} canvas={card.flow!} path={nextPath} />}
          </li>
        );
      })}
    </ul>
  );
}

export function ProjectTree() {
  const project = useStore((s) => s.project)!;
  const active = useStore((s) => s.activeCanvas);
  const flowPath = useStore((s) => s.flowPath);
  const selectedEntity = useStore((s) => s.selectedEntity);
  const { edit, setActiveCanvas, selectEntity, inspectVariable, openEditor } = useStore.getState();
  const globals = project.variables.vars.filter((v) => !v.owner);
  const globalGroups = byGroup(globals, NO_FOLDER);
  const files = byGroup(Object.entries(project.canvases).map(([key, c]) => ({ key, c, group: c.group })), NO_FOLDER);
  const characters = byGroup(project.entities, NO_FOLDER);
  const addFile = () => {
    let key = "";
    edit((p) => (key = addCanvas(p, "Новый файл")));
    setActiveCanvas(key);
    openEditor();
  };
  const addCharacter = () => {
    let id = "";
    edit((p) => {
      id = `ent_${p.entities.length}`;
      for (let i = p.entities.length; p.entities.some((e) => e.id === id); i++) id = `ent_${i + 1}`;
      p.entities.push({ id, kind: "character", name: "Новый персонаж", inkName: "ПЕРСОНАЖ", color: COLORS[p.entities.length % COLORS.length] });
    });
    selectEntity(id);
  };
  const collapsed = useCollapsed((s) => s.ids);
  const fileList = (items: { key: string; c: Canvas }[]) => (
    <ul className="tree">
      {items.map(({ key, c }) => {
        const hasNested = c.cards.some((card) => card.flow);
        const collapseId = `flow:${key}`;
        const open = !collapsed.has(collapseId);
        return <li key={key} className={key === active && flowPath.length === 0 ? "on" : ""} title="Двойной щелчок — свойства и переименование" onClick={() => setActiveCanvas(key)} onDoubleClick={() => { setActiveCanvas(key); openEditor(); }}>
          <TreeToggle id={collapseId} has={hasNested} />
          <span className="ellipsis" title={c.title}>{c.title} <span className="muted mono">{c.id}</span></span>
          {hasNested && open && <NestedFlowTree rootKey={key} canvas={c} path={[]} />}
        </li>;
      })}
    </ul>
  );
  return (
    <div className="project-tree">
      <button className="tree-root" onClick={() => { setActiveCanvas(active); openEditor(); }}>Настройки проекта</button>
      <Folder id="root:globals" title="Глобальные переменные" count={globals.length}>
        {globalGroups.map(([group, items]) => {
          const list = <ul className="tree">
            {items.map((v) => <li key={v.name} onClick={() => inspectVariable("var", v.name)}><span className="mono">{v.name}</span><span className="type-tag">{v.type}</span></li>)}
          </ul>;
          return group === NO_FOLDER ? <div key={group}>{list}</div> : <Folder key={group} id={`global:${group}`} title={group} count={items.length}>{list}</Folder>;
        })}
      </Folder>
      <Folder id="root:files" title="Файлы Ink" count={Object.keys(project.canvases).length}>
        {files.map(([group, items]) => group === NO_FOLDER ? <Fragment key={group}>{fileList(items)}</Fragment> : <Folder key={group} id={`canvas:${group}`} title={group} count={items.length}>{fileList(items)}</Folder>)}
        <button className="wide" onClick={addFile}>+ Файл</button>
      </Folder>
      <Folder id="root:characters" title="Персонажи" count={project.entities.length}>
        {characters.map(([group, items]) => (
          <Folder key={group} id={`ent:${group}`} title={group} count={items.length}>
            <ul className="tree">
              {items.map((e) => <li key={e.id} className={e.id === selectedEntity ? "on" : ""} onClick={() => selectEntity(e.id)}><span className="swatch" style={{ background: e.color }} />{e.name}</li>)}
            </ul>
          </Folder>
        ))}
        <button className="wide" onClick={addCharacter}>+ Персонаж</button>
      </Folder>
    </div>
  );
}

/** Подсвечивает совпадение с запросом. */
function Mark({ text, query }: { text: string; query: string }) {
  const i = text.toLowerCase().indexOf(query.trim().toLowerCase());
  if (i < 0 || !query.trim()) return <>{text}</>;
  const n = query.trim().length;
  return (
    <>
      {text.slice(0, i)}
      <mark>{text.slice(i, i + n)}</mark>
      {text.slice(i + n)}
    </>
  );
}

function openHit(hit: Hit) {
  const st = useStore.getState();
  if (hit.kind === "file" && hit.key) st.setActiveCanvas(hit.key);
  else if (hit.kind === "card" && hit.key) st.focusCard(hit.key, hit.card);
  else if (hit.kind === "link" && hit.key && hit.link) st.focusLink(hit.key, hit.link);
  else if (hit.kind === "entity" && hit.id) st.selectEntity(hit.id);
  else if ((hit.kind === "var" || hit.kind === "list" || hit.kind === "func") && hit.id) st.inspectVariable(hit.kind, hit.id, hit.owner);
}

function SearchResults({ query }: { query: string }) {
  const project = useStore((s) => s.project)!;
  const hits = useMemo(() => searchProject(project, query), [project, query]);
  const total = [...hits.values()].reduce((n, h) => n + h.length, 0);
  if (!total) return <div className="muted pad">Ничего не найдено</div>;
  return (
    <>
      {HIT_GROUPS.map(({ kind, title }) => {
        const list = hits.get(kind)!;
        if (!list.length) return null;
        return (
          <div key={kind} className="hit-group">
            <div className="folder-title">
              {title} <span className="muted">{list.length}</span>
            </div>
            <ul className="tree hits">
              {list.map((h, i) => (
                <li key={i} onClick={() => openHit(h)}>
                  <span className="hit-title">
                    <Mark text={h.title} query={query} />
                  </span>
                  {h.detail && (
                    <span className="hit-detail">
                      <Mark text={h.detail} query={query} />
                    </span>
                  )}
                </li>
              ))}
            </ul>
          </div>
        );
      })}
    </>
  );
}

export function Folder({ id, title, count, children }: { id: string; title: string; count: number; children: React.ReactNode }) {
  const open = useCollapsed((s) => !s.ids.has(id));
  return (
    <div>
      <div className="folder-title clickable" onClick={() => useCollapsed.getState().toggle(id)}>
        {open ? <ChevronDown size={12} /> : <ChevronRight size={12} />} {title} <span className="muted">{count}</span>
      </div>
      {open && <div className="folder-content">{children}</div>}
    </div>
  );
}

/** Раскладка по папкам: папки по алфавиту, без папки — в конце; порядок внутри сохраняется. */
export function byGroup<T extends { group?: string }>(items: T[], none: string): [string, T[]][] {
  const m = new Map<string, T[]>();
  for (const x of items) {
    const g = x.group || none;
    if (!m.has(g)) m.set(g, []);
    m.get(g)!.push(x);
  }
  return [...m.entries()].sort((a, b) => (a[0] === none ? 1 : b[0] === none ? -1 : a[0].localeCompare(b[0])));
}

/** Существующие папки — подсказки для поля «Папка». */
export const groupNames = (items: { group?: string }[]) => [...new Set(items.map((x) => x.group).filter((g): g is string => !!g))].sort();

export const NO_FOLDER = "Без папки";
