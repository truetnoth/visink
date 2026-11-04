import { Compiler, CompilerOptions, JsonFileHandler } from "inkjs/full";
import type { Project } from "@visink/core";
import { flowCards } from "@visink/core";
import type { BuildResult, Diagnostic } from "@visink/compiler";
import { buildProject, flattenCanvas, rootCard } from "@visink/compiler";

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

/** Достижимость карточек: от начала холста, точек входа и переходов с любых холстов. */
export function findUnreachable(project: Project): Diagnostic[] {
  const out: Diagnostic[] = [];
  const reachedFromJumps = new Map<string, Set<string>>(); // canvas id → card ids или имена входов
  for (const canvas of Object.values(project.canvases)) {
    for (const { card } of flowCards(canvas)) {
      if (card.type !== "jump" || !card.target) continue;
      const [canvasId, sub] = card.target.split(".", 2);
      if (!sub) continue;
      if (!reachedFromJumps.has(canvasId)) reachedFromJumps.set(canvasId, new Set());
      reachedFromJumps.get(canvasId)!.add(sub);
    }
  }
  for (const [key, source] of Object.entries(project.canvases)) {
    const canvas = flattenCanvas(source);
    if (!canvas.cards.length) continue;
    const extra = reachedFromJumps.get(canvas.id) ?? new Set();
    const root = rootCard(canvas);
    const seeds = [
      ...(root ? [root.id] : []),
      ...canvas.cards.filter((c) => c.entry || extra.has(c.id)).map((c) => c.id),
    ];
    if (!seeds.length) continue;
    const next = new Map<string, string[]>();
    for (const l of canvas.links) {
      if (!next.has(l.from)) next.set(l.from, []);
      next.get(l.from)!.push(l.to);
    }
    const seen = new Set<string>();
    const stack = [...seeds];
    while (stack.length) {
      const id = stack.pop()!;
      if (seen.has(id)) continue;
      seen.add(id);
      stack.push(...(next.get(id) ?? []));
    }
    for (const card of canvas.cards) {
      if (!seen.has(card.id)) {
        out.push({ severity: "warning", code: "unreachable", canvas: key, card: card.id, message: "Недостижимая карточка: к ней нет пути от начала файла и точек входа" });
      }
    }
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
      known.add(`${item.owner}.${item.name}`);
      if (item.owner === owner) known.add(item.name);
    } else known.add(item.name);
  }
  for (const l of project.variables.lists) {
    for (const i of l.items) {
      known.add(i);
      known.add(`${l.owner ? `${l.owner}.` : ""}${l.name}.${i}`);
    }
  }
  const canvasIds = new Set(Object.values(project.canvases).map((c) => c.id));
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
