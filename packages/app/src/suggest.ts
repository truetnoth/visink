// Подсказки при вводе ink-выражений: переменные, списки и их элементы, функции, файлы, встроенные функции ink.
import type { Project } from "@visink/core";
import { INK_BUILTINS } from "@visink/checker";

export type SuggestionKind = "var" | "list" | "item" | "func" | "file" | "builtin" | "param";

export interface Suggestion {
  kind: SuggestionKind;
  /** что вставить вместо набранного слова */
  insert: string;
  label: string;
  hint?: string;
  /** куда поставить курсор относительно начала вставки (по умолчанию — в конец) */
  caret?: number;
}

export interface SuggestResult {
  /** заменяемый кусок текста: [from, to) */
  from: number;
  to: number;
  items: Suggestion[];
}

const LIMIT = 30;

function call(name: string, params: string[] | null, kind: SuggestionKind, hint?: string): Suggestion {
  // с параметрами — курсор внутрь скобок, без — после них
  const takesArgs = params === null || params.length > 0;
  return { kind, insert: `${name}()`, label: `${name}(${params?.join(", ") ?? "…"})`, hint, caret: takesArgs ? name.length + 1 : name.length + 2 };
}

/** Все возможные подсказки проекта. extra — локальные имена (параметры функции). */
export function candidates(project: Project, extra: string[] = [], owner?: string): Suggestion[] {
  const out: Suggestion[] = [];
  const name = (item: { name: string; owner?: string }) => item.owner ? `${item.owner}.${item.name}` : item.name;
  const entityName = (id: string | undefined) => project.entities.find((e) => e.id === id)?.name;
  for (const p of extra) out.push({ kind: "param", insert: p, label: p, hint: "параметр" });
  for (const v of project.variables.vars) {
    out.push({ kind: "var", insert: name(v), label: name(v), hint: `${entityName(v.owner) ?? "глобальная"} · ${v.type} = ${String(v.default)}` });
    if (owner && v.owner === owner) out.push({ kind: "var", insert: v.name, label: v.name, hint: `свойство · ${v.type}` });
  }
  for (const l of project.variables.lists) {
    out.push({ kind: "list", insert: name(l), label: name(l), hint: entityName(l.owner) ?? "список" });
    for (const i of l.items) out.push({ kind: "item", insert: `${name(l)}.${i}`, label: `${name(l)}.${i}`, hint: "элемент списка" });
  }
  for (const f of project.variables.functions) {
    out.push(call(name(f), f.params, "func", f.description || (f.external ? "реализует игра" : entityName(f.owner) ?? "функция")));
    if (owner && f.owner === owner) out.push(call(f.name, f.params, "func", "функция персонажа"));
  }
  for (const c of Object.values(project.canvases)) out.push({ kind: "file", insert: c.id, label: c.id, hint: `файл · ${c.title}` });
  for (const b of INK_BUILTINS) out.push(call(b, null, "builtin", "ink"));
  return out;
}

/**
 * Подсказки для слова под курсором. forced — вызвано Ctrl+Space: показываем и при пустом слове.
 * Внутри строки в кавычках подсказок нет.
 */
export function suggest(text: string, caret: number, project: Project, opts: { forced?: boolean; extra?: string[]; owner?: string } = {}): SuggestResult | null {
  const before = text.slice(0, caret);
  if ((before.match(/"/g)?.length ?? 0) % 2 === 1) return null;
  const word = /[A-Za-z_][\w]*(?:\.[\w]*){0,2}$/.exec(before)?.[0] ?? "";
  if (!word && !opts.forced) return null;
  const after = /^[\w.]*/.exec(text.slice(caret))?.[0] ?? "";
  const q = word.toLowerCase();
  const all = candidates(project, opts.extra, opts.owner);
  const starts = all.filter((s) => s.insert.toLowerCase().startsWith(q));
  const contains = q ? all.filter((s) => !s.insert.toLowerCase().startsWith(q) && s.insert.toLowerCase().includes(q)) : [];
  const items = [...starts, ...contains].slice(0, LIMIT);
  // ровно то, что уже набрано, подсказывать незачем
  if (!items.length || (items.length === 1 && items[0].insert === word + after)) return null;
  return { from: caret - word.length, to: caret + after.length, items };
}

/** Подставляет подсказку: новый текст и позиция курсора. */
export function applySuggestion(text: string, result: SuggestResult, s: Suggestion): { text: string; caret: number } {
  // у функции уже есть скобки после слова — не дублировать
  const hasParens = s.insert.endsWith("()") && text.slice(result.to).startsWith("(");
  const insert = hasParens ? s.insert.slice(0, -2) : s.insert;
  const caret = result.from + (hasParens ? insert.length + 1 : (s.caret ?? insert.length));
  return { text: text.slice(0, result.from) + insert + text.slice(result.to), caret };
}
