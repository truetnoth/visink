import { useMemo, useRef, useState } from "react";
import { create } from "zustand";
import type { Canvas, Card, CardType, Entity, InkFunction, InkListDef, Link, Project, Repeat, TextStatus, Variable as VarDef, VarType } from "@visink/core";
import { ChevronDown, ChevronRight, ChevronUp, Files, Flag, Search, Users, Variable, X } from "lucide-react";
import type { Option } from "./ui";
import { CodeInput, Combobox, IconButton, Select as UiSelect } from "./ui";
import type { Hit } from "./search";
import { HIT_GROUPS, searchProject } from "./search";
import { isPlayerCard, isValidInkName } from "@visink/core";
import { unknownIdentifiers } from "@visink/checker";
import { useStore } from "./store";
import { askUser } from "./tauriFs";
import { addCanvas, deleteCards, deleteLink, jumpTargets, renameCanvas, renameVariable, variableUsages } from "./ops";
import type { Usage } from "./ops";
import { TYPE_LABEL } from "./CanvasView";
import { usePortrait } from "./portraits";

const COLORS = ["#8a5cf6", "#10b981", "#f59e0b", "#ef4444", "#06b6d4", "#ec4899", "#84cc16", "#f97316"];

// ───────────── общие поля ─────────────

function PortraitPreview({ entity }: { entity: Entity }) {
  const url = usePortrait(entity.portrait);
  return (
    <div className="portrait-preview" style={{ background: entity.color }} title={entity.portrait && !url ? "файл не найден или не картинка" : undefined}>
      {url && <img src={url} alt="" />}
    </div>
  );
}

function Field({ label, hint, children }: { label: string; hint?: React.ReactNode; children: React.ReactNode }) {
  return (
    <label className="field">
      <span className="field-label">{label}</span>
      {children}
      {hint && <span className="field-hint">{hint}</span>}
    </label>
  );
}

function Text({
  value,
  onChange,
  multiline,
  mono,
  placeholder,
  rows = 3,
  inputRef,
  list,
}: {
  value: string;
  onChange: (v: string) => void;
  multiline?: boolean;
  mono?: boolean;
  placeholder?: string;
  rows?: number;
  inputRef?: React.Ref<HTMLTextAreaElement & HTMLInputElement>;
  list?: string;
}) {
  const cls = mono ? "mono" : "";
  return multiline ? (
    <textarea ref={inputRef} className={cls} rows={rows} value={value} placeholder={placeholder} onChange={(e) => onChange(e.target.value)} />
  ) : (
    <input ref={inputRef} className={cls} value={value} placeholder={placeholder} list={list} onChange={(e) => onChange(e.target.value)} />
  );
}

function Select<T extends string>({ value, options, onChange }: { value: T | null; options: ([T, string] | Option<T>)[]; onChange: (v: T) => void }) {
  const opts = options.map((o): Option<T> => (Array.isArray(o) ? { value: o[0], label: o[1] } : o));
  return <UiSelect value={value} options={opts} onChange={onChange} />;
}

/** Персонажи как варианты выпадающего списка — с цветом. */
function characterOptions(project: Project, empty = "— без спикера —"): Option[] {
  return [
    { value: "", label: empty },
    ...project.entities.filter((e) => e.kind === "character").map((e) => ({ value: e.id, label: e.name, color: e.color, hint: e.isPlayer ? "игрок" : undefined })),
  ];
}

/** Поле ink-выражения: подсказки по мере ввода (и по Ctrl+Space), подсветка неизвестных имён. */
function ExprField({
  label,
  value,
  onChange,
  project,
  multiline,
  rows,
  extra,
  hint,
  noCheck,
}: {
  label: string;
  value: string;
  onChange: (v: string) => void;
  project: Project;
  multiline?: boolean;
  rows?: number;
  /** локальные имена — параметры функции */
  extra?: string[];
  hint?: string;
  /** не проверять имена — в чистом ink есть обычный текст */
  noCheck?: boolean;
}) {
  const unknown = value && !noCheck ? unknownIdentifiers(value, project, extra) : [];
  return (
    <Field label={label} hint={unknown.length > 0 ? <span className="bad">Неизвестно: {unknown.join(", ")}</span> : hint}>
      <CodeInput value={value} onChange={onChange} project={project} multiline={multiline} rows={rows} extra={extra} />
    </Field>
  );
}

// ───────────── библиотека ─────────────

