// свойства переменных, списков и функций: формы редактирования и «где используется»
import { useMemo, useState } from "react";
import type { InkFunction, InkListDef, Project, Variable as VarDef, VarType } from "@visink/core";
import { isValidInkName } from "@visink/core";
import { useStore } from "../store";
import { askUser } from "../tauriFs";
import { renameVariable, variableUsages } from "../ops";
import type { Usage } from "../ops";
import { ExprField, Field, Select, Text } from "./fields";
import { groupNames } from "./tree";
import { Combobox } from "../ui";

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
      <input className="mono" spellCheck={false} autoCapitalize="off" autoCorrect="off" autoFocus={name.startsWith("new_") || name.startsWith("NewList")} value={value} onChange={(e) => setValue(e.target.value)} onBlur={apply} onKeyDown={(e) => e.key === "Enter" && apply()} />
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

export function VariableProps({ name, project }: { name: string; project: Project }) {
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
            <Select value={v.default === true || v.default === "true" ? "true" : "false"} onChange={(b) => set((x) => (x.default = b === "true"))} options={[["true", "TRUE"], ["false", "FALSE"]]} />
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

export function FunctionProps({ name, project }: { name: string; project: Project }) {
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
        <input className="mono" spellCheck={false} autoCapitalize="off" autoCorrect="off" value={params} placeholder="who, amount" onChange={(e) => setParams(e.target.value)} onBlur={() => !bad.length && set((x) => (x.params = parsed))} />
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

export function ListProps({ name, project }: { name: string; project: Project }) {
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
          spellCheck={false}
          autoCapitalize="off"
          autoCorrect="off"
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
