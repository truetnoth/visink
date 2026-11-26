import { namespaceName, qualifiedName } from "@visink/core";
import { NamespaceField } from "./NamespaceField";
import { addVariableSet, moveVariable } from "./namespaceOps";
import { deleteVariableSet } from "./organization";
import { useEffect, useMemo, useRef, useState } from "react";
import { Play, Plus, RotateCcw, StepForward, Trash2 } from "lucide-react";
import { Story } from "inkjs";
import type { Entity, InkFunction, InkListDef, Project, Variable, VarType } from "@visink/core";
import { flowCards, isValidInkName, canvasLocations, withTextSpans } from "@visink/core";
import { resolveTarget, scopedInkName } from "@visink/compiler";
import { unknownIdentifiers } from "@visink/checker";
import { EntityProps } from "./Panels";
import { logicalName, renameVariable } from "./ops";
import { editAtomic, useStore } from "./store";
import { useTableColumns } from "./tableColumns";
import { CodeInput, Combobox, Select } from "./ui";
import { projectStats } from "./stats";

const VAR_TYPES: [VarType, string][] = [["bool", "bool"], ["int", "int"], ["float", "float"], ["string", "string"]];
const defaultFor = (type: VarType) => type === "bool" ? false : type === "string" ? "" : 0;

function uniqueName(base: string, items: { name: string; owner?: string }[], owner?: string) {
  const taken = new Set(items.filter((x) => x.owner === owner).map((x) => x.name));
  let name = base;
  for (let i = 2; taken.has(name); i++) name = `${base}_${i}`;
  return name;
}

function LogicName({ item, kind, owner }: { item: { name: string }; kind: "var" | "list" | "func"; owner?: string }) {
  const [value, setValue] = useState(item.name);
  const [previous, setPrevious] = useState(item.name);
  if (previous !== item.name) {
    setPrevious(item.name);
    setValue(item.name);
  }
  const apply = () => {
    const name = value.trim();
    if (name === item.name) return;
    if (!isValidInkName(name)) return setValue(item.name);
    const p = useStore.getState().project;
    const siblings = p ? [...p.variables.vars, ...p.variables.lists, ...p.variables.functions] : [];
    if (siblings.some((x) => x !== item && x.owner === owner && x.name === name)) return setValue(item.name);
    useStore.getState().edit((project) => renameVariable(project, item.name, name, owner));
    useStore.getState().inspectVariable(kind, name, owner);
  };
  return <input className="mono" spellCheck={false} autoCapitalize="off" autoCorrect="off" value={value} onChange={(e) => setValue(e.target.value)} onBlur={apply} onKeyDown={(e) => { if (e.key === "Enter") apply(); if (e.key === "Escape") setValue(item.name); }} />;
}

function DefaultValue({ item, onChange }: { item: Variable; onChange: (value: Variable["default"]) => void }) {
  if (item.type === "bool") return <Select value={item.default === true || item.default === "true" ? "true" : "false"} options={[{ value: "true", label: "TRUE" }, { value: "false", label: "FALSE" }]} onChange={(value) => onChange(value === "true")} />;
  if (item.type === "string") return <input value={String(item.default)} onChange={(e) => onChange(e.target.value)} />;
  return <input type="number" step={item.type === "int" ? 1 : "any"} value={String(item.default)} onChange={(e) => onChange(e.target.value === "" ? 0 : Number(e.target.value))} />;
}