export function Library() {
  const [tab, setTab] = useState<"canvases" | "entities" | "vars">("canvases");
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
      {query.trim() ? (
        <div className="library-body">
          <SearchResults query={query} />
        </div>
      ) : (
        <>
          <div className="tabs">
            <button className={`tab-icon ${tab === "canvases" ? "on" : ""}`} data-tip="Файлы ink" aria-label="Файлы ink" onClick={() => setTab("canvases")}>
              <Files size={16} />
            </button>
            <button className={`tab-icon ${tab === "entities" ? "on" : ""}`} data-tip="Персонажи" aria-label="Персонажи" onClick={() => setTab("entities")}>
              <Users size={16} />
            </button>
            <button className={`tab-icon ${tab === "vars" ? "on" : ""}`} data-tip="Переменные, списки и функции" aria-label="Переменные, списки и функции" onClick={() => setTab("vars")}>
              <Variable size={16} />
            </button>
            <span className="tabs-title">{tab === "canvases" ? "Файлы" : tab === "entities" ? "Персонажи" : "Логика"}</span>
          </div>
          <div className="library-body">
            {tab === "canvases" && <CanvasList />}
            {tab === "entities" && <EntityList />}
            {tab === "vars" && <VariableList />}
          </div>
        </>
      )}
    </aside>
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
  else if ((hit.kind === "var" || hit.kind === "list" || hit.kind === "func") && hit.id) st.inspectVariable(hit.kind, hit.id);
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

const COLLAPSED_KEY = "visink-collapsed-folders";

/** Свёрнутые папки на панелях слева — удобство этого компьютера, не часть проекта. Одно на все списки. */
function readCollapsed(): Set<string> {
  try {
    return new Set(JSON.parse(localStorage.getItem(COLLAPSED_KEY) ?? "[]"));
  } catch {
    return new Set();
  }
}

const useCollapsed = create<{ ids: Set<string>; toggle: (id: string) => void }>()((set, get) => ({
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

/** Сворачиваемая папка; id отдельный от названия, чтобы одинаковые названия в разных списках не путались. */
function Folder({ id, title, count, children }: { id: string; title: string; count: number; children: React.ReactNode }) {
  const open = useCollapsed((s) => !s.ids.has(id));
  return (
    <div>
      <div className="folder-title clickable" onClick={() => useCollapsed.getState().toggle(id)}>
        {open ? <ChevronDown size={12} /> : <ChevronRight size={12} />} {title} <span className="muted">{count}</span>
      </div>
      {open && children}
    </div>
  );
}

/** Раскладка по папкам: папки по алфавиту, без папки — в конце; порядок внутри сохраняется. */
function byGroup<T extends { group?: string }>(items: T[], none: string): [string, T[]][] {
  const m = new Map<string, T[]>();
  for (const x of items) {
    const g = x.group || none;
    if (!m.has(g)) m.set(g, []);
    m.get(g)!.push(x);
  }
  return [...m.entries()].sort((a, b) => (a[0] === none ? 1 : b[0] === none ? -1 : a[0].localeCompare(b[0])));
}

/** Существующие папки — подсказки для поля «Папка». */
const groupNames = (items: { group?: string }[]) => [...new Set(items.map((x) => x.group).filter((g): g is string => !!g))].sort();

const NO_FOLDER = "Без папки";

function CanvasList() {
  const project = useStore((s) => s.project)!;
  const active = useStore((s) => s.activeCanvas);
  const check = useStore((s) => s.check);
  const { edit, setActiveCanvas } = useStore.getState();
  const [title, setTitle] = useState("");

  const counts = useMemo(() => {
    const m = new Map<string, number>();
    for (const d of check?.diagnostics ?? []) if (d.canvas && d.severity === "error") m.set(d.canvas, (m.get(d.canvas) ?? 0) + 1);
    return m;
  }, [check]);

  const folders = useMemo(
    () =>
      byGroup(
        Object.entries(project.canvases)
          .sort((a, b) => a[1].title.localeCompare(b[1].title))
          .map(([key, c]) => ({ key, c, group: c.group })),
        NO_FOLDER,
      ),
    [project.canvases],
  );
  const list = (items: { key: string; c: Canvas }[]) => (
    <ul className="tree">
      {items.map(({ key, c }) => (
        <li key={key} className={key === active ? "on" : ""} onClick={() => setActiveCanvas(key)}>
          {c.title} <span className="muted mono">{c.id}</span>
          {counts.get(key) ? <span className="err-count">{counts.get(key)}</span> : null}
        </li>
      ))}
    </ul>
  );

  const create = () => {
    if (!title.trim()) return;
    let key = "";
    edit((p) => (key = addCanvas(p, title.trim())));
    setActiveCanvas(key);
    setTitle("");
  };

  return (
    <>
      {folders.length === 1 && folders[0][0] === NO_FOLDER
        ? list(folders[0][1])
        : folders.map(([group, items]) => (
            <Folder key={group} id={`canvas:${group}`} title={group} count={items.length}>
              {list(items)}
            </Folder>
          ))}
      <div className="new-canvas row">
        <input placeholder="Новый файл…" value={title} onChange={(e) => setTitle(e.target.value)} onKeyDown={(e) => e.key === "Enter" && create()} />
        <button onClick={create}>Создать</button>
      </div>
    </>
  );
}

function EntityList() {
  const project = useStore((s) => s.project)!;
  const selected = useStore((s) => s.selectedEntity);
  const { edit, selectEntity } = useStore.getState();
  const add = () => {
    const n = project.entities.length;
    let id = `ent_${n}`;
    for (let i = n; project.entities.some((e) => e.id === id); i++) id = `ent_${i + 1}`;
    edit((p) => p.entities.push({ id, kind: "character", name: "Новый персонаж", inkName: "ПЕРСОНАЖ", color: COLORS[n % COLORS.length] }));
    selectEntity(id);
  };
  const characters = project.entities.filter((e) => e.kind === "character");
  const folders = byGroup(project.entities, NO_FOLDER);
  const list = (items: Entity[]) => (
    <ul className="tree">
      {items.map((e) => (
        <li key={e.id} className={e.id === selected ? "on" : ""} onClick={() => selectEntity(e.id)}>
          <span className="swatch" style={{ background: e.color }} />
          {e.name}
          {e.isPlayer && <span className="muted"> · игрок</span>}
          {e.kind === "character" && characters.indexOf(e) < 9 && <span className="muted mono kbd">⌃{characters.indexOf(e) + 1}</span>}
        </li>
      ))}
    </ul>
  );
  return (
    <>
      {folders.length === 1 && folders[0][0] === NO_FOLDER
        ? list(folders[0][1])
        : folders.map(([group, items]) => (
            <Folder key={group} id={`ent:${group}`} title={group} count={items.length}>
              {list(items)}
            </Folder>
          ))}
      <button className="wide" onClick={add}>+ Персонаж</button>
    </>
  );
}

const TYPE_TAG: Record<VarType, string> = { int: "int", float: "float", bool: "bool", string: "str" };

function VariableList() {
  const project = useStore((s) => s.project)!;
  const inspect = useStore((s) => s.inspect);
  const { edit, inspectVariable } = useStore.getState();
  const { vars, lists, functions } = project.variables;
  const groups = useMemo(() => byGroup([...vars].sort((a, b) => a.name.localeCompare(b.name)), "Без группы"), [vars]);
  const funcGroups = useMemo(() => {
    const sorted = [...functions].sort((a, b) => a.name.localeCompare(b.name));
    return functions.some((f) => f.group) ? byGroup(sorted, "Функции без группы") : sorted.length ? ([["Функции", sorted]] as [string, InkFunction[]][]) : [];
  }, [functions]);
  const folder = (id: string, title: string, count: number, children: React.ReactNode) => (
    <Folder key={id} id={id} title={title} count={count}>
      {children}
    </Folder>
  );
  const unique = (base: string, taken: string[]) => {
    let name = base;
    for (let i = 2; taken.includes(name); i++) name = `${base}_${i}`;
    return name;
  };
  const taken = [...vars.map((v) => v.name), ...lists.map((l) => l.name)];
  const addVar = () => {
    const name = unique("new_var", [...taken, ...functions.map((f) => f.name)]);
    edit((p) => p.variables.vars.push({ name, type: "bool", default: false }));
    inspectVariable("var", name);
  };
  const addList = () => {
    const name = unique("NewList", taken);
    edit((p) => p.variables.lists.push({ name, items: [], initial: [] }));
    inspectVariable("list", name);
  };
  const on = (kind: "var" | "list" | "func", name: string) => inspect?.kind === kind && inspect.name === name;
  const addFunction = () => {
    const name = unique("new_function", [...taken, ...functions.map((f) => f.name)]);
    edit((p) => p.variables.functions.push({ name, params: [], body: "~ return true" }));
    inspectVariable("func", name);
  };
  return (
    <div className="vars">
      {groups.map(([group, items]) =>
        folder(
          group,
          group,
          items.length,
          <ul className="tree">
            {items.map((v) => (
              <li key={v.name} className={on("var", v.name) ? "on" : ""} onClick={() => inspectVariable("var", v.name)}>
                <span className={`type-tag ${isValidInkName(v.name) ? "" : "bad"}`}>{TYPE_TAG[v.type]}</span>
                <span className="mono ellipsis">{v.name}</span>
                <span className="muted mono kbd ellipsis">{String(v.default)}</span>
              </li>
            ))}
          </ul>,
        ),
      )}
      <button className="wide" onClick={addVar}>+ Переменная</button>
      {folder(
        "list:",
        "Списки ink (LIST)",
        lists.length,
        <ul className="tree">
          {[...lists]
            .sort((a, b) => a.name.localeCompare(b.name))
            .map((l) => (
              <li key={l.name} className={on("list", l.name) ? "on" : ""} onClick={() => inspectVariable("list", l.name)}>
                <span className="type-tag">list</span>
                <span className="mono ellipsis">{l.name}</span>
                <span className="muted kbd">{l.items.length}</span>
              </li>
            ))}
        </ul>,
      )}
      <button className="wide" onClick={addList}>+ Список</button>
      {funcGroups.map(([group, items]) =>
        folder(
          `func:${group}`,
          group,
          items.length,
          <ul className="tree">
            {items.map((f) => (
              <li key={f.name} className={on("func", f.name) ? "on" : ""} onClick={() => inspectVariable("func", f.name)} title={f.description}>
                <span className="type-tag">{f.external ? "ext" : "fn"}</span>
                <span className="mono ellipsis">
                  {f.name}
                  <span className="muted">({f.params.join(", ")})</span>
                </span>
              </li>
            ))}
          </ul>,
        ),
      )}
      {!functions.length && <div className="folder-title">Функции</div>}
      <button className="wide" onClick={addFunction}>+ Функция</button>
    </div>
  );
}

/** Имя переменной/списка: применяется по Enter или уходу из поля, с проверкой и переименованием во всём проекте. */
function NameField({ name, project, onRename }: { name: string; project: Project; onRename: (to: string) => void }) {
  const [value, setValue] = useState(name);
  const [prev, setPrev] = useState(name);
  if (prev !== name) {
    setPrev(name);
    setValue(name);
  }
  const taken =
    value !== name &&
    [...project.variables.vars.map((v) => v.name), ...project.variables.lists.map((l) => l.name), ...project.variables.functions.map((f) => f.name)].includes(value);
  const valid = isValidInkName(value) && !taken;
  const apply = () => {
    if (value === name) return;
    if (valid) onRename(value);
    else setValue(name);
  };
  return (
    <Field
      label="Имя"
      hint={!isValidInkName(value) ? <span className="bad">только латиница, цифры и _</span> : taken ? <span className="bad">имя занято</span> : "переименование обновит все условия и действия"}
    >
      <input className="mono" autoFocus={name.startsWith("new_") || name.startsWith("NewList")} value={value} onChange={(e) => setValue(e.target.value)} onBlur={apply} onKeyDown={(e) => e.key === "Enter" && apply()} />
    </Field>
  );
}

function UsageList({ usages, project }: { usages: Usage[]; project: Project }) {
  const { focusCard, focusLink, inspectVariable } = useStore.getState();
  if (!usages.length) return <div className="muted pad">Нигде не используется</div>;
  return (
    <ul className="tree">
      {usages.map((u, i) => {
        if (u.func) {
          return (
            <li key={i} onClick={() => inspectVariable("func", u.func!)}>
              <span className="muted">функция ·</span>
              <span className="mono ellipsis">{u.func}()</span>
            </li>
          );
        }
        const c = project.canvases[u.key];
        const card = u.card ? c?.cards.find((x) => x.id === u.card) : undefined;
        return (
          <li key={i} onClick={() => (u.link ? focusLink(u.key, u.link) : focusCard(u.key, u.card))}>
            <span className="muted">{c?.title} ·</span>
            <span className="ellipsis">{u.link ? `стрелка ${u.link.from} → ${u.link.to}` : card?.text || card?.condition || card?.action || u.card}</span>
          </li>
        );
      })}
    </ul>
  );
}

function VariableProps({ name, project }: { name: string; project: Project }) {
  const { edit, inspectVariable } = useStore.getState();
  const v = project.variables.vars.find((x) => x.name === name);
  const usages = useMemo(() => variableUsages(project, name), [project, name]);
  const groups = useMemo(() => groupNames(project.variables.vars), [project]);
  if (!v) return null;
  const set = (fn: (x: VarDef) => void) =>
    edit((p) => {
      const x = p.variables.vars.find((y) => y.name === name);
      if (x) fn(x);
    });
  return (
    <div className="props">
      <div className="props-title">
        Переменная <span className="mono muted">VAR</span>
      </div>
      <NameField
        name={name}
        project={project}
        onRename={(to) => {
          edit((p) => renameVariable(p, name, to));
          inspectVariable("var", to);
        }}
      />
      <div className="row2">
        <Field label="Тип">
          <Select<VarType>
            value={v.type}
            onChange={(t) =>
              set((x) => {
                x.type = t;
                x.default = t === "bool" ? false : t === "string" ? "" : 0;
              })
            }
            options={[["bool", "bool — да/нет"], ["int", "int — целое"], ["float", "float — дробное"], ["string", "string — строка"]]}
          />
        </Field>
        <Field label="По умолчанию">
          {v.type === "bool" ? (
            <Select value={v.default === true || v.default === "true" ? "true" : "false"} onChange={(b) => set((x) => (x.default = b === "true"))} options={[["false", "false"], ["true", "true"]]} />
          ) : v.type === "string" ? (
            <input value={String(v.default)} onChange={(e) => set((x) => (x.default = e.target.value))} />
          ) : (
            <input
              type="number"
              step={v.type === "int" ? 1 : "any"}
              value={String(v.default)}
              onChange={(e) => set((x) => (x.default = e.target.value === "" ? 0 : Number(e.target.value)))}
            />
          )}
        </Field>
      </div>
      <Field label="Группа" hint="для порядка в списке слева">
        <Combobox value={v.group ?? ""} options={groups} placeholder="Сюжет, Отношения…" onChange={(g) => set((x) => (x.group = g || undefined))} />
      </Field>
      <Field label={`Где используется (${usages.length})`}>
        <UsageList usages={usages} project={project} />
      </Field>
      <button
        className="danger"
        onClick={async () => {
          if (usages.length && !(await askUser(`«${name}» используется в ${usages.length} местах — после удаления там будут ошибки. Удалить?`))) return;
          edit((p) => (p.variables.vars = p.variables.vars.filter((x) => x.name !== name)));
          inspectVariable("var", null);
        }}
      >
        Удалить переменную
      </button>
    </div>
  );
}

function FunctionProps({ name, project }: { name: string; project: Project }) {
  const check = useStore((s) => s.check);
  const { edit, inspectVariable } = useStore.getState();
  const f = project.variables.functions.find((x) => x.name === name);
  const usages = useMemo(() => variableUsages(project, name), [project, name]);
  const [params, setParams] = useState(() => f?.params.join(", ") ?? "");
  if (!f) return null;
  const set = (fn: (x: InkFunction) => void) =>
    edit((p) => {
      const x = p.variables.functions.find((y) => y.name === name);
      if (x) fn(x);
    });
  const parsed = params.split(",").map((x) => x.trim()).filter(Boolean);
  const bad = parsed.filter((x) => !isValidInkName(x));
  const problems = (check?.diagnostics ?? []).filter((d) => d.func === name);
  return (
    <div className="props">
      <div className="props-title">
        Функция <span className="mono muted">{name}({f.params.join(", ")})</span>
      </div>
      {problems.map((d, i) => (
        <div key={i} className={`problem ${d.severity}`}>{d.message}</div>
      ))}
      <NameField
        name={name}
        project={project}
        onRename={(to) => {
          edit((p) => renameVariable(p, name, to));
          inspectVariable("func", to);
        }}
      />
      <Field label="Параметры" hint={bad.length ? <span className="bad">неверные имена: {bad.join(", ")}</span> : "через запятую"}>
        <input className="mono" value={params} placeholder="who, amount" onChange={(e) => setParams(e.target.value)} onBlur={() => !bad.length && set((x) => (x.params = parsed))} />
      </Field>
      <Field label="Описание" hint="показывается в подсказках при вводе">
        <Text value={f.description ?? ""} onChange={(v) => set((x) => (x.description = v || undefined))} />
      </Field>
      <label className="check">
        <input type="checkbox" checked={!!f.external} onChange={(e) => set((x) => (x.external = e.target.checked || undefined))} />
        Реализует игра (EXTERNAL) — тело ниже станет запасным вариантом для Inky
      </label>
      <ExprField
        label="Тело"
        hint="ink как есть: строки ~ … и ~ return значение"
        multiline
        rows={6}
        value={f.body}
        onChange={(v) => set((x) => (x.body = v))}
        project={project}
        extra={f.params}
      />
      <Field label={`Где используется (${usages.length})`}>
        <UsageList usages={usages} project={project} />
      </Field>
      <button
        className="danger"
        onClick={async () => {
          if (usages.length && !(await askUser(`«${name}» используется в ${usages.length} местах — после удаления там будут ошибки. Удалить?`))) return;
          edit((p) => (p.variables.functions = p.variables.functions.filter((x) => x.name !== name)));
          inspectVariable("func", null);
        }}
      >
        Удалить функцию
      </button>
    </div>
  );
}

function ListProps({ name, project }: { name: string; project: Project }) {
  const { edit, inspectVariable } = useStore.getState();
  const l = project.variables.lists.find((x) => x.name === name);
  const usages = useMemo(() => variableUsages(project, name), [project, name]);
  const [items, setItems] = useState(() => l?.items.join(", ") ?? "");
  if (!l) return null;
  const set = (fn: (x: InkListDef) => void) =>
    edit((p) => {
      const x = p.variables.lists.find((y) => y.name === name);
      if (x) fn(x);
    });
  const parsed = items.split(",").map((x) => x.trim()).filter(Boolean);
  const bad = parsed.filter((x) => !isValidInkName(x));
  return (
    <div className="props">
      <div className="props-title">
        Список <span className="mono muted">LIST</span>
      </div>
      <NameField
        name={name}
        project={project}
        onRename={(to) => {
          edit((p) => renameVariable(p, name, to));
          inspectVariable("list", to);
        }}
      />
      <Field label="Элементы" hint={bad.length ? <span className="bad">неверные имена: {bad.join(", ")}</span> : "через запятую"}>
        <input
          className="mono"
          value={items}
          onChange={(e) => setItems(e.target.value)}
          onBlur={() =>
            set((x) => {
              x.items = parsed;
              x.initial = x.initial.filter((i) => parsed.includes(i));
            })
          }
        />
      </Field>
      {l.items.length > 0 && (
        <Field label="Включены с начала игры">
          <div className="checks">
            {l.items.map((i) => (
              <label key={i} className="check mono">
                <input
                  type="checkbox"
                  checked={l.initial.includes(i)}
                  onChange={(e) => set((x) => (x.initial = e.target.checked ? [...x.initial, i] : x.initial.filter((y) => y !== i)))}
                />
                {i}
              </label>
            ))}
          </div>
        </Field>
      )}
      <Field label={`Где используется (${usages.length})`}>
        <UsageList usages={usages} project={project} />
      </Field>
      <button
        className="danger"
        onClick={async () => {
          if (usages.length && !(await askUser(`«${name}» используется в ${usages.length} местах — после удаления там будут ошибки. Удалить?`))) return;
          edit((p) => (p.variables.lists = p.variables.lists.filter((x) => x.name !== name)));
          inspectVariable("list", null);
        }}
      >
        Удалить список
      </button>
    </div>
  );
}

// ───────────── свойства ─────────────

export function Properties() {
  const project = useStore((s) => s.project)!;
  const key = useStore((s) => s.activeCanvas);
  const selection = useStore((s) => s.selection);
  const selectedEntity = useStore((s) => s.selectedEntity);
  const selectedLink = useStore((s) => s.selectedLink);
  const inspect = useStore((s) => s.inspect);
  const canvas = key ? project.canvases[key] : undefined;
  const link = canvas && selectedLink ? canvas.links.find((l) => `${l.from}>${l.to}>${l.port ?? ""}` === selectedLink) : undefined;
  const card = canvas && selection.length === 1 ? canvas.cards.find((c) => c.id === selection[0]) : undefined;
  const entity = selectedEntity ? project.entities.find((e) => e.id === selectedEntity) : undefined;

  return (
    <aside className="properties">
      {inspect?.kind === "var" ? (
        <VariableProps key={inspect.name} name={inspect.name} project={project} />
      ) : inspect?.kind === "list" ? (
        <ListProps key={inspect.name} name={inspect.name} project={project} />
      ) : inspect?.kind === "func" ? (
        <FunctionProps key={inspect.name} name={inspect.name} project={project} />
      ) : entity ? (
        <EntityProps entity={entity} project={project} />
      ) : link && canvas && key ? (
        <LinkProps key={selectedLink} link={link} canvas={canvas} canvasKey={key} project={project} />
      ) : card && canvas && key ? (
        <CardProps key={card.id} card={card} canvas={canvas} canvasKey={key} project={project} />
      ) : selection.length > 1 && canvas ? (
        <MultiCardProps canvas={canvas} selection={selection} project={project} />
      ) : (
        <>
          {canvas && key && <CanvasProps canvas={canvas} canvasKey={key} project={project} />}
          <ProjectProps project={project} />
        </>
      )}
    </aside>
  );
}

function CardProps({ card, canvas, canvasKey, project }: { card: Card; canvas: Canvas; canvasKey: string; project: Project }) {
  const check = useStore((s) => s.check);
  const { editCanvas, focusCard } = useStore.getState();
  const set = <K extends keyof Card>(field: K, value: Card[K]) =>
    editCanvas((c) => {
      const target = c.cards.find((x) => x.id === card.id);
      if (!target) return;
      if (value === "" || value === undefined) delete target[field];
      else target[field] = value;
    });
  const player = isPlayerCard(project, card);
  const ink = check?.build.canvases[canvasKey]?.cardInk[card.id];
  const problems = (check?.diagnostics ?? []).filter((d) => d.canvas === canvasKey && d.card === card.id);
  const incoming = useMemo(() => {
    const out: { key: string; canvas: Canvas; card: Card }[] = [];
    for (const l of canvas.links.filter((l) => l.to === card.id)) {
      const from = canvas.cards.find((c) => c.id === l.from);
      if (from) out.push({ key: canvasKey, canvas, card: from });
    }
    for (const [k, c] of Object.entries(project.canvases)) {
      for (const j of c.cards) {
        if (j.type !== "jump" || !j.target) continue;
        const [cid, sub] = j.target.split(".");
        if (cid === canvas.id && (sub === card.id || (card.entry && sub === `entry_${card.entry}`) || (card.entry && sub === card.entry))) out.push({ key: k, canvas: c, card: j });
      }
    }
    return out;
  }, [project, canvas, canvasKey, card]);
  const targets = useMemo(() => jumpTargets(project), [project]);

  return (
    <div className="props">
      <div className="props-title">
        {TYPE_LABEL[card.type]} <span className="mono muted">{canvas.id}.{card.id}</span>
      </div>
      {problems.map((d, i) => (
        <div key={i} className={`problem ${d.severity}`}>{d.message}</div>
      ))}
      {canvas.links.filter((l) => l.from === card.id && !l.port).length > 1 && (
        <div className="field-hint pad">Несколько стрелок: варианты в меню и проверка веток идут сверху вниз по положению карточек.</div>
      )}
      <Field label="Тип">
        <Select<CardType> value={card.type} onChange={(t) => set("type", t)} options={(Object.keys(TYPE_LABEL) as CardType[]).map((t) => [t, TYPE_LABEL[t]])} />
      </Field>

      {canvas.start === card.id ? (
        <div className="start-note">
          <Flag size={14} /> Начало файла — с этой карточки игра начинает <span className="mono">{canvas.id}</span>
        </div>
      ) : (
        <button className="wide start-btn" onClick={() => editCanvas((c) => (c.start = card.id))}>
          <Flag size={14} /> Сделать началом файла
        </button>
      )}
      <details className="more" open={!!card.entry}>
        <summary>Дополнительная точка входа</summary>
        <Field
          label="Имя точки входа"
          hint={
            card.entry && !isValidInkName(card.entry) ? (
              <span className="bad">только латиница, цифры и _</span>
            ) : card.entry ? (
              <>игра может начать отсюда: <span className="mono">{canvas.id}.entry_{card.entry}</span></>
            ) : (
              <>чтобы игра могла начать диалог не с начала файла, например со второй встречи</>
            )
          }
        >
          <Text mono value={card.entry ?? ""} placeholder="second_meeting" onChange={(v) => set("entry", v.trim())} />
        </Field>
      </details>

      {card.type === "line" && (
        <>
          <Field label="Спикер">
            <Select value={card.speaker ?? ""} onChange={(v) => set("speaker", v)} options={characterOptions(project)} />
          </Field>
          {player && (
            <Field label="Текст на кнопке" hint="что игрок видит в меню выбора; пусто — текст реплики">
              <Text value={card.menuText ?? ""} placeholder={card.text || ""} onChange={(v) => set("menuText", v)} />
            </Field>
          )}
          <Field label="Текст реплики">
            <Text multiline rows={4} value={card.text ?? ""} onChange={(v) => set("text", v)} />
          </Field>
          {player && (
            <Field label="Повтор">
              <Select value={card.repeat ?? "once"} onChange={(v) => set("repeat", v)} options={[["once", "одноразовая (*)"], ["sticky", "повторяемая (+)"], ["fallback", "запасная (* ->)"]]} />
            </Field>
          )}
          <div className="row2">
            <Field label="Эмоция">
              <Text value={card.emotion ?? ""} onChange={(v) => set("emotion", v)} />
            </Field>
            <Field label="Статус">
              <Select value={card.status ?? "draft"} onChange={(v) => set("status", v)} options={[["draft", "черновик"], ["review", "на вычитке"], ["final", "финал"]]} />
            </Field>
          </div>
          <Field label="Ремарка" hint="тег # dir:">
            <Text value={card.stageDirection ?? ""} onChange={(v) => set("stageDirection", v)} />
          </Field>
        </>
      )}

      {card.type === "condition" ? (
        <ExprField label="Условие (выход «да», иначе «нет»)" value={card.condition ?? ""} onChange={(v) => set("condition", v)} project={project} />
      ) : (
        <div data-field="condition">
          <ExprField label="Входной пин — условие" value={card.condition ?? ""} onChange={(v) => set("condition", v)} project={project} />
        </div>
      )}

      {card.type !== "ink" && (
        <div data-field="action">
          <ExprField label="Выходной пин — действие (~ …), по строке" value={card.action ?? ""} onChange={(v) => set("action", v)} project={project} multiline />
        </div>
      )}

      {card.type === "jump" && (
        <Field label="Цель перехода" hint="файл, файл.точка_входа или файл.id_карточки; Ctrl+щелчок по карточке — перейти">
          <Combobox mono value={card.target ?? ""} options={targets} placeholder="advisor или advisor.office" onChange={(v) => set("target", v)} />
        </Field>
      )}

      {card.type === "ink" && (
        <ExprField
          label="Чистый ink"
          hint="вставляется как есть; со стрелками в конце дописывается переход. Конец игры — -> END, возврат из туннеля — ->->"
          multiline
          rows={8}
          value={card.text ?? ""}
          onChange={(v) => set("text", v)}
          project={project}
          noCheck
        />
      )}

      {card.type === "line" && (
        <Field label="Теги" hint="по строке: ключ: значение">
          <TagsEditor tags={card.tags ?? {}} onChange={(t) => set("tags", Object.keys(t).length ? t : undefined)} />
        </Field>
      )}

      <Field label="Заметка">
        <Text multiline rows={2} value={card.note ?? ""} onChange={(v) => set("note", v)} />
      </Field>

      {incoming.length > 0 && (
        <Field label="Кто ссылается">
          <ul className="tree">
            {incoming.map(({ key, canvas: c, card: from }) => (
              <li key={key + from.id} onClick={() => focusCard(key, from.id)}>
                <span className="muted">{c.title} ·</span> {from.text || from.menuText || TYPE_LABEL[from.type]} <span className="mono muted">{from.id}</span>
              </li>
            ))}
          </ul>
        </Field>
      )}

      {ink && (
        <Field label="Сгенерированный ink">
          <pre className="ink-preview">{ink}</pre>
        </Field>
      )}
    </div>
  );
}

function LinkProps({ link, canvas, canvasKey, project }: { link: Link; canvas: Canvas; canvasKey: string; project: Project }) {
  const check = useStore((s) => s.check);
  const { editCanvas, setSelection } = useStore.getState();
  const same = (l: Link) => l.from === link.from && l.to === link.to && (l.port ?? "") === (link.port ?? "");
  const set = (field: "condition" | "action", value: string) =>
    editCanvas((c) => {
      const target = c.links.find(same);
      if (!target) return;
      if (value) target[field] = value;
      else delete target[field];
    });
  const from = canvas.cards.find((c) => c.id === link.from);
  const to = canvas.cards.find((c) => c.id === link.to);
  const label = (c?: Card) => (c ? c.menuText || c.text || TYPE_LABEL[c.type] : "?");
  const toPlayer = !!to && isPlayerCard(project, to);
  const problems = (check?.diagnostics ?? []).filter((d) => d.canvas === canvasKey && d.link && same(d.link as Link));
  return (
    <div className="props link-props">
      <div className="props-title">Стрелка</div>
      <div className="link-ends muted">
        <span className="mono">{link.from}</span> {label(from)} → <span className="mono">{link.to}</span> {label(to)}
        {link.port && <> · выход «{link.port === "yes" ? "да" : "нет"}»</>}
      </div>
      {problems.map((d, i) => (
        <div key={i} className={`problem ${d.severity}`}>{d.message}</div>
      ))}
      {/* логика живёт на пинах карточек; на стрелке — только то, что не удалось перенести из старых проектов */}
      {(link.condition || link.action) && (
        <div className="field-hint pad">осталось со старой версии — перенесите на пин карточки и очистите поле</div>
      )}
      {link.condition && !link.port && (
        <ExprField
          label={toPlayer ? "Условие — когда показывать вариант" : "Условие — когда идти по стрелке"}
          value={link.condition}
          onChange={(v) => set("condition", v)}
          project={project}
        />
      )}
      {link.action && (
        <ExprField label="Действие при переходе (~ …), по строке" value={link.action} onChange={(v) => set("action", v)} project={project} multiline />
      )}
      {!link.condition && !link.action && <div className="field-hint pad">условие и действие задаются на пинах карточек: щелчок по пину</div>}
      <button
        className="danger"
        onClick={() => {
          editCanvas((c) => deleteLink(c, link.from, link.to, link.port));
          setSelection([]);
        }}
      >
        Удалить стрелку
      </button>
    </div>
  );
}

const MIXED = "\u0000mixed";

/** Общее значение поля у выбранных карточек или MIXED, если разные. */
function common<T>(cards: Card[], get: (c: Card) => T): T | typeof MIXED {
  const first = get(cards[0]);
  return cards.every((c) => get(c) === first) ? first : MIXED;
}

function MultiCardProps({ canvas, selection, project }: { canvas: Canvas; selection: string[]; project: Project }) {
  const { editCanvas, setSelection } = useStore.getState();
  const cards = canvas.cards.filter((c) => selection.includes(c.id));
  const lines = cards.filter((c) => c.type === "line");
  const players = lines.filter((c) => isPlayerCard(project, c));
  const notes = selection.length - cards.length;
  // одна правка — один шаг отмены для всех карточек
  const setAll = <K extends keyof Card>(field: K, value: Card[K], only: (c: Card) => boolean = () => true) =>
    editCanvas((c) => {
      for (const target of c.cards) {
        if (!selection.includes(target.id) || !only(target)) continue;
        if (value === "" || value === undefined) delete target[field];
        else target[field] = value;
      }
    });
  const isLine = (c: Card) => c.type === "line";
  const isPlayer = (c: Card) => isPlayerCard(project, c);

  if (!cards.length) return <div className="muted pad">Выделено заметок: {notes}</div>;
  const speaker = lines.length ? common(lines, (c) => c.speaker ?? "") : MIXED;
  const emotion = lines.length ? common(lines, (c) => c.emotion ?? "") : MIXED;
  const status = lines.length ? common(lines, (c) => c.status ?? "draft") : MIXED;
  const repeat = players.length ? common(players, (c) => c.repeat ?? "once") : MIXED;
  const gated = cards.filter((c) => c.type !== "condition");
  const condition = gated.length ? common(gated, (c) => c.condition ?? "") : MIXED;

  return (
    <div className="props">
      <div className="props-title">
        Выбрано карточек: {cards.length}
        {notes > 0 && <span className="muted"> + заметок: {notes}</span>}
      </div>
      {lines.length > 0 && (
        <>
          <Field label={`Спикер (реплик: ${lines.length})`}>
            <Select value={speaker === MIXED ? null : speaker} onChange={(v) => setAll("speaker", v, isLine)} options={characterOptions(project)} />
          </Field>
          <div className="row2">
            <Field label="Эмоция">
              <input
                value={emotion === MIXED ? "" : emotion}
                placeholder={emotion === MIXED ? "— разные —" : ""}
                onChange={(e) => setAll("emotion", e.target.value, isLine)}
              />
            </Field>
            <Field label="Статус">
              <Select<TextStatus>
                value={status === MIXED ? null : status}
                onChange={(v) => setAll("status", v, isLine)}
                options={[["draft", "черновик"], ["review", "на вычитке"], ["final", "финал"]]}
              />
            </Field>
          </div>
        </>
      )}
      {players.length > 0 && (
        <Field label={`Повтор (вариантов игрока: ${players.length})`}>
          <Select<Repeat>
            value={repeat === MIXED ? null : repeat}
            onChange={(v) => setAll("repeat", v, isPlayer)}
            options={[["once", "одноразовая (*)"], ["sticky", "повторяемая (+)"], ["fallback", "запасная (* ->)"]]}
          />
        </Field>
      )}
      {gated.length > 0 && (
        <Field label="Входной пин — условие" hint={condition === MIXED ? "у карточек разные условия — ввод заменит их все" : undefined}>
          <input
            className="mono"
            value={condition === MIXED ? "" : condition}
            placeholder={condition === MIXED ? "— разные —" : ""}
            onChange={(e) => setAll("condition", e.target.value, (c) => c.type !== "condition")}
          />
        </Field>
      )}
      <Field label="Добавить тег всем" hint="ключ: значение, Enter">
        <input
          className="mono"
          placeholder="voice: whisper"
          onKeyDown={(e) => {
            if (e.key !== "Enter") return;
            const m = /^\s*([^:]+?)\s*:\s*(.*)$/.exec(e.currentTarget.value);
            if (!m) return;
            const [, k, v] = m;
            editCanvas((c) => {
              for (const t of c.cards) if (selection.includes(t.id) && t.type === "line") t.tags = { ...t.tags, [k]: v };
            });
            e.currentTarget.value = "";
          }}
        />
      </Field>
      <div className="muted pad">Ctrl+1…9 — сменить спикера, Shift+щелчок — добавить к выделению.</div>
      <button
        className="danger"
        onClick={() => {
          editCanvas((c) => deleteCards(c, selection));
          setSelection([]);
        }}
      >
        Удалить выбранные
      </button>
    </div>
  );
}

function TagsEditor({ tags, onChange }: { tags: Record<string, string>; onChange: (t: Record<string, string>) => void }) {
  const [text, setText] = useState(() => Object.entries(tags).map(([k, v]) => `${k}: ${v}`).join("\n"));
  return (
    <textarea
      className="mono"
      rows={2}
      value={text}
      onChange={(e) => setText(e.target.value)}
      onBlur={() => {
        const out: Record<string, string> = {};
        for (const line of text.split("\n")) {
          const m = /^\s*([^:]+?)\s*:\s*(.*)$/.exec(line);
          if (m && m[1]) out[m[1]] = m[2];
        }
        onChange(out);
      }}
    />
  );
}

function CanvasProps({ canvas, canvasKey, project }: { canvas: Canvas; canvasKey: string; project: Project }) {
  const { edit, setActiveCanvas } = useStore.getState();
  const [id, setId] = useState(canvas.id);
  const [prevKey, setPrevKey] = useState(canvasKey);
  if (prevKey !== canvasKey) {
    setPrevKey(canvasKey);
    setId(canvas.id);
  }
  const idTaken = id !== canvas.id && Object.values(project.canvases).some((c) => c.id === id);
  const applyId = () => {
    if (id === canvas.id || !isValidInkName(id) || idTaken) return;
    let key = "";
    edit((p) => (key = renameCanvas(p, canvasKey, { id })));
    setActiveCanvas(key);
  };
  return (
    <div className="props">
      <div className="props-title">Файл</div>
      <Field label="Название">
        <Text value={canvas.title} onChange={(v) => edit((p) => (p.canvases[canvasKey].title = v))} />
      </Field>
      <Field
        label="Имя файла и узла ink"
        hint={!isValidInkName(id) ? <span className="bad">только латиница, цифры и _</span> : idTaken ? <span className="bad">имя занято</span> : "переходы в этот файл обновятся сами"}
      >
        <input className="mono" value={id} onChange={(e) => setId(e.target.value)} onBlur={applyId} onKeyDown={(e) => e.key === "Enter" && applyId()} />
      </Field>
      <Field label="Папка" hint="для порядка в списке файлов; на ink не влияет">
        <Combobox
          value={canvas.group ?? ""}
          options={groupNames(Object.values(project.canvases))}
          placeholder="Акт 1, Кампус…"
          onChange={(g) => edit((p) => (p.canvases[canvasKey].group = g || undefined))}
        />
      </Field>
      <Field label="Владелец" hint="главный собеседник: спикер новых реплик">
        <Select
          value={canvas.owner ?? ""}
          onChange={(v) => edit((p) => (p.canvases[canvasKey].owner = v || undefined))}
          options={characterOptions(project, "— не задан —").filter((o) => o.hint !== "игрок")}
        />
      </Field>
      <button
        className="danger"
        onClick={async () => {
          if (!(await askUser(`Удалить файл «${canvas.title}»? Отменить можно через Ctrl+Z.`))) return;
          edit((p) => delete p.canvases[canvasKey]);
          setActiveCanvas(null);
        }}
      >
        Удалить файл
      </button>
    </div>
  );
}

function ProjectProps({ project }: { project: Project }) {
  const { edit, pickBuildDir } = useStore.getState();
  const buildFs = useStore((s) => s.buildFs);
  const targets = useMemo(() => jumpTargets(project), [project]);
  return (
    <div className="props">
      <div className="props-title">Проект</div>
      <Field label="Название">
        <Text value={project.settings.name} onChange={(v) => edit((p) => (p.settings.name = v))} />
      </Field>
      <Field
        label="Запуск всей истории"
        hint="куда переходит main.ink — для Inky и прогона всей истории. Godot запускает диалоги сам: ChoosePathString(&quot;файл&quot;). Пусто — история сразу заканчивается."
      >
        <Combobox mono value={project.settings.start ?? ""} options={targets} placeholder="например, dean" onChange={(v) => edit((p) => (p.settings.start = v || undefined))} />
      </Field>
      <Field label="Папка сборки внутри проекта" hint={buildFs ? `сейчас сборка пишется во внешнюю папку «${buildFs.name}»` : undefined}>
        <Text mono value={project.settings.buildDir} onChange={(v) => edit((p) => (p.settings.buildDir = v))} />
      </Field>
      <button onClick={pickBuildDir}>Собирать во внешнюю папку…</button>
    </div>
  );
}

function EntityProps({ entity, project }: { entity: Entity; project: Project }) {
  const { edit, selectEntity } = useStore.getState();
  const set = <K extends keyof Entity>(field: K, value: Entity[K]) =>
    edit((p) => {
      const e = p.entities.find((x) => x.id === entity.id);
      if (!e) return;
      if (field === "isPlayer" && value) for (const other of p.entities) other.isPlayer = undefined;
      e[field] = value;
    });
  const uses = Object.values(project.canvases).reduce((n, c) => n + c.cards.filter((x) => x.speaker === entity.id).length, 0);
  return (
    <div className="props">
      <div className="props-title">
        Персонаж <span className="mono muted">{entity.id}</span>
      </div>
      <Field label="Имя">
        <Text value={entity.name} onChange={(v) => set("name", v)} />
      </Field>
      <Field label="Имя в ink" hint="«ДЕКАН: текст»; пусто — строка без префикса (рассказчик)">
        <Text value={entity.inkName} onChange={(v) => set("inkName", v)} />
      </Field>
      <Field label="Цвет">
        <input type="color" value={entity.color} onChange={(e) => set("color", e.target.value)} />
      </Field>
      <Field label="Папка" hint="для порядка в списке персонажей">
        <Combobox value={entity.group ?? ""} options={groupNames(project.entities)} placeholder="Преподаватели, Студенты…" onChange={(g) => set("group", g || undefined)} />
      </Field>
      <Field label="Портрет" hint="путь в проекте, уходит в manifest.json">
        <div className="portrait-row">
          <PortraitPreview entity={entity} />
          <Text mono value={entity.portrait ?? ""} placeholder="assets/portraits/dean.png" onChange={(v) => set("portrait", v || undefined)} />
        </div>
      </Field>
      <label className="check">
        <input type="checkbox" checked={!!entity.isPlayer} onChange={(e) => set("isPlayer", e.target.checked || undefined)} />
        Это игрок — его реплики становятся вариантами выбора
      </label>
      <div className="muted pad">Реплик: {uses}</div>
      <button
        className="danger"
        disabled={uses > 0}
        title={uses ? "Сначала уберите персонажа из реплик" : ""}
        onClick={() => {
          edit((p) => (p.entities = p.entities.filter((e) => e.id !== entity.id)));
          selectEntity(null);
        }}
      >
        Удалить персонажа
      </button>
    </div>
  );
}

// ───────────── нижняя панель ─────────────

type BottomTab = "problems" | "ink" | "globals" | "main" | "manifest";

export function BottomPanel({ splitter, open, onToggle }: { splitter?: React.ReactNode; open: boolean; onToggle: (open?: boolean) => void }) {
  const [tab, setTab] = useState<BottomTab>("problems");
  const check = useStore((s) => s.check);
  const project = useStore((s) => s.project)!;
  const key = useStore((s) => s.activeCanvas);
  const focusCard = useStore.getState().focusCard;
  const diags = check?.diagnostics ?? [];
  const errors = diags.filter((d) => d.severity === "error").length;
  const file =
    tab === "ink"
      ? key
        ? check?.build.canvases[key]?.text
        : ""
      : tab === "globals"
        ? check?.build.files.get("globals.ink")
        : tab === "main"
          ? check?.build.files.get("main.ink")
          : check?.build.files.get("manifest.json");
  const sorted = [...diags].sort((a, b) => (a.severity === b.severity ? 0 : a.severity === "error" ? -1 : 1));
  const show = (t: BottomTab) => {
    setTab(t);
    onToggle(true);
  };

  return (
    <section className={`dock ${open ? "" : "closed"}`}>
      {open && splitter}
      <div className="tabs">
        <button className={tab === "problems" ? "on" : ""} onClick={() => show("problems")}>
          Проблемы {errors > 0 && <span className="err-count">{errors}</span>}
          {diags.length - errors > 0 && <span className="warn-count">{diags.length - errors}</span>}
        </button>
        <button className={tab === "ink" ? "on" : ""} onClick={() => show("ink")}>ink файла</button>
        <button className={tab === "globals" ? "on" : ""} onClick={() => show("globals")}>globals.ink</button>
        <button className={tab === "main" ? "on" : ""} onClick={() => show("main")}>main.ink</button>
        <button className={tab === "manifest" ? "on" : ""} onClick={() => show("manifest")}>manifest.json</button>
        <span className="spacer" />
        <span className={errors ? "bad" : "good"}>{check ? (errors ? "ink не собирается" : check.storyJson ? "ink компилируется ✓" : "") : "проверка…"}</span>
        <IconButton icon={open ? ChevronDown : ChevronUp} className="tip-left tip-up" label={open ? "Скрыть нижнюю панель (Ctrl+\\)" : "Показать нижнюю панель"} onClick={() => onToggle()} />
      </div>
      {open && (
        <div className="dock-body">
          {tab === "problems" ? (
            <ul className="problems">
              {sorted.map((d, i) => (
                <li
                  key={i}
                  className={d.severity}
                  onClick={() => {
                    if (d.func) useStore.getState().inspectVariable("func", d.func);
                    else if (d.canvas && d.link) useStore.getState().focusLink(d.canvas, d.link);
                    else if (d.canvas) focusCard(d.canvas, d.card);
                  }}
                >
                  <span className="sev">{d.severity === "error" ? "ошибка" : "внимание"}</span>
                  {d.func && <span className="muted mono">функция {d.func}</span>}
                  {d.canvas && (
                    <span className="muted">
                      {project.canvases[d.canvas]?.title ?? d.canvas}
                      {d.card ? ` · ${d.card}` : ""}
                    </span>
                  )}
                  <span>{d.message}</span>
                </li>
              ))}
              {!sorted.length && <li className="muted">Проблем нет</li>}
            </ul>
          ) : (
            <pre className="ink-view">{file ?? ""}</pre>
          )}
        </div>
      )}
    </section>
  );
}
