import type { Canvas, Card, Link, Project, Variable } from "@visink/core";
import { flowCards, guessStart, isPlayerCard, isValidInkName, stableStringify } from "@visink/core";
import { escapeInkText, escapeTagValue } from "./escape";

export { escapeInkText, escapeTagValue } from "./escape";

export type Severity = "error" | "warning";

export interface Diagnostic {
  severity: Severity;
  code: string;
  message: string;
  /** ключ файла в project.canvases */
  canvas?: string;
  card?: string;
  /** стрелка, в логике которой ошибка */
  link?: LinkRef;
  /** функция, в теле которой ошибка */
  func?: string;
  funcOwner?: string;
}

export interface LinkRef {
  from: string;
  to: string;
  port?: "yes" | "no";
}

/** Откуда взялась строка ink: карточка (и стрелка) файла или функция в globals.ink. */
export interface LineRef {
  canvas?: string;
  card?: string;
  link?: LinkRef;
  func?: string;
  funcOwner?: string;
}

export interface CompiledCanvas {
  key: string;
  file: string;
  text: string;
  /** lineMap[номер строки − 1] → карточка, из которой строка получена */
  lineMap: (LineRef | null)[];
  /** ink каждой карточки отдельно — для превью в панели свойств */
  cardInk: Record<string, string>;
}

export interface Manifest {
  version: 1;
  start: string | null;
  canvases: {
    id: string;
    title: string;
    file: string;
    entries: { name: string; path: string }[];
  }[];
  /** функции, которые игра должна привязать (BindExternalFunction) */
  externals: { name: string; params: string[]; description?: string; owner?: string; sourceName?: string }[];
  characters: {
    id: string;
    name: string;
    inkName: string;
    color: string;
    portrait?: string;
    isPlayer?: boolean;
  }[];
  lines: Record<string, { canvas: string; card: string; speaker?: string; text: string; emotion?: string }>;
}

export interface BuildResult {
  files: Map<string, string>;
  lineMaps: Map<string, (LineRef | null)[]>;
  canvases: Record<string, CompiledCanvas>;
  diagnostics: Diagnostic[];
  manifest: Manifest;
}

const HEADER = "// Сгенерировано Visink — не править вручную, правки пропадут при следующей сборке.";

/** Условие на входе в карточку. У карточки «условие» поле condition — это её вопрос, а не вход. */
function gateOf(card: Card): string {
  if (card.type === "condition") return "";
  return card.condition?.trim() ?? "";
}

function actionLines(action: string | undefined): string[] {
  if (!action) return [];
  return action
    .split("\n")
    .map((l) => l.trim())
    .filter(Boolean)
    .map((l) => (l.startsWith("~") ? l : `~ ${l}`));
}

function sortLinks(links: Link[]): Link[] {
  return [...links].sort((a, b) => a.order - b.order || a.to.localeCompare(b.to));
}

class Emitter {
  lines: string[] = [];
  map: (LineRef | null)[] = [];
  push(line: string, ref: LineRef | null = null) {
    this.lines.push(line);
    this.map.push(ref);
  }
}

export function stitchName(card: Card): string {
  return card.id;
}

export const scopedInkName = (owner: string | undefined, name: string) => owner ? `${owner}__${name}` : name;

