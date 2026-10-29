// Общий поиск по проекту: файлы, карточки, стрелки, персонажи, переменные, списки.
import type { Project } from "@visink/core";

export type HitKind = "file" | "card" | "link" | "entity" | "var" | "list" | "func";

export interface Hit {
  kind: HitKind;
  /** что показать в списке */
  title: string;
  /** где найдено: файл, поле */
  detail?: string;
  /** файл (ключ в project.canvases) — для карточек и стрелок */
  key?: string;
  card?: string;
  link?: { from: string; to: string; port?: "yes" | "no" };
  /** id персонажа или имя переменной/списка */
  id?: string;
}

export const HIT_GROUPS: { kind: HitKind; title: string }[] = [
  { kind: "file", title: "Файлы" },
  { kind: "card", title: "Реплики и карточки" },
  { kind: "link", title: "Стрелки" },
  { kind: "entity", title: "Персонажи" },
  { kind: "var", title: "Переменные" },
  { kind: "list", title: "Списки" },
  { kind: "func", title: "Функции" },
];

const LIMIT = 30;

/** Ищет без учёта регистра; результаты по группам в порядке HIT_GROUPS, не больше LIMIT в группе. */
export function searchProject(project: Project, query: string): Map<HitKind, Hit[]> {
  const q = query.trim().toLowerCase();
  const out = new Map<HitKind, Hit[]>(HIT_GROUPS.map((g) => [g.kind, []]));
  if (!q) return out;
  const has = (...values: (string | undefined)[]) => values.some((v) => v?.toLowerCase().includes(q));
  const push = (hit: Hit) => {
    const list = out.get(hit.kind)!;
    if (list.length < LIMIT) list.push(hit);
  };

  const files = Object.entries(project.canvases).sort((a, b) => a[1].title.localeCompare(b[1].title));
  for (const [key, c] of files) {
    if (has(c.title, c.id)) push({ kind: "file", title: c.title, detail: c.id, key });
  }
  for (const [key, c] of files) {
    for (const card of c.cards) {
      if (!has(card.text, card.menuText, card.condition, card.action, card.id, card.entry, card.target, card.note)) continue;
      const speaker = project.entities.find((e) => e.id === card.speaker)?.name;
      push({
        kind: "card",
        title: card.text || card.menuText || card.condition || card.target || card.id,
        detail: [c.title, speaker, card.id].filter(Boolean).join(" · "),
        key,
        card: card.id,
      });
    }
    for (const l of c.links) {
      if (!has(l.condition, l.action)) continue;
      push({
        kind: "link",
        title: [l.condition && `{${l.condition}}`, l.action && `~ ${l.action}`].filter(Boolean).join(" "),
        detail: `${c.title} · ${l.from} → ${l.to}`,
        key,
        link: { from: l.from, to: l.to, ...(l.port ? { port: l.port } : {}) },
      });
    }
  }
  for (const e of project.entities) {
    if (has(e.name, e.inkName, e.id)) push({ kind: "entity", title: e.name, detail: e.inkName || undefined, id: e.id });
  }
  for (const v of project.variables.vars) {
    if (has(v.name, v.group, String(v.default))) push({ kind: "var", title: v.name, detail: [v.type, String(v.default), v.group].filter(Boolean).join(" · "), id: v.name });
  }
  for (const l of project.variables.lists) {
    if (has(l.name, ...l.items)) push({ kind: "list", title: l.name, detail: l.items.join(", "), id: l.name });
  }
  for (const f of project.variables.functions) {
    if (has(f.name, f.description, f.body, f.group)) push({ kind: "func", title: `${f.name}(${f.params.join(", ")})`, detail: f.description || f.group, id: f.name });
  }
  return out;
}
