import type { Canvas, Project } from "@visink/core";
import { namespaceError, namespaceName, qualifiedName } from "@visink/core";
import { mapStoryText } from "@visink/compiler";
import { mentions, replaceIdent } from "./ops";

/** Только поля с Ink-логикой, включая все вложенные потоки. */
function mapExpressions(project: Project, transform: (text: string, owner?: string, params?: string[]) => string) {
  for (const f of project.variables.functions) f.body = transform(f.body, f.owner, f.params);
  const visit = (canvas: Canvas) => {
    for (const c of canvas.cards) {
      if (c.condition) c.condition = transform(c.condition);
      if (c.action) c.action = transform(c.action);
      if (c.type === "line") {
        if (c.text) c.text = mapStoryText(project, c.text, transform);
        if (c.menuText) c.menuText = mapStoryText(project, c.menuText, transform);
      }
      if (c.type === "ink" && c.text) c.text = transform(c.text);
      if (c.flow) visit(c.flow);
    }
    for (const l of canvas.links) {
      if (l.condition) l.condition = transform(l.condition);
      if (l.action) l.action = transform(l.action);
    }
  };
  Object.values(project.canvases).forEach(visit);
}

export function renameNamespace(project: Project, id: string, name: string) {
  const error = namespaceError(project, name, id);
  if (error) throw new Error(error);
  const entity = project.entities.find((e) => e.id === id);
  const set = project.variables.sets?.find((s) => s.id === id);
  if (!entity && !set) throw new Error("Область не найдена");
  const previous = namespaceName(project, id);
  if (previous === name) return;
  const members = [...project.variables.vars, ...project.variables.lists, ...project.variables.functions].filter((v) => v.owner === id);
  mapExpressions(project, (text) => members.reduce((out, v) => replaceIdent(out, `${previous}.${v.name}`, `${name}.${v.name}`), text));
  if (entity) entity.technicalName = name;
  else set!.name = name;
}

export function addVariableSet(project: Project): string {
  const sets = project.variables.sets ??= [];
  let name = "new_set";
  for (let n = 2; namespaceError(project, name); n++) name = `new_set_${n}`;
  const used = new Set([...project.entities.map((e) => e.id), ...sets.map((s) => s.id)]);
  let id = "set_1";
  for (let n = 2; used.has(id); n++) id = `set_${n}`;
  sets.push({ id, name });
  return id;
}

/** Перемещение между глобальными переменными и наборами, с обновлением ссылок. */
export function moveVariable(project: Project, name: string, from: string | undefined, to: string | undefined) {
  moveMember(project, "var", name, from, to);
}
export function moveFunction(project: Project, name: string, from: string | undefined, to: string | undefined) {
  moveMember(project, "func", name, from, to);
}
function moveMember(project: Project, kind: "var" | "func", name: string, from: string | undefined, to: string | undefined) {
  if (from === to) return;
  if (to && !project.variables.sets?.some((s) => s.id === to)) throw new Error("Набор не найден");
  const variable = (kind === "var" ? project.variables.vars : project.variables.functions).find((v) => v.name === name && v.owner === from);
  if (!variable) throw new Error("Переменная не найдена");
  const members = [...project.variables.vars, ...project.variables.lists, ...project.variables.functions];
  if (members.some((v) => v.owner === to && v.name === name)) throw new Error("В этой области имя уже занято");
  if (!to && namespaceError(project, name)) throw new Error("Глобальное имя занято или недопустимо");
  const oldName = qualifiedName(project, variable);
  const nextName = qualifiedName(project, { name, owner: to });
  // Keep the moved function's original bindings, including calls to sibling functions.
  if (kind === "func" && "body" in variable) {
    let body = variable.body;
    for (const member of members) {
      if (variable.params.includes(member.name)) continue;
      if (from && member.owner === from) body = replaceIdent(body, member.name, qualifiedName(project, member));
    }
    // A global name cannot be qualified in Ink; reject moves that would capture it.
    for (const member of members.filter((m) => !m.owner)) {
      if (member !== variable && !variable.params.includes(member.name) && mentions(body, member.name) && members.some((m) => to && m.owner === to && m.name === member.name)) throw new Error("В целевом наборе затенено глобальное имя");
    }
    variable.body = body;
  }
  mapExpressions(project, (text, owner, params = []) => {
    if (!from && (params.includes(name) || members.some((v) => owner && v.owner === owner && v.name === name))) return text;
    let out = replaceIdent(text, oldName, nextName);
    if (from && owner === from && !params.includes(name)) out = replaceIdent(out, name, nextName);
    return out;
  });
  variable.owner = to;
}
