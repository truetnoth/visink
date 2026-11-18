import type { Project } from "./model";
import { isValidInkName } from "./ids";

/** owner хранит стабильный ID; в выражениях используется редактируемое имя. */
export function namespaceName(project: Project, owner: string): string {
  const entity = project.entities.find((e) => e.id === owner);
  return entity ? entity.technicalName ?? entity.id : project.variables.sets?.find((s) => s.id === owner)?.name ?? owner;
}

export function qualifiedName(project: Project, item: { name: string; owner?: string }): string {
  return item.owner ? `${namespaceName(project, item.owner)}.${item.name}` : item.name;
}

export function namespaceError(project: Project, name: string, id?: string): string | undefined {
  if (!isValidInkName(name)) return "Используйте латиницу, цифры и _, начиная с буквы или _.";
  if (/^(true|false|not|and|or|mod|VAR|CONST|LIST|INCLUDE|EXTERNAL|function|return|temp|else|DONE|END)$/i.test(name)) return "Это служебное имя Ink.";
  if (project.entities.some((e) => e.id !== id && (e.technicalName ?? e.id) === name)
    || project.variables.sets?.some((s) => s.id !== id && s.name === name)
    || Object.values(project.canvases).some((c) => c.id === name)
    || [...project.variables.vars, ...project.variables.lists, ...project.variables.functions].some((v) => !v.owner && v.name === name)) return "Это имя уже занято.";
  if (id) {
    const seen = new Set<string>();
    for (const v of [...project.variables.vars, ...project.variables.lists, ...project.variables.functions]) {
      const compiled = v.owner ? `${v.owner === id ? name : namespaceName(project, v.owner)}__${v.name}` : v.name;
      if (seen.has(compiled)) return "Это имя создаст конфликт переменных в сборке Ink.";
      seen.add(compiled);
    }
  }
}