function VariablesTable({ project, owner }: { project: Project; owner?: string }) {
  const edit = useStore.getState().edit;
  const inspect = useStore((s) => s.inspect);
  const [error, setError] = useState("");
  const [checked, setChecked] = useState<Set<string>>(new Set());
  const entityScope = project.entities.some((e) => e.id === owner);
  const columns = useTableColumns(entityScope ? "entity" : "global");
  const vars = project.variables.vars.filter((v) => v.owner === owner);
  const groups = [...new Set(project.variables.vars.map((v) => v.group).filter((x): x is string => !!x))].sort();
  const all = vars.length > 0 && vars.every((v) => checked.has(logicalName(v)));
  const patch = (name: string, fn: (v: Variable) => void) => edit((p) => {
    const v = p.variables.vars.find((x) => x.name === name && x.owner === owner);
    if (v) fn(v);
  });
  const remove = (items: Variable[]) => {
    const names = new Set(items.map(logicalName));
    edit((p) => { p.variables.vars = p.variables.vars.filter((v) => !names.has(logicalName(v))); });
    setChecked(new Set());
  };
  const add = () => {
    let name = "";
    edit((p) => {
      name = uniqueName("new_var", [...p.variables.vars, ...p.variables.lists, ...p.variables.functions], owner);
      p.variables.vars.push({ name, type: "bool", default: false, ...(owner ? { owner } : {}) });
    });
    useStore.getState().inspectVariable("var", name, owner);
  };
  return (
    <section className="logic-section">
      <div className="screen-section-head">
        <h3>Переменные <span className="muted">{vars.length}</span></h3>
        <button onClick={add}><Plus size={14} /> Переменная</button>
        {checked.size > 0 && <button className="danger" onClick={() => remove(vars.filter((v) => checked.has(logicalName(v))))}><Trash2 size={14} /> Удалить выбранные ({checked.size})</button>}
      </div>
      {error && <div className="bad" role="alert">{error}</div>}
      {vars.length > 0 && <div className="table-scroll" ref={columns.container}>
        <table className="logic-table"><colgroup>{columns.widths.map((width, i) => <col key={i} style={{ width: `${width * 100}%` }} />)}</colgroup>
          <thead><tr><th><input type="checkbox" aria-label="Выбрать все переменные" checked={all} onChange={(e) => setChecked(e.target.checked ? new Set(vars.map(logicalName)) : new Set())} />{columns.handle(0, "Выбор")}</th>{[entityScope ? "Группа" : "Набор", "Имя", "Описание", "Тип", "По умолчанию", "Удаление"].map((label, i) => <th key={label}>{i < 5 ? label : ""}{i < 5 ? columns.handle(i + 1, label) : null}</th>)}</tr></thead>
          <tbody>
            {vars.map((v) => {
              const id = logicalName(v);
              const entity = project.entities.find((e) => e.id === v.owner);
              return <tr key={id} data-logic-kind="var" data-logic-name={v.name} className={inspect?.kind === "var" && inspect.name === v.name && inspect.owner === v.owner ? "selected" : ""}>
                <td><input type="checkbox" aria-label={`Выбрать ${id}`} checked={checked.has(id)} onChange={(e) => setChecked((old) => { const next = new Set(old); if (e.target.checked) next.add(id); else next.delete(id); return next; })} /></td>
                <td>{entity ? <Combobox value={v.group ?? ""} options={groups} placeholder="Без группы" onChange={(group) => patch(v.name, (x) => { x.group = group || undefined; })} /> : <Select value={v.owner ?? ""} options={[{ value: "", label: "Глобальные" }, ...(project.variables.sets ?? []).map((s) => ({ value: s.id, label: s.name }))]} onChange={(next) => {
                  try { editAtomic((p) => moveVariable(p, v.name, v.owner, next || undefined)); setError(""); useStore.getState().inspectVariable("var", v.name, next || undefined); }
                  catch (e) { setError((e as Error).message); }
                }} />}</td>
                <td><LogicName item={v} kind="var" owner={v.owner} /></td>
                <td><input value={v.description ?? ""} placeholder="Введите описание" onChange={(e) => edit((p) => { const x = p.variables.vars.find((y) => y.name === v.name && y.owner === v.owner); if (x) { x.description = e.target.value || undefined; x.formatting = withTextSpans(x.formatting, "description", []); } })} /></td>
                <td><Select value={v.type} options={VAR_TYPES.map(([value, label]) => ({ value, label }))} onChange={(type) => edit((p) => { const x = p.variables.vars.find((y) => y.name === v.name && y.owner === v.owner); if (x) { x.type = type; x.default = defaultFor(type); } })} /></td>
                <td><DefaultValue item={v} onChange={(value) => edit((p) => { const x = p.variables.vars.find((y) => y.name === v.name && y.owner === v.owner); if (x) x.default = value; })} /></td>
                <td><button className="row-delete" title="Удалить" onClick={() => remove([v])}><Trash2 size={14} /></button></td>
              </tr>;
            })}
          </tbody>
        </table>
      </div>}
    </section>
  );
}