function replaceLogicToken(text: string, from: string, to: string): string {
  const escaped = from.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const re = new RegExp(`(?<![\\w.])${escaped}(?![\\w])`, "g");
  return text.split(/("[^"]*")/).map((part, i) => i % 2 ? part : part.replace(re, to)).join("");
}

/** Переводит редакторские ссылки на свойства персонажей в глобальные имена Ink. */
export function compileLogic(project: Project, text: string, owner?: string, params: string[] = []): string {
  const owned = [...project.variables.vars, ...project.variables.lists, ...project.variables.functions].filter((x) => x.owner);
  let out = text;
  for (const item of owned) out = replaceLogicToken(out, `${item.owner}.${item.name}`, scopedInkName(item.owner, item.name));
  if (owner) {
    for (const item of owned.filter((x) => x.owner === owner && !params.includes(x.name))) {
      out = replaceLogicToken(out, item.name, scopedInkName(owner, item.name));
    }
  }
  return out;
}

/** Визуальные слои одного файла в плоской форме для существующего генератора Ink. */
export function flattenCanvas(root: Canvas): Canvas {
  const out: Canvas = { ...root, cards: [], links: [], layout: {}, groups: [], notes: [], graveyard: [] };
  const visit = (canvas: Canvas) => {
    for (const card of canvas.cards) {
      const { flow: _flow, ...plain } = card;
      out.cards.push(plain);
      if (canvas.layout[card.id]) out.layout[card.id] = canvas.layout[card.id];
    }
    out.links.push(...canvas.links.filter((link) => {
      const source = canvas.cards.find((card) => card.id === link.from);
      return source?.type !== "flow" || !source.flow;
    }));
    out.notes.push(...canvas.notes);
    out.groups.push(...canvas.groups);
    out.graveyard.push(...canvas.graveyard);
    for (const card of canvas.cards) {
      if (!card.flow) continue;
      if (card.type !== "flow") {
        visit(card.flow);
        continue;
      }
      const nestedStart = out.cards.length;
      const nestedLinkStart = out.links.length;
      visit(card.flow);
      const nestedCards = out.cards.slice(nestedStart);
      const parentLinks = canvas.links.filter((link) => link.from === card.id);
      if (!nestedCards.length) {
        out.links.push(...parentLinks);
        continue;
      }
      const nestedIds = new Set(nestedCards.map((nested) => nested.id));
      const hasOutgoing = new Set(out.links.slice(nestedLinkStart).filter((link) => nestedIds.has(link.from)).map((link) => link.from));
      const start = rootCard(card.flow);
      if (start) out.links.push({ from: card.id, to: start.id, order: 0, kind: "divert" });
      for (const terminal of nestedCards) {
        if (hasOutgoing.has(terminal.id)) continue;
        for (const link of parentLinks) out.links.push({ ...link, from: terminal.id });
      }
    }
  };
  visit(root);
  return out;
}

/** С какой карточки начинается узел файла: явное начало, иначе догадка (см. guessStart). */
export function rootCard(canvas: Canvas): Card | undefined {
  return canvas.cards.find((c) => c.id === canvas.start) ?? guessStart(canvas);
}

/** Ищет цель перехода "canvas", "canvas.entry" или "canvas.cardId" и возвращает путь ink. */
export function resolveTarget(project: Project, target: string): string | null {
  const [canvasId, sub] = target.trim().split(".", 2);
  const canvas = Object.values(project.canvases).find((c) => c.id === canvasId);
  if (!canvas) return null;
  if (!sub) return canvas.id;
  const cards = flowCards(canvas).map((x) => x.card);
  const name = sub.startsWith("entry_") ? sub.slice(6) : sub;
  if (cards.some((c) => c.entry === name)) return `${canvas.id}.entry_${name}`;
  const card = cards.find((c) => c.id === sub);
  if (card) return `${canvas.id}.${stitchName(card)}`;
  return null;
}

export function compileCanvas(project: Project, key: string, source: Canvas, diagnostics: Diagnostic[] = []): CompiledCanvas {
  const flat = flattenCanvas(source);
  const compile = (text: string | undefined) => text == null ? undefined : compileLogic(project, text);
  const canvas: Canvas = {
    ...flat,
    cards: flat.cards.map((card) => ({ ...card, condition: compile(card.condition), action: compile(card.action), ...(card.type === "ink" ? { text: compile(card.text) } : {}) })),
    links: flat.links.map((link) => ({ ...link, condition: compile(link.condition), action: compile(link.action) })),
  };
  const seenCards = new Set<string>();
  for (const card of canvas.cards) {
    if (seenCards.has(card.id)) diagnostics.push({ severity: "error", code: "duplicate-card", canvas: key, card: card.id, message: `Id карточки «${card.id}» повторяется во вложенных потоках` });
    seenCards.add(card.id);
  }
  const byId = new Map(canvas.cards.map((c) => [c.id, c]));
  const sourceById = new Map(flowCards(source).map(({ card }) => [card.id, card]));
  const playerOption = (card: Card): Card | undefined => {
    if (isPlayerCard(project, card)) return card;
    if (card.type !== "flow") return undefined;
    const inner = sourceById.get(card.id)?.flow;
    const start = inner && rootCard(inner);
    return start ? playerOption(start) : undefined;
  };
  const outgoing = new Map<string, Link[]>();
  for (const link of canvas.links) {
    if (!outgoing.has(link.from)) outgoing.set(link.from, []);
    outgoing.get(link.from)!.push(link);
  }
  for (const [k, v] of outgoing) outgoing.set(k, sortLinks(v));

  const diag = (severity: Severity, code: string, message: string, card?: string) =>
    diagnostics.push({ severity, code, message, canvas: key, card });

  const divert = (id: string, from: Card): string => {
    const target = byId.get(id);
    if (!target) {
      diag("error", "broken-link", `Стрелка ведёт на несуществующую карточку ${id}`, from.id);
      return "-> DONE";
    }
    return `-> ${stitchName(target)}`;
  };

  /** Строка ink; card и link — куда показывать ошибки в ней (по умолчанию — на текущую карточку). */
  type Out = string | { text: string; card?: string; link?: LinkRef };

  const refOf = (l: Link): LinkRef => ({ from: l.from, to: l.to, ...(l.port ? { port: l.port } : {}) });
  const linkCond = (l: Link) => l.condition?.trim() ?? "";
  const both = (a: string, b: string) => (a && b ? `(${a}) and (${b})` : a || b);
  /** Действие стрелки строками с отступом — внутри выбора или ветки. */
  const linkActions = (l: Link, from: Card): Out[] =>
    actionLines(l.action).map((text) => ({ text: `    ${text}`, card: from.id, link: refOf(l) }));

  const routing = (card: Card): Out[] => {
    const links = outgoing.get(card.id) ?? [];
    // ветка без продолжения — конец диалога
    if (!links.length) return ["-> DONE"];
    const pairs = links.flatMap((l) => {
      const t = byId.get(l.to);
      return t ? [{ l, t, choice: playerOption(t) }] : [];
    });
    if (!pairs.length) return [divert(links[0].to, card)];
    const players = pairs.filter(({ choice }) => choice);
    const condOf = ({ l, t }: { l: Link; t: Card }) => both(gateOf(t), linkCond(l));
    if (players.length) {
      const ordinary = pairs.filter(({ choice }) => !choice);
      if (ordinary.some((pair) => !condOf(pair))) {
        diag("error", "mixed-links", "При вариантах игрока обычная карточка должна иметь условие на входном пине", card.id);
      }
      const routes = ordinary.flatMap(({ l, t }): Out[] => {
        const cond = condOf({ l, t });
        if (!cond) return [];
        const ref = { card: linkCond(l) && !gateOf(t) ? card.id : t.id, ...(linkCond(l) ? { link: refOf(l) } : {}) };
        const acts = linkActions(l, card);
        return acts.length
          ? [{ text: `{ ${cond}:`, ...ref }, ...acts, `    ${divert(t.id, card)}`, "}"]
          : [{ text: `{${cond}: ${divert(t.id, card)}}`, ...ref }];
      });
      const ordered = [...players.filter(({ choice }) => choice!.repeat !== "fallback"), ...players.filter(({ choice }) => choice!.repeat === "fallback")];
      return [...routes, ...ordered.flatMap(({ l, t, choice }): Out[] => {
        const option = choice!;
        const gate = option.id === t.id ? gateOf(t) : both(gateOf(t), gateOf(option));
        const lc = linkCond(l);
        const conds = [gate, lc].filter(Boolean).map((c) => `{${c}} `).join("");
        // ошибка в условии — на стрелке, если условие есть на ней, иначе на варианте
        const ref = { card: lc && !gate ? card.id : t.id, ...(lc ? { link: refOf(l) } : {}) };
        const head =
          option.repeat === "fallback" ? `* ${conds}->` : `${option.repeat === "sticky" ? "+" : "*"} ${conds}[${escapeInkText(option.menuText || option.text || "…")}]`;
        const acts = linkActions(l, card);
        const target = `-> ${stitchName(t)}`;
        if (!acts.length) return [{ text: option.repeat === "fallback" ? `${head} ${stitchName(t)}` : `${head} ${target}`, ...ref }];
        return [{ text: head, ...ref }, ...acts, { text: `    ${target}`, card: t.id }];
      })];
    }
    if (!condOf(pairs[0])) {
      if (pairs.length > 1) diag("warning", "unreachable-branch", "Несколько стрелок без условия: сработает только первая", card.id);
      const { l, t } = pairs[0];
      return [...actionLines(l.action).map((text) => ({ text, card: card.id, link: refOf(l) })), divert(t.id, card)];
    }
    const out: Out[] = ["{"];
    let hasElse = false;
    for (const pair of pairs) {
      if (hasElse) {
        diag("warning", "unreachable-branch", "Несколько стрелок без условия: сработает только первая", card.id);
        break;
      }
      const { l, t } = pair;
      const cond = condOf(pair);
      const label = cond ? `- ${cond}:` : "- else:";
      const ref = { card: linkCond(l) && !gateOf(t) ? card.id : t.id, ...(linkCond(l) ? { link: refOf(l) } : {}) };
      const acts = linkActions(l, card);
      if (acts.length) out.push({ text: label, ...ref }, ...acts, `    ${divert(t.id, card)}`);
      else out.push({ text: `${label} ${divert(t.id, card)}`, ...ref });
      if (!cond) hasElse = true;
    }
    if (!hasElse) out.push("- else: -> DONE");
    out.push("}");
    return out;
  };

  const lineText = (card: Card): string | null => {
    const text = escapeInkText(card.text ?? "");
    if (!text) {
      if (!isPlayerCard(project, card)) diag("warning", "empty-line", "Пустая реплика", card.id);
      return null;
    }
    const speaker = project.entities.find((e) => e.id === card.speaker);
    const prefix = speaker?.inkName ? `${speaker.inkName}: ` : "";
    const tags = [`id: ${canvas.id}.${card.id}`];
    if (speaker) tags.push(`speaker: ${speaker.id}`);
    if (card.emotion) tags.push(`emotion: ${escapeTagValue(card.emotion)}`);
    if (card.stageDirection) tags.push(`dir: ${escapeTagValue(card.stageDirection)}`);
    for (const k of Object.keys(card.tags ?? {}).sort()) {
      tags.push(`${escapeTagValue(k)}: ${escapeTagValue(card.tags![k])}`);
    }
    return `${prefix}${text} # ${tags.join(" # ")}`;
  };

  const body = (card: Card): Out[] => {
    switch (card.type) {
      case "line": {
        const line = lineText(card);
        return [...(line ? [line] : []), ...actionLines(card.action), ...routing(card)];
      }
      case "hub":
        return [...actionLines(card.action), ...routing(card)];
      case "flow": {
        const inner = sourceById.get(card.id)?.flow;
        const start = inner && rootCard(inner);
        return [...actionLines(card.action), ...(start ? [divert(start.id, card)] : routing(card))];
      }
      case "condition": {
        const links = outgoing.get(card.id) ?? [];
        const yes = links.find((l) => l.port === "yes");
        const no = links.find((l) => l.port === "no");
        let cond = card.condition?.trim();
        if (!cond) {
          diag("error", "empty-condition", "У карточки-условия не задано условие", card.id);
          cond = "true";
        }
        const y = yes ? divert(yes.to, card) : "-> DONE";
        const n = no ? divert(no.to, card) : "-> DONE";
        for (const l of [yes, no]) {
          if (l && linkCond(l)) diag("warning", "port-condition", "Условие на выходе «да»/«нет» не используется — только действие", card.id);
        }
        const yesActs = yes ? linkActions(yes, card) : [];
        const noActs = no ? linkActions(no, card) : [];
        if (!yesActs.length && !noActs.length) return [...actionLines(card.action), `{${cond}: ${y} | ${n}}`];
        return [...actionLines(card.action), `{ ${cond}:`, ...yesActs, `    ${y}`, "- else:", ...noActs, `    ${n}`, "}"];
      }
      case "jump": {
        const target = card.target?.trim() ?? "";
        const path = target ? resolveTarget(project, target) : null;
        if (!path) {
          diag("error", "broken-jump", target ? `Цель перехода «${target}» не найдена` : "У перехода не задана цель", card.id);
        }
        return [...actionLines(card.action), path ? `-> ${path}` : "-> DONE"];
      }
      case "ink": {
        const raw = (card.text ?? "").replace(/\s+$/, "");
        const lines = raw ? raw.split("\n") : [];
        const links = outgoing.get(card.id) ?? [];
        return links.length ? [...lines, ...routing(card)] : lines;
      }
    }
  };

  // Порядок стежков: обход в глубину от корня и точек входа, недостижимые — в конце по id.
  const order: Card[] = [];
  const visited = new Set<string>();
  const root = rootCard(canvas);
  if (canvas.cards.length && !canvas.cards.some((c) => c.id === canvas.start)) {
    diag("warning", "no-start", `У файла не задано начало — диалог начнётся с карточки ${root?.id}`, root?.id);
  }
  const entries = canvas.cards.filter((c) => c.entry).sort((a, b) => a.entry!.localeCompare(b.entry!) || a.id.localeCompare(b.id));
  const seeds = [...(root ? [root] : []), ...entries];
  const stack = [...seeds].reverse().map((c) => c.id);
  while (stack.length) {
    const id = stack.pop()!;
    if (visited.has(id)) continue;
    const card = byId.get(id);
    if (!card) continue;
    visited.add(id);
    order.push(card);
    const next = (outgoing.get(id) ?? []).map((l) => l.to);
    for (let i = next.length - 1; i >= 0; i--) if (!visited.has(next[i])) stack.push(next[i]);
  }
  for (const card of [...canvas.cards].sort((a, b) => a.id.localeCompare(b.id))) {
    if (!visited.has(card.id)) order.push(card);
  }

  const entryNames = new Set<string>();
  for (const card of entries) {
    const name = card.entry!;
    if (!isValidInkName(name)) {
      diag("error", "bad-entry-name", `Имя точки входа «${name}»: только латиница, цифры и _`, card.id);
    }
    if (entryNames.has(name)) diag("error", "duplicate-entry", `Точка входа «${name}» уже есть в файле`, card.id);
    entryNames.add(name);
  }

  const out = new Emitter();
  out.push(HEADER);
  out.push(`=== ${canvas.id} ===`);
  if (root) out.push(`-> ${stitchName(root)}`, { canvas: key, card: root.id });
  else out.push("-> DONE");
  for (const card of entries) {
    out.push(`= entry_${card.entry}`, { canvas: key, card: card.id });
    out.push(`-> ${stitchName(card)}`, { canvas: key, card: card.id });
  }
  const cardInk: Record<string, string> = {};
  for (const card of order) {
    const block: Out[] = [`= ${stitchName(card)}`, ...body(card)];
    const texts: string[] = [];
    for (const line of block) {
      const text = typeof line === "string" ? line : line.text;
      const ref: LineRef =
        typeof line === "string" ? { canvas: key, card: card.id } : { canvas: key, card: line.card ?? card.id, ...(line.link ? { link: line.link } : {}) };
      out.push(text, ref);
      texts.push(text);
    }
    cardInk[card.id] = texts.join("\n");
  }

  return {
    key,
    file: `${canvas.id}.ink`,
    text: out.lines.join("\n") + "\n",
    lineMap: out.map,
    cardInk,
  };
}

function varLiteral(v: Variable): string {
  switch (v.type) {
    case "bool":
      return v.default === true || v.default === "true" ? "true" : "false";
    case "int":
      return String(Math.trunc(Number(v.default) || 0));
    case "float": {
      const n = Number(v.default) || 0;
      return Number.isInteger(n) ? n.toFixed(1) : String(n);
    }
    case "string":
      return `"${String(v.default ?? "").replace(/"/g, "'")}"`;
  }
}

export function compileGlobals(project: Project, diagnostics: Diagnostic[] = []): { text: string; lineMap: (LineRef | null)[] } {
  const out = new Emitter();
  out.push(HEADER);
  const seen = new Set<string>();
  const check = (sourceName: string, owner?: string, func?: string) => {
    const name = scopedInkName(owner, sourceName);
    const ref = { ...(func ? { func } : {}), ...(owner ? { funcOwner: owner } : {}) };
    if (!isValidInkName(name)) {
      diagnostics.push({ severity: "error", code: "bad-var-name", message: `Имя «${sourceName}»: только латиница, цифры и _`, ...ref });
    }
    if (seen.has(name)) diagnostics.push({ severity: "error", code: "duplicate-var", message: `Имя «${name}» объявлено дважды`, ...ref });
    seen.add(name);
  };
  for (const v of project.variables.vars) {
    check(v.name, v.owner);
    out.push(`VAR ${scopedInkName(v.owner, v.name)} = ${varLiteral(v)}`);
  }
  for (const l of project.variables.lists) {
    check(l.name, l.owner);
    const items = l.items.map((i) => (l.initial.includes(i) ? `(${i})` : i));
    out.push(`LIST ${scopedInkName(l.owner, l.name)} = ${items.join(", ")}`);
  }
  const functions = project.variables.functions ?? [];
  for (const f of functions) {
    check(f.name, f.owner, f.name);
    for (const p of f.params) {
      if (!isValidInkName(p)) diagnostics.push({ severity: "error", code: "bad-param", message: `Параметр «${p}»: только латиница, цифры и _`, func: f.name, funcOwner: f.owner });
    }
  }
  for (const f of functions.filter((x) => x.external)) out.push(`EXTERNAL ${scopedInkName(f.owner, f.name)}(${f.params.join(", ")})`, { func: f.name, funcOwner: f.owner });
  for (const f of functions) {
    const ref = { func: f.name, funcOwner: f.owner };
    out.push("");
    out.push(`=== function ${scopedInkName(f.owner, f.name)}(${f.params.join(", ")}) ===`, ref);
    const body = compileLogic(project, f.body.replace(/\s+$/, ""), f.owner, f.params);
    for (const line of body ? body.split("\n") : ["~ return"]) out.push(line, ref);
  }
  return { text: out.lines.join("\n") + "\n", lineMap: out.map };
}

export function buildProject(project: Project): BuildResult {
  const diagnostics: Diagnostic[] = [];
  const files = new Map<string, string>();
  const lineMaps = new Map<string, (LineRef | null)[]>();
  const canvases: Record<string, CompiledCanvas> = {};

  const keys = Object.keys(project.canvases).sort();
  const ids = new Map<string, string>();
  for (const key of keys) {
    const canvas = project.canvases[key];
    if (!isValidInkName(canvas.id)) {
      diagnostics.push({ severity: "error", code: "bad-canvas-id", canvas: key, message: `Имя файла «${canvas.id}»: только латиница, цифры и _` });
    }
    if (ids.has(canvas.id)) {
      diagnostics.push({ severity: "error", code: "duplicate-canvas", canvas: key, message: `Файл с именем «${canvas.id}» уже есть` });
    }
    ids.set(canvas.id, key);
    const compiled = compileCanvas(project, key, canvas, diagnostics);
    canvases[key] = compiled;
    files.set(compiled.file, compiled.text);
    lineMaps.set(compiled.file, compiled.lineMap);
  }

  const globals = compileGlobals(project, diagnostics);
  files.set("globals.ink", globals.text);
  lineMaps.set("globals.ink", globals.lineMap);

  let start: string | null = null;
  if (project.settings.start) {
    start = resolveTarget(project, project.settings.start);
    if (!start) {
      diagnostics.push({ severity: "error", code: "bad-start", message: `Стартовая точка «${project.settings.start}» не найдена` });
    }
  }
  const main = [HEADER, "INCLUDE globals.ink", ...keys.map((k) => `INCLUDE ${canvases[k].file}`), "", start ? `-> ${start}` : "-> DONE"];
  files.set("main.ink", main.join("\n") + "\n");

  const manifest: Manifest = {
    version: 1,
    start,
    canvases: keys.map((key) => {
      const c = project.canvases[key];
      return {
        id: c.id,
        title: c.title,
        file: canvases[key].file,
        entries: flowCards(c)
          .map((x) => x.card)
          .filter((card) => card.entry)
          .map((card) => ({ name: card.entry!, path: `${c.id}.entry_${card.entry}` }))
          .sort((a, b) => a.name.localeCompare(b.name)),
      };
    }),
    externals: (project.variables.functions ?? [])
      .filter((f) => f.external)
      .map((f) => ({ name: scopedInkName(f.owner, f.name), params: f.params, ...(f.description ? { description: f.description } : {}), ...(f.owner ? { owner: f.owner, sourceName: f.name } : {}) })),
    characters: project.entities
      .filter((e) => e.kind === "character")
      .map((e) => ({ id: e.id, name: e.name, inkName: e.inkName, color: e.color, portrait: e.portrait, isPlayer: e.isPlayer })),
    lines: {},
  };
  for (const key of keys) {
    const c = project.canvases[key];
    for (const { card } of flowCards(c)) {
      if (card.type !== "line" || !card.text?.trim()) continue;
      manifest.lines[`${c.id}.${card.id}`] = { canvas: c.id, card: card.id, speaker: card.speaker, text: card.text, emotion: card.emotion };
    }
  }
  files.set("manifest.json", stableStringify(manifest));

  return { files, lineMaps, canvases, diagnostics, manifest };
}
