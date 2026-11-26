import type { TextMark, TextSpan } from "./model";

const MARKS: TextMark[] = ["bold", "italic", "underline", "strike", "code"];

function sameStyle(a: TextSpan, b: TextSpan) {
  return a.size === b.size && a.marks.length === b.marks.length && a.marks.every((mark, index) => mark === b.marks[index]);
}

/** Канонические непересекающиеся диапазоны в UTF-16 offsets канонической строки. */
export function normalizeSpans(spans: TextSpan[] | undefined, textLength: number): TextSpan[] {
  if (!Array.isArray(spans) || textLength <= 0) return [];
  const points = new Set<number>([0, textLength]);
  const clamp = (value: number) => Math.max(0, Math.min(textLength, Math.floor(value)));
  const valid = spans.flatMap((span) => {
    if (!span || !Number.isFinite(span.start) || !Number.isFinite(span.end)) return [];
    const start = clamp(span.start), end = clamp(span.end);
    if (end <= start) return [];
    const marks = Array.isArray(span.marks) ? span.marks : [];
    const size = Number.isFinite(span.size) ? Math.max(8, Math.min(48, span.size!)) : undefined;
    if (!marks.length && size == null) return [];
    points.add(start);
    points.add(end);
    return [{ start, end, marks, size }];
  });
  const sorted = [...points].sort((a, b) => a - b);
  const out: TextSpan[] = [];
  for (let i = 0; i < sorted.length - 1; i++) {
    const start = sorted[i], end = sorted[i + 1];
    if (start === end) continue;
    const covering = valid.filter((span) => span.start <= start && span.end >= end);
    if (!covering.length) continue;
    const marks = MARKS.filter((mark) => covering.some((span) => span.marks.includes(mark)));
    const size = [...covering].reverse().find((span) => span.size != null)?.size;
    const span: TextSpan = { start, end, marks, ...(size != null ? { size } : {}) };
    if (!span.marks.length && span.size == null) continue;
    const previous = out.at(-1);
    if (previous?.end === start && sameStyle(previous, span)) previous.end = end;
    else out.push(span);
  }
  return out;
}

/** Сдвигает форматирование после одной замены, определяемой общими prefix/suffix. */
export function rebaseSpans(spans: TextSpan[] | undefined, previous: string, next: string): TextSpan[] {
  if (previous === next) return normalizeSpans(spans, next.length);
  let prefix = 0;
  while (prefix < previous.length && prefix < next.length && previous[prefix] === next[prefix]) prefix++;
  let suffix = 0;
  while (suffix < previous.length - prefix && suffix < next.length - prefix && previous[previous.length - 1 - suffix] === next[next.length - 1 - suffix]) suffix++;
  const removedEnd = previous.length - suffix;
  const delta = next.length - previous.length;
  const mapped = normalizeSpans(spans, previous.length).map((span) => {
    const map = (position: number) => position <= prefix ? position : position >= removedEnd ? position + delta : prefix;
    return { ...span, marks: [...span.marks], start: map(span.start), end: map(span.end) };
  });
  return normalizeSpans(mapped, next.length);
}

export function updateSpanStyle(
  spans: TextSpan[] | undefined,
  textLength: number,
  start: number,
  end: number,
  update: (style: { marks: TextMark[]; size?: number }) => { marks: TextMark[]; size?: number },
): TextSpan[] {
  if (start < 0 || end <= start || start >= textLength) return normalizeSpans(spans, textLength);
  end = Math.min(end, textLength);
  const normalized = normalizeSpans(spans, textLength);
  const out: TextSpan[] = [];
  for (const span of normalized) {
    if (span.end <= start || span.start >= end) { out.push(span); continue; }
    if (span.start < start) out.push({ ...span, marks: [...span.marks], end: start });
    if (span.end > end) out.push({ ...span, marks: [...span.marks], start: end });
  }
  const points = new Set<number>([start, end]);
  for (const span of normalized) {
    if (span.start > start && span.start < end) points.add(span.start);
    if (span.end > start && span.end < end) points.add(span.end);
  }
  const sorted = [...points].sort((a, b) => a - b);
  for (let i = 0; i < sorted.length - 1; i++) {
    const from = sorted[i], to = sorted[i + 1];
    const covering = normalized.filter((span) => span.start <= from && span.end >= to);
    const style = {
      marks: MARKS.filter((mark) => covering.some((span) => span.marks.includes(mark))),
      size: [...covering].reverse().find((span) => span.size != null)?.size,
    };
    const next = update(style);
    if (next.marks.length || next.size != null) out.push({ start: from, end: to, marks: next.marks, ...(next.size != null ? { size: next.size } : {}) });
  }
  return normalizeSpans(out, textLength);
}

export function rangeHasMark(spans: TextSpan[] | undefined, textLength: number, start: number, end: number, mark: TextMark) {
  if (start < 0 || end <= start || end > textLength) return false;
  let covered = start;
  for (const span of normalizeSpans(spans, textLength)) {
    if (span.end <= covered) continue;
    if (span.start > covered || !span.marks.includes(mark)) return false;
    covered = span.end;
    if (covered >= end) return true;
  }
  return false;
}

export function wrapSelection(
  text: string,
  spans: TextSpan[] | undefined,
  start: number,
  end: number,
  open: string,
  close: string,
) {
  const next = text.slice(0, start) + open + text.slice(start, end) + close + text.slice(end);
  const wrappedSpans = normalizeSpans(spans, text.length).flatMap((span) => {
    const parts: TextSpan[] = [];
    if (span.start < start) parts.push({ ...span, end: Math.min(span.end, start) });
    if (span.end > start && span.start < end && start < end) {
      parts.push({ ...span, start: Math.max(span.start, start) + open.length, end: Math.min(span.end, end) + open.length });
    }
    if (span.end > end) {
      const offset = open.length + close.length;
      parts.push({ ...span, start: Math.max(span.start, end) + offset, end: span.end + offset });
    }
    return parts;
  });
  return {
    text: next,
    spans: normalizeSpans(wrappedSpans, next.length),
    start: start + open.length,
    end: end + open.length,
  };
}


export function withTextSpans(formatting: Record<string, TextSpan[] | undefined> | undefined, field: string, spans: TextSpan[]) {
  const next = { ...(formatting ?? {}) };
  if (spans.length) next[field] = spans;
  else delete next[field];
  return Object.keys(next).length ? next : undefined;
}