function ListsEditor({ project, owner }: { project: Project; owner?: string }) {
  const edit = useStore.getState().edit;
  const [checked, setChecked] = useState<Set<string>>(new Set());
  const lists = project.variables.lists.filter((l) => l.owner === owner);
  const update = (source: InkListDef, fn: (l: InkListDef) => void) => edit((p) => {
    const l = p.variables.lists.find((x) => x.name === source.name && x.owner === source.owner);
    if (l) fn(l);
  });

  const remove = (items: InkListDef[]) => {
    const names = new Set(items.map(logicalName));
    edit((p) => { p.variables.lists = p.variables.lists.filter((l) => !names.has(logicalName(l))); });
    setChecked(new Set());
  };
  if (!lists.length) return null;
  return (
    <details className="logic-section" open>
      <summary>Совместимость — существующие LIST</summary>
      <div className="screen-section-head"><h3>Списки LIST <span className="muted">{lists.length}</span></h3>{checked.size > 0 && <button className="danger" onClick={() => remove(lists.filter((l) => checked.has(logicalName(l))))}><Trash2 size={14} /> Удалить выбранные ({checked.size})</button>}</div>
      {lists.length > 0 && <div className="logic-cards">
        {lists.map((l) => <div className="logic-card" data-logic-kind="list" data-logic-name={l.name} key={logicalName(l)}>
          <div className="logic-card-head"><input type="checkbox" aria-label={`Выбрать ${logicalName(l)}`} checked={checked.has(logicalName(l))} onChange={(e) => setChecked((old) => { const next = new Set(old); if (e.target.checked) next.add(logicalName(l)); else next.delete(logicalName(l)); return next; })} /><LogicName item={l} kind="list" owner={l.owner} /><button className="row-delete" title="Удалить" onClick={() => remove([l])}><Trash2 size={14} /></button></div>
          <input value={l.description ?? ""} placeholder="Описание" onChange={(e) => edit((p) => { const x = p.variables.lists.find((item) => item.name === l.name && item.owner === l.owner); if (x) { x.description = e.target.value || undefined; x.formatting = withTextSpans(x.formatting, "description", []); } })} />
          <label className="field"><span className="field-label">Элементы через запятую</span><input className="mono" spellCheck={false} autoCapitalize="off" autoCorrect="off" defaultValue={l.items.join(", ")} onBlur={(e) => update(l, (x) => { x.items = e.target.value.split(",").map((v) => v.trim()).filter((v) => isValidInkName(v)); x.initial = x.initial.filter((v) => x.items.includes(v)); })} /></label>
          <div className="checks">{l.items.map((item) => <label className="check mono" key={item}><input type="checkbox" checked={l.initial.includes(item)} onChange={(e) => update(l, (x) => { x.initial = e.target.checked ? [...x.initial, item] : x.initial.filter((v) => v !== item); })} />{item}</label>)}</div>
        </div>)}
      </div>}
    </details>
  );
}

