import { qualifiedName } from "@visink/core";
import { Compiler, CompilerOptions, JsonFileHandler } from "inkjs/full";
import { canvasLocations, prepareProject, isBoundaryCard, type Project, type Card, type Canvas } from "@visink/core";
import type { BuildResult, Diagnostic } from "@visink/compiler";
import { buildProject, resolveTarget, runtimeCanvasId } from "@visink/compiler";

export interface CheckResult {
  build: BuildResult;
  diagnostics: Diagnostic[];
  /** скомпилированный story JSON, если ink собрался без ошибок */
  storyJson: string | null;
}

const MESSAGE = /^(ERROR|WARNING|TODO|RUNTIME ERROR|RUNTIME WARNING):\s*(?:'([^']+)'\s+)?line (\d+):\s*(.*)$/;

/** Компилирует собранный ink через inkjs и переносит ошибки на карточки по карте строк. */
export function compileInk(build: BuildResult): { diagnostics: Diagnostic[]; storyJson: string | null } {
  const files: Record<string, string> = Object.fromEntries(build.files);
  const messages: { type: number; text: string }[] = [];
  const options = new CompilerOptions("main.ink", [], false, (text, type) => messages.push({ type, text }), new JsonFileHandler(files));
  let storyJson: string | null = null;
  try {
    const story = new Compiler(files["main.ink"], options).Compile();
    storyJson = story ? story.ToJson() ?? null : null;
  } catch {
    // ошибки уже в messages
  }

  const diagnostics: Diagnostic[] = [];
  for (const { type, text } of messages) {
    const m = MESSAGE.exec(text);
    if (!m) {
      diagnostics.push({ severity: type === 1 ? "warning" : "error", code: "ink", message: text });
      continue;
    }
    const [, kind, file = "main.ink", line, message] = m;
    const ref = build.lineMaps.get(file)?.[Number(line) - 1];
    diagnostics.push({
      severity: kind.includes("WARNING") || kind === "TODO" ? "warning" : "error",
      code: "ink",
      message: ref ? message : `${file}:${line}: ${message}`,
      canvas: ref?.canvas,
      card: ref?.card,
      ...(ref?.link ? { link: ref.link } : {}),
      ...(ref?.func ? { func: ref.func } : {}),
      ...(ref?.funcOwner ? { funcOwner: ref.funcOwner } : {}),
    });
  }
  if (!storyJson && !diagnostics.some((d) => d.severity === "error")) {
    diagnostics.push({ severity: "error", code: "ink", message: "Компиляция ink не удалась" });
  }
  return { diagnostics, storyJson };
}

/** Достижимость с учётом входов вложенностей и статических возвратов к их контейнерам. */
export function findUnreachable(project: Project): Diagnostic[] {
  project = prepareProject(structuredClone(project));
  const locations = canvasLocations(project);
  const out: Diagnostic[] = [];
  const next = new Map<string, string[]>();
  const seeds: string[] = [];
  const node = (canvas: Canvas, card: Card) => `${canvas.id}.${card.id}`;
  const link = (from: string, to?: string) => {
    if (!to) return;
    if (!next.has(from)) next.set(from, []);
    next.get(from)!.push(to);
  };
  const resolve = (target: string): string | undefined => {
    const path = resolveTarget(project, target);
    if (!path) return undefined;
    const [canvasId, sub] = path.split(".", 2);
    const canvas = locations.find((x) => x.canvas.id === canvasId || runtimeCanvasId(project, x.canvas) === canvasId)?.canvas;
    if (!canvas) return undefined;
    if (!sub) return node(canvas, canvas.cards.find((c) => c.type === "entry")!);
    const name = sub.startsWith("entry_") ? sub.slice(6) : sub;
    const card = canvas.cards.find((c) => c.id === sub || c.entry === name);
    return card ? node(canvas, card) : undefined;
  };
  for (const { canvas, parent } of locations) {
    const entry = canvas.cards.find((c) => c.type === "entry");
    if (entry) {
      seeds.push(node(canvas, entry));
      if (parent) seeds.push(node(parent.canvas, parent.card));
    }
    for (const card of canvas.cards) {
      const from = node(canvas, card);
      if (card.entry) seeds.push(from);
      for (const l of canvas.links.filter((l) => l.from === card.id)) {
        const target = canvas.cards.find((c) => c.id === l.to);
        if (target) link(from, node(canvas, target));
      }
      if (card.type === "flow" && card.flow) {
        const inner = card.flow.cards.find((c) => c.type === "entry");
        if (inner) link(from, node(card.flow, inner));
      } else if (card.type === "exit" && parent) {
        for (const l of parent.canvas.links.filter((l) => l.from === parent.card.id)) {
          const target = parent.canvas.cards.find((c) => c.id === l.to);
          if (target) link(from, node(parent.canvas, target));
        }
      } else if (card.type === "jump" && card.target) {
        link(from, resolve(card.target));
      }
    }
  }
  const seen = new Set<string>();
  const stack = [...seeds];
  while (stack.length) {
    const id = stack.pop()!;
    if (seen.has(id)) continue;
    seen.add(id);
    stack.push(...(next.get(id) ?? []));
  }
  for (const { canvas } of locations) for (const card of canvas.cards) {
    if (isBoundaryCard(card) || seen.has(node(canvas, card))) continue;
    out.push({ severity: "warning", code: "unreachable", canvas: canvas.id, card: card.id, message: "Недостижимая карточка: к ней нет пути от входов и переходов" });
  }
  return out;
}

