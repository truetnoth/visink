import type { Canvas, Card, Link, Project, Variable } from "@visink/core";
import { namespaceName, qualifiedName, namespaceError, flowCards, isPlayerCard, isValidInkName, stableStringify, canvasLocations, prepareProject, isBoundaryCard } from "@visink/core";
import { escapeInkText, escapeTagValue, mapInkTextExpressions } from "./escape";

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

export function actionLines(action: string | undefined): string[] {
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

export const scopedInkName = (owner: string | undefined, name: string, project?: Project) => owner ? `${project ? namespaceName(project, owner) : owner}__${name}` : name;

export function isLegacyRoot(project: Project, canvas: Canvas): boolean {
  if (!canvas.legacyId) return false;
  const location = canvasLocations(project).find((x) => x.canvas === canvas || x.canvas.id === canvas.id);
  return location?.parent?.canvas.legacyId !== canvas.legacyId;
}

/** Внешний файл остаётся main.ink; внутренний knot уступает имя старой глобальной переменной/функции main. */
export function runtimeCanvasId(project: Project, canvas: Canvas): string {
  if (canvas.id !== "main") return canvas.id;
  const globals = [...project.variables.vars, ...project.variables.lists, ...project.variables.functions].filter((item) => !item.owner);
  if (!globals.some((item) => item.name === "main")) return "main";
  const used = new Set([...globals.map((item) => item.name), ...canvasLocations(project).map((x) => x.canvas.id)]);
  let id = "__visink_main";
  for (let n = 2; used.has(id); n++) id = `__visink_main_${n}`;
  return id;
}

function replaceLogicToken(text: string, from: string, to: string): string {
  const escaped = from.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const re = new RegExp(`(?<![\\w.])${escaped}(?![\\w])`, "g");
  return text.split(/("[^"]*")/).map((part, i) => i % 2 ? part : part.replace(re, to)).join("");
}

/** Переводит редакторские ссылки на свойства персонажей в глобальные имена Ink. */
export function compileLogic(project: Project, text: string, owner?: string, params: string[] = []): string {
  const owned = [...project.variables.vars, ...project.variables.lists, ...project.variables.functions].filter((x) => x.owner);
  let out = text;
  for (const item of owned) out = replaceLogicToken(out, qualifiedName(project, item), scopedInkName(item.owner, item.name, project));
  if (owner) {
    for (const item of owned.filter((x) => x.owner === owner && !params.includes(x.name))) {
      out = replaceLogicToken(out, item.name, scopedInkName(owner, item.name, project));
    }
  }
  return out;
}

/** Явный «Вход» — единственное начало knot. */
export function rootCard(canvas: Canvas): Card | undefined {
  return canvas.cards.find((c) => c.type === "entry");
}

function isTextExpression(expression: string, knownNames: Set<string>) {
  const keywords = new Set(["and", "or", "not", "mod", "true", "false"]);
  const token = /\s+|"(?:[^"\\]|\\.)*"|[A-Za-z_]\w*(?:\.[A-Za-z_]\w*)*|\d+(?:\.\d+)?|<=|>=|==|!=|&&|\|\||[+\-*/%()<>!,]/y;
  let index = 0;
  let hasValue = false;
  let previousValue = false;
  while (index < expression.length) {
    token.lastIndex = index;
    const match = token.exec(expression);
    if (!match) return false;
    index = token.lastIndex;
    const text = match[0];
    if (/^\s+$/.test(text)) continue;
    let value = /^["\d]/.test(text);
    if (/^[A-Za-z_]/.test(text)) {
      if (!knownNames.has(text) && !keywords.has(text)) return false;
      value = !["and", "or", "not", "mod"].includes(text);
    }
    if (value && previousValue) return false;
    if (value) hasValue = true;
    previousValue = value;
    if (text === "(" || text === ")" || text === ",") previousValue = false;
  }
  return hasValue;
}

function projectTextNames(project: Project) {
  return new Set([...project.variables.vars, ...project.variables.lists, ...project.variables.functions].map((item) => qualifiedName(project, item)));
}

/** Применяет правку только к распознанным шаблонам реплик, не экранируя остальной текст. */
export function mapStoryText(project: Project, text: string, transform: (expression: string) => string) {
  if (!text.includes("{")) return text;
  const names = projectTextNames(project);
  return mapInkTextExpressions(text, (expression) => {
    if (!isTextExpression(expression, names)) return null;
    const next = transform(expression);
    return next === expression ? null : `{${next}}`;
  });
}

/** Ищет технический или прежний корневой адрес "canvas", "canvas.entry" или "canvas.cardId". */
export function resolveTarget(project: Project, target: string): string | null {
  const [canvasId, sub] = target.trim().split(".", 2);
  const location = canvasLocations(project).find(({ canvas }) => canvas.id === canvasId || canvas.legacyId === canvasId && isLegacyRoot(project, canvas));
  if (!location) return null;
  const canvas = location.canvas;
  const addressId = canvas.legacyId === canvasId ? canvasId : runtimeCanvasId(project, canvas);
  if (!sub) return addressId;
  const legacyFamily = isLegacyRoot(project, canvas);
  const descendants = (root: Canvas): Card[] => root.cards.flatMap((card) => [card, ...(card.flow && card.flow.legacyId === canvas.legacyId ? descendants(card.flow) : [])]);
  const cards = legacyFamily ? descendants(canvas) : canvas.cards;
  const name = sub.startsWith("entry_") ? sub.slice(6) : sub;
  if (cards.some((c) => c.entry === name)) return `${addressId}.entry_${name}`;
  const card = cards.find((c) => c.id === sub);
  if (card) return `${addressId}.${stitchName(card)}`;
  return null;
}

export function compileCanvas(project: Project, key: string, source: Canvas, diagnostics: Diagnostic[] = []): CompiledCanvas {
  const location = canvasLocations(project).find((x) => x.canvas === source || x.canvas.id === source.id);
  const compile = (text: string | undefined) => text == null ? undefined : compileLogic(project, text);
  const textNames = projectTextNames(project);
  const storyText = (text: string) => escapeInkText(text, (expression) => {
    if (!isTextExpression(expression, textNames)) return null;
    return compileLogic(project, expression);
  });
  const canvas: Canvas = {
    ...source,
    id: runtimeCanvasId(project, source),
    cards: source.cards.map((card) => ({ ...card, condition: compile(card.condition), action: compile(card.action), ...(card.type === "ink" ? { text: compile(card.text) } : {}) })),
    links: source.links.map((link) => ({ ...link, condition: compile(link.condition), action: compile(link.action) })),
  };
  const seenCards = new Set<string>();
  for (const card of canvas.cards) {
    if (seenCards.has(card.id)) diagnostics.push({ severity: "error", code: "duplicate-card", canvas: key, card: card.id, message: `Id карточки «${card.id}» повторяется во вложенных потоках` });
    seenCards.add(card.id);
  }
  const byId = new Map(canvas.cards.map((c) => [c.id, c]));
  const sourceById = new Map(source.cards.map((card) => [card.id, card]));
  const outgoing = new Map<string, Link[]>();
  for (const link of canvas.links) {
    if (!outgoing.has(link.from)) outgoing.set(link.from, []);
    outgoing.get(link.from)!.push(link);
  }
  for (const [k, v] of outgoing) outgoing.set(k, sortLinks(v));

  type OptionRoute = {
    option: Card;
    canvas: Canvas;
    gates: string[];
    actions: { canvas: string; card: string; action?: string; link?: LinkRef }[];
  };
  const linksFrom = (sourceCanvas: Canvas, id: string): Link[] => sourceCanvas === source
    ? outgoing.get(id) ?? []
    : sortLinks(sourceCanvas.links.filter((l) => l.from === id)).map((l) => ({ ...l, condition: compile(l.condition), action: compile(l.action) }));
  /** Не null только для маршрута, который целиком состоит из вложенностей/хабов и вариантов игрока. */
  const collectOptions = (sourceCanvas: Canvas, target: Card, seen = new Set<string>(), transparent = false): OptionRoute[] | null => {
    const gate = target.type === "condition" ? "" : compile(target.condition)?.trim() || "";
    if (isPlayerCard(project, target)) return [{ option: target, canvas: sourceCanvas, gates: gate ? [gate] : [], actions: [] }];
    if (target.type !== "flow" && (target.type !== "hub" && target.type !== "entry" || !transparent)) return null;
    const key = `${sourceCanvas.id}.${target.id}`;
    if (seen.has(key)) return null;
    const nextSeen = new Set(seen).add(key);
    const nextCanvas = target.type === "flow" ? target.flow : sourceCanvas;
    const next = target.type === "flow" ? target.flow && rootCard(target.flow) : target;
    if (!nextCanvas || !next) return null;
    const links = linksFrom(nextCanvas, next.id);
    if (!links.length) return null;
    const prefix: OptionRoute["actions"] = compile(target.action)?.trim() ? [{ canvas: sourceCanvas.id, card: target.id, action: compile(target.action) }] : [];
    const out: OptionRoute[] = [];
    for (const link of links) {
      const nextTarget = nextCanvas.cards.find((c) => c.id === link.to);
      if (!nextTarget) return null;
      const routes = collectOptions(nextCanvas, nextTarget, nextSeen, true);
      if (!routes) return null;
      const linkGate = compile(link.condition)?.trim() || "";
      const linkRef = { from: link.from, to: link.to, ...(link.port ? { port: link.port } : {}) };
      for (const route of routes) out.push({
        ...route,
        gates: [...(gate ? [gate] : []), ...(linkGate ? [linkGate] : []), ...route.gates],
        actions: [
          ...prefix,
          ...(link.action?.trim() ? [{ canvas: nextCanvas.id, card: target.id, action: link.action, link: linkRef }] : []),
          ...route.actions,
        ],
      });
    }
    return out.length ? out : null;
  };

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
  type Out = string | { text: string; canvas?: string; card?: string; link?: LinkRef };

  const refOf = (l: Link): LinkRef => ({ from: l.from, to: l.to, ...(l.port ? { port: l.port } : {}) });
  const linkCond = (l: Link) => l.condition?.trim() ?? "";
  const both = (a: string, b: string) => (a && b ? `(${a}) and (${b})` : a || b);
  /** Действие стрелки строками с отступом — внутри выбора или ветки. */
  const linkActions = (l: Link, from: Card): Out[] =>
    actionLines(l.action).map((text) => ({ text: `    ${text}`, card: from.id, link: refOf(l) }));

  const routing = (card: Card, links = outgoing.get(card.id) ?? []): Out[] => {
    if (!links.length) return ["-> DONE"];
    if (card.type === "entry" && links.length === 1 && links[0].direct) {
      return [...actionLines(links[0].action).map((text) => ({ text, card: card.id, link: refOf(links[0]) })), divert(links[0].to, card)];
    }
    const pairs = links.flatMap((l) => {
      const t = byId.get(l.to);
      return t ? [{ l, t, routes: collectOptions(source, t) }] : [];
    });
    if (!pairs.length) return [divert(links[0].to, card)];
    const players = pairs.flatMap(({ l, t, routes }) => routes?.map((route) => ({ l, t, route })) ?? []);
    const condOf = ({ l, t }: { l: Link; t: Card }) => both(gateOf(t), linkCond(l));
    if (players.length) {
      const ordinary = pairs.filter(({ routes }) => !routes);
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
      const ordered = [...players.filter(({ route }) => route.option.repeat !== "fallback"), ...players.filter(({ route }) => route.option.repeat === "fallback")];
      return [...routes, ...ordered.flatMap(({ l, t, route }): Out[] => {
        const option = route.option;
        const lc = linkCond(l);
        const conditions = [lc, ...route.gates].filter(Boolean);
        const conds = conditions.map((c) => `{${c}} `).join("");
        const ref = { canvas: lc ? source.id : route.canvas.id, card: lc ? card.id : option.id, ...(lc ? { link: refOf(l) } : {}) };
        const head = option.repeat === "fallback" ? `* ${conds}->` : `${option.repeat === "sticky" ? "+" : "*"} ${conds}[${storyText(option.menuText || option.text || "…")}]`;
        const acts = [
          ...linkActions(l, card),
          ...route.actions.flatMap((item) => actionLines(item.action).map((text) => ({ text: `    ${text}`, canvas: item.canvas, card: item.card, ...(item.link ? { link: item.link } : {}) }))),
        ];
        const path = route.canvas === source ? stitchName(option) : `${runtimeCanvasId(project, route.canvas)}.${stitchName(option)}`;
        const target = `-> ${path}`;
        if (!acts.length) return [{ text: option.repeat === "fallback" ? `${head} ${path}` : `${head} ${target}`, ...ref }];
        return [{ text: head, ...ref }, ...acts, { text: `    ${target}`, card: option.id }];
      }), "* -> DONE"];
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
    const text = storyText(card.text ?? "");
    if (!text) {
      if (!isPlayerCard(project, card)) diag("warning", "empty-line", "Пустая реплика", card.id);
      return null;
    }
    const speaker = project.entities.find((e) => e.id === card.speaker);
    const prefix = speaker?.inkName ? `${speaker.inkName}: ` : "";
    const tags = [`id: ${source.legacyId ?? source.id}.${card.id}`];
    if (speaker) tags.push(`speaker: ${speaker.id}`);
    if (card.emotion) tags.push(`emotion: ${escapeTagValue(card.emotion)}`);
    if (card.stageDirection) tags.push(`dir: ${escapeTagValue(card.stageDirection)}`);
    for (const k of Object.keys(card.tags ?? {}).sort()) {
      tags.push(`${escapeTagValue(k)}: ${escapeTagValue(card.tags![k])}`);
    }
    return `${prefix}${text} # ${tags.join(" # ")}`;
  };

  const rawInk = (card: Card): string => {
    const text = compile(card.text) ?? "";
    if (!canvas.legacyId) return text;
    const legacyLocations = canvasLocations(project).filter((x) => x.canvas.legacyId);
    const targets = new Map<string, string>();
    for (const location of legacyLocations) {
      const legacyId = location.canvas.legacyId!;
      const actualId = runtimeCanvasId(project, location.canvas);
      for (const target of location.canvas.cards) {
        const actual = `${actualId}.${stitchName(target)}`;
        targets.set(`${legacyId}.${target.id}`, actual);
        if (target.entry) targets.set(`${legacyId}.${target.entry}`, `${actualId}.entry_${target.entry}`);
        if (legacyId === canvas.legacyId) {
          const local = location.canvas === source;
          targets.set(target.id, local ? stitchName(target) : actual);
          if (target.entry) targets.set(target.entry, local ? `entry_${target.entry}` : `${actualId}.entry_${target.entry}`);
        }
      }
    }
    const rewrite = (part: string) => {
      const comment = part.indexOf("//");
      const code = comment < 0 ? part : part.slice(0, comment);
      const rest = comment < 0 ? "" : part.slice(comment);
      return code.replace(/(->\s*)([A-Za-z_]\w*(?:\.[A-Za-z_]\w*)?)(?![\w.])/g, (match, arrow: string, name: string) => targets.has(name) ? `${arrow}${targets.get(name)}` : match) + rest;
    };
    return text.split("\n").map((line) => line.split(/("[^"]*")/).map((part, i) => i % 2 ? part : rewrite(part)).join("")).join("\n");
  };

  const body = (card: Card): Out[] => {
    switch (card.type) {
      case "line": {
        const line = lineText(card);
        return [...(line ? [line] : []), ...actionLines(card.action), ...routing(card)];
      }
      case "hub":
      case "entry":
        return [...actionLines(card.action), ...routing(card)];
      case "exit": {
        const parent = location?.parent;
        return [parent ? `-> ${runtimeCanvasId(project, parent.canvas)}.__visink_continue_${parent.card.id}` : "-> DONE"];
      }
      case "flow": {
        const inner = sourceById.get(card.id)?.flow;
        return [...actionLines(card.action), ...(inner ? [`-> ${runtimeCanvasId(project, inner)}`] : routing(card))];
      }
      case "condition": {
        const links = outgoing.get(card.id) ?? [];
        const yes = links.filter((l) => l.port === "yes");
        const no = links.filter((l) => l.port === "no");
        let cond = card.condition?.trim();
        if (!cond) {
          diag("error", "empty-condition", "У карточки-условия не задано условие", card.id);
          cond = "true";
        }
        const indent = (out: Out[]): Out[] => out.map((line) => typeof line === "string" ? `    ${line}` : { ...line, text: `    ${line.text}` });
        return [
          ...actionLines(card.action),
          `{ ${cond}:`,
          ...indent(routing(card, yes)),
          "- else:",
          ...indent(routing(card, no)),
          "}",
        ];
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
        const raw = rawInk(card).replace(/\s+$/, "");
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
        typeof line === "string" ? { canvas: key, card: card.id } : { canvas: line.canvas ?? key, card: line.card ?? card.id, ...(line.link ? { link: line.link } : {}) };
      out.push(text, ref);
      texts.push(text);
    }
    cardInk[card.id] = texts.join("\n");
  }
  for (const card of canvas.cards.filter((c) => c.flow)) {
    const block = routing(card);
    out.push(`= __visink_continue_${card.id}`, { canvas: key, card: card.id });
    for (const line of block) {
      out.push(typeof line === "string" ? line : line.text, typeof line === "string" ? { canvas: key, card: card.id } : { canvas: line.canvas ?? key, card: line.card ?? card.id, ...(line.link ? { link: line.link } : {}) });
    }
  }
  if (isLegacyRoot(project, source)) {
    const aliases: { canvas: Canvas; card: Card }[] = [];
    const visit = (parent: Canvas) => {
      for (const owner of parent.cards) {
        if (!owner.flow || owner.flow.legacyId !== source.legacyId) continue;
        for (const card of owner.flow.cards) if (!isBoundaryCard(card)) aliases.push({ canvas: owner.flow, card });
        visit(owner.flow);
      }
    };
    visit(source);
    for (const alias of aliases) {
      out.push(`= ${stitchName(alias.card)}`, { canvas: key, card: alias.card.id });
      out.push(`-> ${runtimeCanvasId(project, alias.canvas)}.${stitchName(alias.card)}`, { canvas: key, card: alias.card.id });
    }
    for (const alias of aliases.filter(({ card }) => card.entry).sort((a, b) => a.card.entry!.localeCompare(b.card.entry!))) {
      out.push(`= entry_${alias.card.entry}`, { canvas: key, card: alias.card.id });
      out.push(`-> ${runtimeCanvasId(project, alias.canvas)}.${stitchName(alias.card)}`, { canvas: key, card: alias.card.id });
    }
    if (source.legacyId && source.legacyId !== source.id) {
      const own = source.cards.filter((card) => !isBoundaryCard(card)).map((card) => ({ canvas: source, card }));
      const compatibility = [...own, ...aliases];
      out.push(`=== ${source.legacyId} ===`);
      out.push(`-> ${runtimeCanvasId(project, source)}`, { canvas: key });
      for (const alias of compatibility) {
        out.push(`= ${stitchName(alias.card)}`, { canvas: key, card: alias.card.id });
        out.push(`-> ${runtimeCanvasId(project, alias.canvas)}.${stitchName(alias.card)}`, { canvas: key, card: alias.card.id });
      }
      for (const alias of compatibility.filter(({ card }) => card.entry).sort((a, b) => a.card.entry!.localeCompare(b.card.entry!))) {
        out.push(`= entry_${alias.card.entry}`, { canvas: key, card: alias.card.id });
        out.push(`-> ${runtimeCanvasId(project, alias.canvas)}.${stitchName(alias.card)}`, { canvas: key, card: alias.card.id });
      }
    }
  }

  return {
    key,
    file: `${source.id}.ink`,
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
  for (const scope of [...project.entities.map((e) => ({ id: e.id, name: e.technicalName ?? e.id })), ...(project.variables.sets ?? [])]) {
    const error = namespaceError(project, scope.name, scope.id);
    if (error) diagnostics.push({ severity: "error", code: "bad-namespace", message: `${scope.name}: ${error}` });
  }
  const seen = new Set<string>();
  const check = (sourceName: string, owner?: string, func?: string) => {
    const name = scopedInkName(owner, sourceName, project);
    const ref = { ...(func ? { func } : {}), ...(owner ? { funcOwner: owner } : {}) };
    if (!isValidInkName(name)) {
      diagnostics.push({ severity: "error", code: "bad-var-name", message: `Имя «${sourceName}»: только латиница, цифры и _`, ...ref });
    }
    if (seen.has(name)) diagnostics.push({ severity: "error", code: "duplicate-var", message: `Имя «${name}» объявлено дважды`, ...ref });
    seen.add(name);
  };
  for (const v of project.variables.vars) {
    check(v.name, v.owner);
    out.push(`VAR ${scopedInkName(v.owner, v.name, project)} = ${varLiteral(v)}`);
  }
  for (const l of project.variables.lists) {
    check(l.name, l.owner);
    const items = l.items.map((i) => (l.initial.includes(i) ? `(${i})` : i));
    out.push(`LIST ${scopedInkName(l.owner, l.name, project)} = ${items.join(", ")}`);
  }
  const functions = project.variables.functions ?? [];
  for (const f of functions) {
    check(f.name, f.owner, f.name);
    for (const p of f.params) {
      if (!isValidInkName(p)) diagnostics.push({ severity: "error", code: "bad-param", message: `Параметр «${p}»: только латиница, цифры и _`, func: f.name, funcOwner: f.owner });
    }
  }
  for (const f of functions.filter((x) => x.external)) out.push(`EXTERNAL ${scopedInkName(f.owner, f.name, project)}(${f.params.join(", ")})`, { func: f.name, funcOwner: f.owner });
  for (const f of functions) {
    const ref = { func: f.name, funcOwner: f.owner };
    out.push("");
    out.push(`=== function ${scopedInkName(f.owner, f.name, project)}(${f.params.join(", ")}) ===`, ref);
    const body = compileLogic(project, f.body.replace(/\s+$/, ""), f.owner, f.params);
    for (const line of body ? body.split("\n") : ["~ return"]) out.push(line, ref);
  }
  return { text: out.lines.join("\n") + "\n", lineMap: out.map };
}

export function buildProject(project: Project): BuildResult {
  project = prepareProject(structuredClone(project));
  const diagnostics: Diagnostic[] = [];
  const files = new Map<string, string>();
  const lineMaps = new Map<string, (LineRef | null)[]>();
  const canvases: Record<string, CompiledCanvas> = {};

  const locations = canvasLocations(project).sort((a, b) => a.canvas.id.localeCompare(b.canvas.id));
  const ids = new Set<string>();
  for (const { canvas } of locations) {
    const key = canvas.id;
    const lowerId = canvas.id.toLowerCase();
    if (!isValidInkName(canvas.id) || lowerId === "globals" || canvas.id !== "main" && lowerId === "main") {
      diagnostics.push({ severity: "error", code: "bad-canvas-id", canvas: key, message: `Имя файла «${canvas.id}»: недопустимо или зарезервировано (main, globals)` });
    }
    if (ids.has(lowerId)) diagnostics.push({ severity: "error", code: "duplicate-canvas", canvas: key, message: `Файл с именем «${canvas.id}» уже есть или совпадает по регистру` });
    ids.add(lowerId);
    if (canvas.cards.filter((c) => c.type === "entry").length !== 1 || canvas.cards.filter((c) => c.type === "exit").length !== 1) {
      diagnostics.push({ severity: "error", code: "canvas-boundaries", canvas: key, message: "На холсте должны быть ровно один «Вход» и один «Выход»" });
    }
    const compiled = compileCanvas(project, key, canvas, diagnostics);
    canvases[key] = compiled;
    if (canvas.id !== "main") {
      files.set(compiled.file, compiled.text);
      lineMaps.set(compiled.file, compiled.lineMap);
    }
    if (isLegacyRoot(project, canvas)) {
      const family = flowCards(canvas).filter(({ canvas: owner, card }) => owner.legacyId === canvas.legacyId && !isBoundaryCard(card));
      const seenCards = new Set<string>();
      const seenEntries = new Set<string>();
      for (const { card } of family) {
        if (seenCards.has(card.id)) diagnostics.push({ severity: "error", code: "duplicate-card", canvas: key, card: card.id, message: `Id карточки «${card.id}» повторяется в прежнем адресном пространстве` });
        seenCards.add(card.id);
        if (card.entry && seenEntries.has(card.entry)) diagnostics.push({ severity: "error", code: "duplicate-entry", canvas: key, card: card.id, message: `Точка входа «${card.entry}» уже есть в файле` });
        if (card.entry) seenEntries.add(card.entry);
      }
    }
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
  const mainBody = canvases.main.text.slice(HEADER.length + 1);
  const main = [HEADER, "INCLUDE globals.ink", ...locations.filter(({ canvas }) => canvas.id !== "main").map(({ canvas }) => `INCLUDE ${canvas.id}.ink`), "", `-> ${runtimeCanvasId(project, project.canvases.main)}`, mainBody];
  files.set("main.ink", main.join("\n"));
  lineMaps.set("main.ink", [...Array(locations.length - 1 + 4).fill(null), ...canvases.main.lineMap.slice(1)]);

  const manifest: Manifest = {
    version: 1,
    start,
    canvases: locations.map(({ canvas: c }) => ({
      id: c.id,
      title: c.title,
      file: `${c.id}.ink`,
      entries: c.cards
        .filter((card) => card.entry)
        .map((card) => ({ name: card.entry!, path: resolveTarget(project, `${c.legacyId ?? c.id}.${card.entry}`)! }))
        .sort((a, b) => a.name.localeCompare(b.name)),
    })),
    externals: (project.variables.functions ?? [])
      .filter((f) => f.external)
      .map((f) => ({ name: scopedInkName(f.owner, f.name, project), params: f.params, ...(f.description ? { description: f.description } : {}), ...(f.owner ? { owner: f.owner, sourceName: f.name } : {}) })),
    characters: project.entities

      .map((e) => ({ id: e.id, name: e.name, inkName: e.inkName, color: e.color, portrait: e.portrait, isPlayer: e.isPlayer })),
    lines: {},
  };
  for (const { canvas: c } of locations) {
    for (const card of c.cards) {
      if (card.type !== "line" || !card.text?.trim()) continue;
      const address = c.legacyId ?? c.id;
      manifest.lines[`${address}.${card.id}`] = { canvas: address, card: card.id, speaker: card.speaker, text: card.text, emotion: card.emotion };
    }
  }
  files.set("manifest.json", stableStringify(manifest));

  return { files, lineMaps, canvases, diagnostics, manifest };
}