function FunctionsEditor({ project, owner }: { project: Project; owner?: string }) {
  const edit = useStore.getState().edit;
  const [checked, setChecked] = useState<Set<string>>(new Set());
  const functions = project.variables.functions.filter((f) => f.owner === owner);
  const update = (source: InkFunction, fn: (f: InkFunction) => void) => edit((p) => {
    const f = p.variables.functions.find((x) => x.name === source.name && x.owner === source.owner);
    if (f) fn(f);
  });
  const add = () => edit((p) => p.variables.functions.push({ name: uniqueName("new_function", [...p.variables.vars, ...p.variables.lists, ...p.variables.functions], owner), params: [], body: "~ return true", ...(owner ? { owner } : {}) }));
  const remove = (items: InkFunction[]) => {
    const names = new Set(items.map(logicalName));
    edit((p) => { p.variables.functions = p.variables.functions.filter((f) => !names.has(logicalName(f))); });
    setChecked(new Set());
  };
  return (
    <section className="logic-section">
      <div className="screen-section-head"><h3>Функции <span className="muted">{functions.length}</span></h3><button onClick={add}><Plus size={14} /> Функция</button>{checked.size > 0 && <button className="danger" onClick={() => remove(functions.filter((f) => checked.has(logicalName(f))))}><Trash2 size={14} /> Удалить выбранные ({checked.size})</button>}</div>
      {functions.length > 0 && <div className="logic-cards functions-grid">
        {functions.map((f) => {
          const unknown = unknownIdentifiers(f.body, project, f.params, f.owner);
          return <div className="logic-card" data-logic-kind="func" data-logic-name={f.name} key={logicalName(f)}>
            <div className="logic-card-head"><input type="checkbox" aria-label={`Выбрать ${logicalName(f)}`} checked={checked.has(logicalName(f))} onChange={(e) => setChecked((old) => { const next = new Set(old); if (e.target.checked) next.add(logicalName(f)); else next.delete(logicalName(f)); return next; })} /><LogicName item={f} kind="func" owner={f.owner} /><button className="row-delete" title="Удалить" onClick={() => remove([f])}><Trash2 size={14} /></button></div>
            <div className="row2"><input className="mono" spellCheck={false} autoCapitalize="off" autoCorrect="off" defaultValue={f.params.join(", ")} placeholder="Параметры: who, amount" onBlur={(e) => update(f, (x) => { x.params = e.target.value.split(",").map((v) => v.trim()).filter((v) => isValidInkName(v)); })} /><input value={f.description ?? ""} placeholder="Описание" onChange={(e) => edit((p) => { const x = p.variables.functions.find((item) => item.name === f.name && item.owner === f.owner); if (x) { x.description = e.target.value || undefined; x.formatting = withTextSpans(x.formatting, "description", []); } })} /></div>
            <label className="check"><input type="checkbox" checked={!!f.external} onChange={(e) => update(f, (x) => { x.external = e.target.checked || undefined; })} />Реализует игра (EXTERNAL); здесь используется запасное тело</label>
            <CodeInput value={f.body} onChange={(body) => update(f, (x) => { x.body = body; })} project={project} extra={f.params} owner={f.owner} multiline rows={5} />
            {unknown.length > 0 && <div className="bad">Неизвестно: {unknown.join(", ")}</div>}
          </div>;
        })}
      </div>}
    </section>
  );
}

export function LogicWorkspace({ owner }: { owner?: string }) {
  const project = useStore((s) => s.project)!;
  const inspect = useStore((s) => s.inspect);
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!inspect || inspect.owner !== owner) return;
    const row = ref.current?.querySelector<HTMLElement>(`[data-logic-kind="${inspect.kind}"][data-logic-name="${CSS.escape(inspect.name)}"]`);
    row?.scrollIntoView({ block: "nearest" });
    row?.querySelector<HTMLInputElement>('input:not([type="checkbox"]), textarea')?.focus({ preventScroll: true });
  }, [inspect, owner]);
  return <div className="logic-workspace" ref={ref}><VariablesTable project={project} owner={owner} /><ListsEditor project={project} owner={owner} /><FunctionsEditor project={project} owner={owner} /></div>;
}