export function checkProject(project: Project): CheckResult {
  const build = buildProject(project);
  const ink = compileInk(build);
  const diagnostics = [...build.diagnostics, ...findUnreachable(project), ...ink.diagnostics];
  return { build, diagnostics, storyJson: ink.storyJson };
}

/** Встроенные функции ink — для подсказок при вводе. */
export const INK_BUILTINS = [
  "RANDOM", "SEED_RANDOM", "CHOICE_COUNT", "TURNS", "TURNS_SINCE", "READ_COUNT",
  "INT", "FLOOR", "FLOAT", "POW", "MIN", "MAX",
  "LIST_COUNT", "LIST_MIN", "LIST_MAX", "LIST_ALL", "LIST_INVERT", "LIST_RANDOM", "LIST_VALUE", "LIST_RANGE",
];

const KNOWN = new Set([
  "and", "or", "not", "true", "false", "mod", "has", "hasnt", "if", "else", "return", "temp", "function", "DONE", "END",
  "RANDOM", "SEED_RANDOM", "CHOICE_COUNT", "TURNS", "TURNS_SINCE", "READ_COUNT",
  "INT", "FLOOR", "FLOAT", "POW", "MIN", "MAX",
  "LIST_COUNT", "LIST_MIN", "LIST_MAX", "LIST_ALL", "LIST_INVERT", "LIST_RANDOM", "LIST_VALUE", "LIST_RANGE",
]);

/**
 * Имена в условии, действии или теле функции, которых нет среди переменных, списков, функций и файлов.
 * extra — локальные имена (параметры функции), owner — область функции персонажа.
 */
export function unknownIdentifiers(expr: string, project: Project, extra: string[] = [], owner?: string): string[] {
  const known = new Set([...KNOWN, ...extra]);
  for (const item of [...project.variables.functions, ...project.variables.vars, ...project.variables.lists]) {
    if (item.owner) {
      known.add(qualifiedName(project, item));
      if (item.owner === owner) known.add(item.name);
    } else known.add(item.name);
  }
  for (const l of project.variables.lists) {
    for (const i of l.items) {
      known.add(i);
      known.add(`${qualifiedName(project, l)}.${i}`);
    }
  }
  const canvasIds = new Set(canvasLocations(project).flatMap(({ canvas }) => [canvas.id, ...(canvas.legacyId ? [canvas.legacyId] : [])]));
  const stripped = expr.replace(/"[^"]*"/g, " ");
  // временные переменные внутри функции: ~ temp x = …
  for (const m of stripped.matchAll(/\btemp\s+([A-Za-z_][\w]*)/g)) known.add(m[1]);
  const unknown: string[] = [];
  for (const m of stripped.matchAll(/[A-Za-z_Ѐ-ӿ][\wЀ-ӿ]*(?:\.[\wЀ-ӿ]+)*/g)) {
    const name = m[0];
    if (known.has(name) || canvasIds.has(name.split(".")[0])) continue;
    if (!unknown.includes(name)) unknown.push(name);
  }
  return unknown;
}
