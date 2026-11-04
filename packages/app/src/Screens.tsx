import { useEffect, useMemo, useRef, useState } from "react";
import { Play, Plus, RotateCcw, StepForward, Trash2 } from "lucide-react";
import { Story } from "inkjs";
import type { Entity, InkFunction, InkListDef, Project, Variable, VarType } from "@visink/core";
import { flowCards, isValidInkName } from "@visink/core";
import { scopedInkName } from "@visink/compiler";
import { unknownIdentifiers } from "@visink/checker";
import { EntityProps } from "./Panels";
import { logicalName, renameVariable } from "./ops";
import { useStore } from "./store";
import { CodeInput, Combobox, Select } from "./ui";

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
  const [checked, setChecked] = useState<Set<string>>(new Set());
  const vars = project.variables.vars.filter((v) => owner ? v.owner === owner : true);
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
      {vars.length > 0 && <div className="table-scroll">
        <table className="logic-table">
          <thead><tr><th><input type="checkbox" aria-label="Выбрать все переменные" checked={all} onChange={(e) => setChecked(e.target.checked ? new Set(vars.map(logicalName)) : new Set())} /></th><th>Раздел / группа</th><th>Имя</th><th>Описание</th><th>Тип</th><th>По умолчанию</th><th /></tr></thead>
          <tbody>
            {vars.map((v) => {
              const id = logicalName(v);
              const entity = project.entities.find((e) => e.id === v.owner);
              return <tr key={id} className={inspect?.kind === "var" && inspect.name === v.name && inspect.owner === v.owner ? "selected" : ""}>
                <td><input type="checkbox" aria-label={`Выбрать ${id}`} checked={checked.has(id)} onChange={(e) => setChecked((old) => { const next = new Set(old); if (e.target.checked) next.add(id); else next.delete(id); return next; })} /></td>
                <td>{owner ? <Combobox value={v.group ?? ""} options={groups} placeholder="Без группы" onChange={(group) => patch(v.name, (x) => { x.group = group || undefined; })} /> : <span>{entity ? <><span className="swatch" style={{ background: entity.color }} /> {entity.name}</> : "Глобальные"}</span>}</td>
                <td><LogicName item={v} kind="var" owner={v.owner} /></td>
                <td><input value={v.description ?? ""} placeholder="—" onChange={(e) => edit((p) => { const x = p.variables.vars.find((y) => y.name === v.name && y.owner === v.owner); if (x) x.description = e.target.value || undefined; })} /></td>
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
  const lists = project.variables.lists.filter((l) => owner ? l.owner === owner : true);
  const update = (source: InkListDef, fn: (l: InkListDef) => void) => edit((p) => {
    const l = p.variables.lists.find((x) => x.name === source.name && x.owner === source.owner);
    if (l) fn(l);
  });
  const add = () => edit((p) => p.variables.lists.push({ name: uniqueName("NewList", [...p.variables.vars, ...p.variables.lists, ...p.variables.functions], owner), items: [], initial: [], ...(owner ? { owner } : {}) }));
  const remove = (items: InkListDef[]) => {
    const names = new Set(items.map(logicalName));
    edit((p) => { p.variables.lists = p.variables.lists.filter((l) => !names.has(logicalName(l))); });
    setChecked(new Set());
  };
  return (
    <section className="logic-section">
      <div className="screen-section-head"><h3>Списки LIST <span className="muted">{lists.length}</span></h3><button onClick={add}><Plus size={14} /> Список</button>{checked.size > 0 && <button className="danger" onClick={() => remove(lists.filter((l) => checked.has(logicalName(l))))}><Trash2 size={14} /> Удалить выбранные ({checked.size})</button>}</div>
      {lists.length > 0 && <div className="logic-cards">
        {lists.map((l) => <div className="logic-card" key={logicalName(l)}>
          <div className="logic-card-head"><input type="checkbox" aria-label={`Выбрать ${logicalName(l)}`} checked={checked.has(logicalName(l))} onChange={(e) => setChecked((old) => { const next = new Set(old); if (e.target.checked) next.add(logicalName(l)); else next.delete(logicalName(l)); return next; })} /><LogicName item={l} kind="list" owner={l.owner} /><button className="row-delete" title="Удалить" onClick={() => remove([l])}><Trash2 size={14} /></button></div>
          <input value={l.description ?? ""} placeholder="Описание" onChange={(e) => update(l, (x) => { x.description = e.target.value || undefined; })} />
          <label className="field"><span className="field-label">Элементы через запятую</span><input className="mono" spellCheck={false} autoCapitalize="off" autoCorrect="off" defaultValue={l.items.join(", ")} onBlur={(e) => update(l, (x) => { x.items = e.target.value.split(",").map((v) => v.trim()).filter((v) => isValidInkName(v)); x.initial = x.initial.filter((v) => x.items.includes(v)); })} /></label>
          <div className="checks">{l.items.map((item) => <label className="check mono" key={item}><input type="checkbox" checked={l.initial.includes(item)} onChange={(e) => update(l, (x) => { x.initial = e.target.checked ? [...x.initial, item] : x.initial.filter((v) => v !== item); })} />{item}</label>)}</div>
        </div>)}
      </div>}
    </section>
  );
}

function FunctionsEditor({ project, owner }: { project: Project; owner?: string }) {
  const edit = useStore.getState().edit;
  const [checked, setChecked] = useState<Set<string>>(new Set());
  const functions = project.variables.functions.filter((f) => owner ? f.owner === owner : true);
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
          return <div className="logic-card" key={logicalName(f)}>
            <div className="logic-card-head"><input type="checkbox" aria-label={`Выбрать ${logicalName(f)}`} checked={checked.has(logicalName(f))} onChange={(e) => setChecked((old) => { const next = new Set(old); if (e.target.checked) next.add(logicalName(f)); else next.delete(logicalName(f)); return next; })} /><LogicName item={f} kind="func" owner={f.owner} /><button className="row-delete" title="Удалить" onClick={() => remove([f])}><Trash2 size={14} /></button></div>
            <div className="row2"><input className="mono" spellCheck={false} autoCapitalize="off" autoCorrect="off" defaultValue={f.params.join(", ")} placeholder="Параметры: who, amount" onBlur={(e) => update(f, (x) => { x.params = e.target.value.split(",").map((v) => v.trim()).filter((v) => isValidInkName(v)); })} /><input value={f.description ?? ""} placeholder="Описание" onChange={(e) => update(f, (x) => { x.description = e.target.value || undefined; })} /></div>
            <label className="check"><input type="checkbox" checked={!!f.external} onChange={(e) => update(f, (x) => { x.external = e.target.checked || undefined; })} />Реализует игра (EXTERNAL); здесь используется запасное тело</label>
            <CodeInput value={f.body} onChange={(body) => update(f, (x) => { x.body = body; })} project={project} extra={f.params} multiline rows={5} />
            {unknown.length > 0 && <div className="bad">Неизвестно: {unknown.join(", ")}</div>}
          </div>;
        })}
      </div>}
    </section>
  );
}