export function LogicScreen() {
  const project = useStore((s) => s.project)!;
  const owner = useStore((s) => s.logicOwner);
  const set = project.variables.sets?.find((s) => s.id === owner);
  return <div className="screen-scroll"><div className="screen-content">
    <div className="screen-title"><h2>Переменные и логика</h2><button onClick={() => {
      let id = ""; useStore.getState().edit((p) => { id = addVariableSet(p); }); useStore.getState().selectLogicScope(id);
    }}><Plus size={14} /> Набор</button></div>

    {set && <div className="props pad"><NamespaceField key={set.id} project={project} id={set.id} />
      <label className="field"><span className="field-label">Описание набора</span><input value={set.description ?? ""} onChange={(e) => useStore.getState().edit((p) => { const target = p.variables.sets!.find((s) => s.id === set.id)!; target.description = e.target.value; target.formatting = withTextSpans(target.formatting, "description", []); })} /></label>
      <button onClick={() => { editAtomic((p) => deleteVariableSet(p, set.id)); useStore.getState().selectLogicScope(null); }}>Удалить набор</button>
    </div>}
    <LogicWorkspace key={set?.id ?? "globals"} owner={set?.id} />
  </div></div>;
}

export function CharactersScreen() {
  const project = useStore((s) => s.project)!;
  const id = useStore((s) => s.selectedEntity);
  const entity = project.entities.find((e) => e.id === id) ?? project.entities[0];
  if (!entity) return <div className="empty-state">Создайте сущность в дереве проекта</div>;
  return <div className="characters-screen"><aside className="character-settings"><EntityProps key={entity.id} entity={entity} project={project} /></aside><div className="character-logic"><LogicWorkspace key={entity.id} owner={entity.id} /></div></div>;
}

export function StatsScreen() {
  const project = useStore((s) => s.project)!;
  const stats = useMemo(() => projectStats(project), [project]);
  const rows: [string, number][] = [
    ["Слова", stats.words],
    ["Элементы", stats.elements],
    ["Реплики", stats.lines],
    ["Варианты игрока", stats.playerOptions],
    ["Хабы", stats.hubs],
    ["Условия", stats.conditions],
    ["Заметки", stats.notes],
    ["Переходы", stats.jumps],
    ["Чистый Ink", stats.inkCards],
    ["Вложенности", stats.flows],
    ["Связи", stats.links],
    ["Группы", stats.groups],
    ["Сущности", stats.entities],
    ["Переменные и LIST", stats.variables],
    ["Функции", stats.functions],
    ["Наборы", stats.sets],
  ];
  return <div className="screen-scroll"><div className="screen-content stats-content">
    <div className="screen-title"><h2>Статистика проекта</h2></div>
    <dl className="stats-list">{rows.map(([label, value]) => <div key={label}><dt>{label}</dt><dd>{value}</dd></div>)}</dl>
    <p className="muted">Слова — в тексте реплик, вариантов, ремарок, описаний вложенностей и заметок. Элементы — обычные карточки и заметки на всех уровнях. Технические входы, выходы и их связи не учитываются.</p>
  </div></div>;
}

type TestLine = { text: string; tags: string[] };

