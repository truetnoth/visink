function escapeLiteral(raw: string): string {
  let s = raw.replace(/\\/g, "\\\\");
  s = s.replace(/[#{}[\]|]/g, (ch) => "\\" + ch);
  s = s.replace(/\/\//g, "/\\/").replace(/\/\*/g, "/\\*");
  s = s.replace(/->/g, "\\->").replace(/<-/g, "\\<-").replace(/<>/g, "\\<>");
  return s;
}

function escapeLineStart(s: string) {
  return /^[*+\-=~(]/.test(s) || /^TODO:/.test(s) ? `\\${s}` : s;
}

/** Разбирает только неэкранированные {expression}; остальной текст сохраняет без изменений. */
export function mapInkTextExpressions(
  raw: string,
  mapExpression: (expression: string, range: { start: number; end: number }) => string | null,
  mapText: (text: string) => string = (text) => text,
): string {
  let out = "";
  let literal = "";
  const flush = () => { out += mapText(literal); literal = ""; };
  for (let i = 0; i < raw.length; i++) {
    const ch = raw[i];
    if (ch === "\\") {
      literal += ch;
      if (i + 1 < raw.length) literal += raw[++i];
      continue;
    }
    if (ch === "{") {
      let end = i + 1;
      let quoted = false;
      while (end < raw.length) {
        if (raw[end] === "\\") { end += 2; continue; }
        if (raw[end] === '"') quoted = !quoted;
        if (!quoted && raw[end] === "}") break;
        end++;
      }
      if (end < raw.length) {
        const mapped = mapExpression(raw.slice(i + 1, end), { start: i, end: end + 1 });
        if (mapped !== null) {
          flush();
          out += mapped;
          i = end;
          continue;
        }
      }
    }
    literal += ch;
  }
  flush();
  return out;
}

/**
 * Экранирование обычного текста под ink. Сценарист пишет как есть,
 * а служебные символы ink получают обратную косую черту.
 * interpolator может оставить выражение в фигурных скобках; экранированные скобки остаются текстом.
 */
export function escapeInkText(raw: string, interpolator?: (expression: string) => string | null): string {
  const source = raw.replace(/\r?\n+/g, " ").trim();
  if (!interpolator) return escapeLineStart(escapeLiteral(source));
  const out = mapInkTextExpressions(
    source,
    (expression) => {
      const compiled = interpolator(expression.trim());
      return compiled === null ? null : `{${compiled}}`;
    },
    (text) => escapeLiteral(text.replace(/\\([{}])/g, "$1")),
  );
  return escapeLineStart(out);
}

/** Значение тега: одна строка, без символов, которые ink воспримет как разметку. */
export function escapeTagValue(raw: string): string {
  return escapeInkText(raw.replace(/#/g, ""));
}