export function LogicWorkspace({ owner }: { owner?: string }) {
  const project = useStore((s) => s.project)!;
  return <div className="logic-workspace"><VariablesTable project={project} owner={owner} /><ListsEditor project={project} owner={owner} /><FunctionsEditor project={project} owner={owner} /></div>;
}

export function LogicScreen() {
  return <div className="screen-scroll"><div className="screen-title"><div><h2>Логика</h2><p>Переменные, списки и функции проекта. Свойства персонажей обозначены владельцем.</p></div></div><LogicWorkspace /></div>;
}

export function CharactersScreen() {
  const project = useStore((s) => s.project)!;
  const id = useStore((s) => s.selectedEntity);
  const entity = project.entities.find((e) => e.id === id) ?? project.entities[0];
  if (!entity) return <div className="empty-state">Создайте персонажа в дереве проекта</div>;
  return <div className="characters-screen"><aside className="character-settings"><EntityProps entity={entity} project={project} /></aside><div className="screen-scroll character-logic"><div className="screen-title"><div><h2>{entity.name}</h2><p>Свойства доступны в логике как <span className="mono">{entity.id}.имя</span>. Внутри его функций можно писать короткое имя.</p></div></div><LogicWorkspace owner={entity.id} /></div></div>;
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
    for (const c of Object.values(project.canvases)) {
      out.push({ value: c.id, label: c.title });
      for (const { card } of flowCards(c)) if (card.entry) out.push({ value: `${c.id}.${card.entry}`, label: `${c.title} / ${card.entry}` });
    }
    return out;
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
      next.ChoosePathString(start);
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
  const canvasKey = Object.keys(project.canvases).find((key) => project.canvases[key].id === canvasId);
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
      <div className="test-vars">{variables.map((v) => <div key={logicalName(v)}><span className="mono">{logicalName(v)}</span><span className="mono">{story ? String(story.variablesState[scopedInkName(v.owner, v.name)]) : "—"}</span></div>)}</div>
    </aside>
  </div>;
}