export function TestingScreen() {
  const project = useStore((s) => s.project)!;
  const check = useStore((s) => s.check);
  const active = useStore((s) => s.activeCanvas);
  const [target, setTarget] = useState(() => project.settings.start ?? (active ? project.canvases[active]?.id : "") ?? "");
  const [story, setStory] = useState<Story | null>(null);
  const [lines, setLines] = useState<TestLine[]>([]);
  const [error, setError] = useState("");
  const [running, setRunning] = useState(false);
  const log = useRef<HTMLDivElement>(null);
  const targets = useMemo(() => {
    const out: { value: string; label: string }[] = [];
    for (const { canvas: c } of canvasLocations(project)) {
      out.push({ value: c.id, label: c.title });
      for (const card of c.cards) if (card.entry) {
        const address = c.legacyId ?? c.id;
        out.push({ value: `${address}.entry_${card.entry}`, label: `${c.title} / ${card.entry}` });
      }
    }
    return [...new Map(out.map((item) => [item.value, item])).values()];
  }, [project.canvases]);

  const reset = (start = target) => {
    setError("");
    setLines([]);
    setStory(null);
    setRunning(false);
    if (!check?.storyJson || !start) return;
    try {
      const next = new Story(check.storyJson);
      next.allowExternalFunctionFallbacks = true;
      const runtimeTarget = resolveTarget(project, start);
      if (!runtimeTarget) throw new Error(`Стартовая точка «${start}» не найдена`);
      next.ChoosePathString(runtimeTarget);
      setStory(next);
      setRunning(true);
    } catch (e) {
      setError((e as Error).message);
    }
  };
  useEffect(() => { reset(target); }, [check?.storyJson]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => { log.current?.scrollTo({ top: log.current.scrollHeight }); }, [lines]);

  const advance = () => {
    if (!story) return;
    try {
      while (story.canContinue) {
        const text = story.Continue();
        if (text?.trim()) setLines((old) => [...old, { text: text.trim(), tags: story.currentTags ?? [] }]);
        if (!story.canContinue) break;
      }
      if (!story.canContinue) setRunning(false);
    } catch (e) {
      setError((e as Error).message);
      setRunning(false);
    }
  };
  useEffect(() => { if (running && story?.canContinue) advance(); }, [story, running]); // eslint-disable-line react-hooks/exhaustive-deps
  const choose = (index: number) => {
    if (!story) return;
    try {
      story.ChooseChoiceIndex(index);
      setRunning(true);
    } catch (e) { setError((e as Error).message); }
  };
  const currentTags = lines.at(-1)?.tags ?? [];
  const currentId = currentTags.find((t) => t.trim().startsWith("id:"))?.replace(/^\s*id:\s*/, "");
  const [canvasId, cardId] = currentId?.split(".") ?? [];
  const canvasKey = canvasLocations(project).find(({ canvas }) => canvas.id === canvasId || canvas.legacyId === canvasId)?.canvas.id;
  const variables = [...project.variables.vars, ...project.variables.lists];
  const choices = story && !story.canContinue ? story.currentChoices : [];

  return <div className="testing-screen">
    <div className="testing-main">
      <div className="screen-title testing-toolbar"><div><h2>Тестирование</h2><p>Запуск настоящей сборки Ink. EXTERNAL используют свои запасные тела.</p></div><div className="row"><Select value={target || null} options={targets} onChange={(value) => { setTarget(value); reset(value); }} /><button onClick={() => reset()} disabled={!check?.storyJson}><RotateCcw size={14} /> Заново</button></div></div>
      {check && !check.storyJson && <div className="problem error">Исправьте ошибки сборки — запуск пока недоступен.</div>}
      {error && <div className="problem error">{error}</div>}
      <div className="story-log" ref={log}>{lines.map((line, i) => <div className="story-line" key={i}>{line.text}</div>)}{!lines.length && <div className="muted">История ещё не вывела текст.</div>}</div>
      <div className="story-controls">
        {story?.canContinue && <button className="primary" onClick={advance}><StepForward size={15} /> Продолжить</button>}
        {choices.map((choice) => <button className="story-choice" key={choice.index} onClick={() => choose(choice.index)}><Play size={14} />{choice.text}</button>)}
        {story && !story.canContinue && !choices.length && !error && <span className="muted">Фрагмент завершён. Можно начать заново.</span>}
      </div>
    </div>
    <aside className="testing-state">
      <h3>Текущая карточка</h3>
      {currentId ? <><div className="mono">{currentId}</div>{canvasKey && cardId && <button className="wide" onClick={() => useStore.getState().focusCard(canvasKey, cardId)}>Показать на холсте</button>}</> : <div className="muted">Появится после реплики</div>}
      <h3>Теги</h3>{currentTags.length ? currentTags.map((tag) => <div className="mono test-tag" key={tag}>{tag}</div>) : <div className="muted">Нет тегов</div>}
      <h3>Переменные</h3>
      <div className="test-vars">{variables.map((v) => <div key={logicalName(v)}><span className="mono">{qualifiedName(project, v)}</span><span className="mono">{story ? String(story.variablesState[scopedInkName(v.owner, v.name, project)]) : "—"}</span></div>)}</div>
    </aside>
  </div>;
}
