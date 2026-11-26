import { createElement, useCallback, useEffect, useLayoutEffect, useRef, useState, type ReactNode } from "react";
import { create } from "zustand";
import { Bold, Code, Italic, RemoveFormatting, Strikethrough, Underline } from "lucide-react";
import { isStoryTextExpression, mapInkTextExpressions } from "@visink/compiler";
import { normalizeSpans, rangeHasMark, rebaseSpans, updateSpanStyle, wrapSelection, type Project, type TextMark, type TextSpan } from "@visink/core";
import { applySuggestion, suggest, type Suggestion, type SuggestResult } from "./suggest";
import { OptionRow, Popup, Select } from "./ui";

export type RichTextCommand =
  | { type: "mark"; mark: TextMark }
  | { type: "size"; size?: number }
  | { type: "quotes"; language: "ru" | "en" }
  | { type: "clear" };

type ActiveEditor = {
  id: number;
  local: boolean;
  marks: TextMark[];
  size?: number;
  baseSize: number;
  apply: (command: RichTextCommand) => void;
  restoreSelection: () => void;
  leaveToolbar: (target: HTMLElement | null) => void;
};

const useActiveEditor = create<{ active: ActiveEditor | null }>(() => ({ active: null }));

export function RichTextToolbar({ local = false }: { local?: boolean }) {
  const active = useActiveEditor((state) => state.active?.local === local ? state.active : null);
  if (!active) return null;
  const sizes = [...new Set([10, 12, 14, 16, 20, 24, 32, active.baseSize, ...(active.size ? [active.size] : [])])].sort((a, b) => a - b);
  const button = (mark: TextMark, label: string, Icon: typeof Bold) => <button type="button" className={`icon-btn ${active.marks.includes(mark) ? "on" : ""}`} aria-label={label} aria-pressed={active.marks.includes(mark)} onMouseDown={(event) => event.preventDefault()} onClick={() => active.apply({ type: "mark", mark })}><Icon size={15} /></button>;
  return <div className="rich-text-toolbar" role="toolbar" aria-label="Форматирование текста" onKeyDown={(event) => event.stopPropagation()} onBlur={(event) => {
    const target = event.relatedTarget as HTMLElement | null;
    if (!event.currentTarget.contains(target)) active.leaveToolbar(target);
  }}>
    <div className="rich-text-size"><Select label="Размер шрифта" preventPointerFocus popupMinWidth={64}
      value={String(active.size ?? active.baseSize)} options={sizes.map((size) => ({ value: String(size), label: String(size) }))}
      onChange={(value) => active.apply({ type: "size", size: Number(value) === active.baseSize ? undefined : Number(value) })} returnFocus={active.restoreSelection} /></div>
    {button("bold", "Жирный", Bold)}
    {button("italic", "Курсив", Italic)}
    {button("underline", "Подчёркивание", Underline)}
    {button("strike", "Зачёркивание", Strikethrough)}
    {button("code", "Встроенный код", Code)}
    <button type="button" className="icon-btn rich-text-quotes" aria-label="Русские кавычки" title="Оборачить в «»" onMouseDown={(event) => event.preventDefault()} onClick={() => active.apply({ type: "quotes", language: "ru" })}>«»</button>
    <button type="button" className="icon-btn rich-text-quotes" aria-label="Английские кавычки" title="Оборачить в “ ”" onMouseDown={(event) => event.preventDefault()} onClick={() => active.apply({ type: "quotes", language: "en" })}>“”</button>
    <button type="button" className="icon-btn" aria-label="Снять форматирование" onMouseDown={(event) => event.preventDefault()} onClick={() => active.apply({ type: "clear" })}><RemoveFormatting size={15} /></button>
  </div>;
}

type TextRange = { start: number; end: number };
type Expression = TextRange & { closed: boolean };
type Segment = { text: string; style?: TextSpan; expression: boolean };

const MARK_TAGS = { code: "code", bold: "strong", italic: "em", underline: "u", strike: "s" } as const;
const MARK_ORDER = Object.keys(MARK_TAGS) as TextMark[];
const MARK_SHORTCUTS: Record<string, TextMark> = { KeyB: "bold", KeyI: "italic", KeyU: "underline" };

function expressionAt(text: string, caret: number): Expression | undefined {
  let start = -1;
  let quoted = false;
  for (let i = 0; i < text.length; i++) {
    const char = text[i];
    if (char === "\\") { i++; continue; }
    if (start >= 0 && char === '"') quoted = !quoted;
    if (quoted) continue;
    if (char === "{") start = i;
    if (start < 0) continue;
    if (char === "}" || char === "\n") {
      if (caret > start && caret <= i) return { start, end: i + Number(char === "}"), closed: char === "}" };
      start = -1;
      quoted = false;
    }
  }
  return start >= 0 && caret > start ? { start, end: text.length, closed: false } : undefined;
}

function textSegments(text: string, spans: TextSpan[] | undefined, project?: Project, localNames: string[] = [], pending?: Expression): Segment[] {
  if (!text) return [];
  const styles = normalizeSpans(spans, text.length);
  const expressions: TextRange[] = [];
  if (project && text.includes("{")) {
    mapInkTextExpressions(text, (expression, range) => {
      if (!isStoryTextExpression(project, expression.trim(), localNames)) return null;
      expressions.push(range);
      return "";
    });
    if (pending && !expressions.some((range) => range.start === pending.start)
      && /^[\x20-\x7E]*$/.test(text.slice(pending.start + 1, pending.end - Number(pending.closed)))) expressions.push(pending);
  }
  const points = new Set([0, text.length, ...[...styles, ...expressions].flatMap(({ start, end }) => [start, end])]);
  const sorted = [...points].sort((a, b) => a - b);
  return sorted.slice(0, -1).map((start, index) => ({
    text: text.slice(start, sorted[index + 1]),
    style: styles.find((span) => span.start <= start && span.end > start),
    expression: expressions.some((range) => range.start <= start && range.end > start),
  }));
}

export function RichTextView({ text, spans, project, localNames = [] }: { text: string; spans?: TextSpan[]; project?: Project; localNames?: string[] }) {
  return <>{textSegments(text, spans, project, localNames).map((segment, index) => {
    let content: ReactNode = segment.text;
    for (const mark of MARK_ORDER) if (segment.style?.marks.includes(mark)) content = createElement(MARK_TAGS[mark], null, content);
    return <span key={index} className={segment.expression ? "ink-expression mono" : undefined} style={segment.style?.size ? { fontSize: segment.style.size } : undefined}>{content}</span>;
  })}</>;
}

function renderDraft(root: HTMLElement, segments: Segment[]) {
  const children = segments.map((segment) => {
    let content: Node = document.createTextNode(segment.text);
    if (!segment.style && !segment.expression) return content;
    for (const mark of MARK_ORDER) {
      if (!segment.style?.marks.includes(mark)) continue;
      const element = document.createElement(MARK_TAGS[mark]);
      element.append(content);
      content = element;
    }
    const span = document.createElement("span");
    if (segment.expression) span.className = "ink-expression mono";
    if (segment.style?.size) span.style.fontSize = `${segment.style.size}px`;
    span.append(content);
    return span;
  });
  root.replaceChildren(...children);
}

function selectionOffsets(root: HTMLElement, range: Range) {
  const start = document.createRange();
  start.selectNodeContents(root);
  start.setEnd(range.startContainer, range.startOffset);
  const from = start.toString().length;
  return { start: from, end: from + range.toString().length };
}

function restoreOffsets(root: HTMLElement, start: number, end: number) {
  const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
  const range = document.createRange();
  let current = 0;
  let started = false;
  let ended = false;
  let node = walker.nextNode();
  while (node) {
    const length = node.textContent?.length ?? 0;
    if (!started && start <= current + length) {
      range.setStart(node, Math.max(0, start - current));
      started = true;
    }
    if (end <= current + length) {
      range.setEnd(node, Math.max(0, end - current));
      ended = true;
      break;
    }
    current += length;
    node = walker.nextNode();
  }
  if (!started) range.selectNodeContents(root);
  if (started && !ended) range.setEndAfter(root);
  const selection = window.getSelection();
  selection?.removeAllRanges();
  selection?.addRange(range);
}

export function RichTextEditor({
  text,
  spans,
  onSave,
  onFormat,
  project,
  localNames = [],
  className = "",
  placeholder,
  ariaLabel,
  mode = "click",
  multiline = false,
  locked = false,
  startRequest = 0,
  cellClick = false,
  openFlow = false,
  localToolbar = false,
  rich = true,
  live = false,
}: {
  text: string;
  spans?: TextSpan[];
  onSave: (text: string, spans: TextSpan[]) => void;
  onFormat: (text: string, spans: TextSpan[]) => void;
  project?: Project;
  localNames?: string[];
  className?: string;
  placeholder?: string;
  ariaLabel?: string;
  mode?: "click" | "doubleClick";
  multiline?: boolean;
  locked?: boolean;
  startRequest?: number;
  cellClick?: boolean;
  openFlow?: boolean;
  localToolbar?: boolean;
  rich?: boolean;
  live?: boolean;
}) {
  const [editing, setEditing] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  const id = useRef(0);
  if (!id.current) id.current = Date.now() + Math.random();
  const clickAt = useRef<{ x: number; y: number } | null>(null);
  const draft = useRef({ text, spans: normalizeSpans(spans, text.length) });
  const range = useRef({ start: 0, end: 0 });
  const cancelled = useRef(false);
  const composing = useRef(false);
  const wasEditing = useRef(false);
  const showLocalToolbar = useActiveEditor((state) => !!localToolbar && state.active?.id === id.current);
  const [completion, setCompletion] = useState<{ expression: Expression; result: SuggestResult; caret: number } | null>(null);
  const [activeSuggestion, setActiveSuggestion] = useState(0);
  const completionCaret = useRef<number | null>(null);
  const closeSuggestions = useCallback(() => {
    completionCaret.current = null;
    setCompletion(null);
  }, []);

  const currentRange = () => {
    const root = ref.current;
    const selection = window.getSelection();
    if (!root || !selection?.rangeCount) return range.current;
    const selected = selection.getRangeAt(0);
    if (!root.contains(selected.startContainer) || !root.contains(selected.endContainer)) return range.current;
    range.current = selectionOffsets(root, selected);
    return range.current;
  };
  const refreshSuggestions = (forced = false) => {
    const { start, end } = currentRange();
    const source = draft.current.text;
    const expression = project && start === end ? expressionAt(source, start) : undefined;
    if (!project || !expression) { closeSuggestions(); return; }
    const inner = source.slice(expression.start + 1, expression.end - Number(expression.closed));
    if (!/^[\x20-\x7E]*$/.test(inner)) { closeSuggestions(); return; }
    const result = suggest(inner, start - expression.start - 1, project, { forced, extra: localNames });
    const seen = new Set<string>();
    const items = result?.items.filter((item) => {
      if (item.kind === "file" || seen.has(item.insert)) return false;
      seen.add(item.insert);
      return true;
    });
    if (!result || !items?.length) { closeSuggestions(); return; }
    completionCaret.current = start;
    setCompletion({ expression, result: { ...result, items }, caret: start });
    setActiveSuggestion(0);
  };
  const paint = (root: HTMLElement, pending?: Expression) => {
    const { text: value, spans: style } = draft.current;
    renderDraft(root, textSegments(value, style, project, localNames, pending));
  };
  const readInput = (root: HTMLElement) => {
    const previous = draft.current.text;
    const next = root.textContent ?? "";
    draft.current = { text: next, spans: rebaseSpans(draft.current.spans, previous, next) };
    const { start, end } = currentRange();
    if (composing.current) return;
    if (project && (previous.includes("{") || next.includes("{"))) {
      paint(root, start === end ? expressionAt(next, start) : undefined);
      restoreOffsets(root, start, end);
    }
    if (live) onSave(next, draft.current.spans);
    refreshSuggestions();
  };
  const pickSuggestion = (item: Suggestion) => {
    const root = ref.current;
    if (!root || !completion || currentRange().start !== completion.caret) return;
    const { expression, result } = completion;
    const source = draft.current.text;
    const from = expression.start + 1;
    const end = expression.end - Number(expression.closed);
    const applied = applySuggestion(source.slice(from, end), result, item);
    const next = source.slice(0, from) + applied.text + (expression.closed ? "" : "}") + source.slice(end);
    const place = from + applied.caret;
    draft.current = { text: next, spans: rebaseSpans(draft.current.spans, source, next) };
    closeSuggestions();
    paint(root, expressionAt(next, place));
    restoreOffsets(root, place, place);
    if (live) onSave(next, draft.current.spans);
  };
  const insertText = (text: string) => {
    const root = ref.current;
    const selection = window.getSelection();
    if (!root?.isContentEditable || !selection?.rangeCount) return;
    const selected = selection.getRangeAt(0);
    if (!root.contains(selected.startContainer) || !root.contains(selected.endContainer)) return;
    selected.deleteContents();
    const node = document.createTextNode(text.replace(/\r\n?/g, "\n"));
    selected.insertNode(node);
    selected.setStart(node, node.length);
    selected.collapse(true);
    selection.removeAllRanges();
    selection.addRange(selected);
    readInput(root);
  };
  const activeStyle = (start: number, end: number) => {
    const marks = MARK_ORDER.filter((mark) => rangeHasMark(draft.current.spans, draft.current.text.length, start, end, mark)
      || start === end && normalizeSpans(draft.current.spans, draft.current.text.length).some((span) => span.start <= start && span.end >= start && span.marks.includes(mark)));
    const size = normalizeSpans(draft.current.spans, draft.current.text.length).find((span) => span.start <= start && span.end >= Math.max(start, end))?.size;
    return { marks, size };
  };
  const activate = () => {
    const root = ref.current;
    if (!rich || !root?.isContentEditable || document.activeElement !== root) return;
    const { start, end } = currentRange();
    if (completionCaret.current != null && (start !== completionCaret.current || start !== end)) closeSuggestions();
    const style = activeStyle(start, end);
    useActiveEditor.setState({ active: {
      id: id.current,
      local: localToolbar,
      ...style,
      baseSize: Number.parseFloat(getComputedStyle(root).fontSize),
      apply: applyCommand,
      restoreSelection: () => {
        if (ref.current !== root || !root.isContentEditable) return;
        const selection = range.current;
        root.focus();
        restoreOffsets(root, selection.start, selection.end);
        activate();
      },
      leaveToolbar: (target) => { if (target !== root) commit(target); },
    } });
  };
  const start = () => {
    if (locked) return;
    cancelled.current = false;
    draft.current = { text, spans: normalizeSpans(spans, text.length) };
    setEditing(true);
  };
  const applyCommand = (command: RichTextCommand) => {
    const root = ref.current;
    if (!root?.isContentEditable) return;
    const { start, end } = range.current;
    if (end <= start) return;
    let nextText = draft.current.text;
    let nextSpans = draft.current.spans;
    if (command.type === "mark") {
      const active = rangeHasMark(nextSpans, nextText.length, start, end, command.mark);
      nextSpans = updateSpanStyle(nextSpans, nextText.length, start, end, (style) => ({ ...style, marks: active ? style.marks.filter((mark) => mark !== command.mark) : [...style.marks, command.mark] }));
    } else if (command.type === "size") {
      nextSpans = updateSpanStyle(nextSpans, nextText.length, start, end, (style) => ({ marks: style.marks, ...(command.size != null ? { size: command.size } : {}) }));
    } else if (command.type === "clear") {
      nextSpans = updateSpanStyle(nextSpans, nextText.length, start, end, () => ({ marks: [] }));
    } else {
      const quotes = command.language === "ru" ? ["«", "»"] : ["“", "”"];
      const wrapped = wrapSelection(nextText, nextSpans, start, end, quotes[0], quotes[1]);
      nextText = wrapped.text;
      nextSpans = wrapped.spans;
      range.current = { start: wrapped.start, end: wrapped.end };
    }
    draft.current = { text: nextText, spans: nextSpans };
    onFormat(nextText, nextSpans);
    const selection = range.current;
    root.focus();
    paint(root);
    restoreOffsets(root, selection.start, selection.end);
    activate();
  };
  useEffect(() => {
    if (!startRequest || locked) return;
    clickAt.current = null;
    start();
  }, [startRequest]);
  useLayoutEffect(() => {
    const root = ref.current;
    if (!editing || !root) return;
    paint(root);
    root.focus();
    if (!wasEditing.current) {
      const at = clickAt.current;
      const point = at && document.caretRangeFromPoint ? document.caretRangeFromPoint(at.x, at.y) : null;
      const selection = window.getSelection();
      selection?.removeAllRanges();
      if (point && root.contains(point.startContainer)) selection?.addRange(point);
      else {
        const end = document.createRange();
        end.selectNodeContents(root);
        end.collapse(false);
        selection?.addRange(end);
      }
    }
    wasEditing.current = true;
    activate();
  }, [editing]);
  useEffect(() => {
    if (!editing) { wasEditing.current = false; return; }
    const change = () => { if (!composing.current) activate(); };
    const root = ref.current;
    const normalizeInsert = (event: InputEvent) => {
      if (composing.current || !event.cancelable) return;
      const text = event.inputType === "insertParagraph" || event.inputType === "insertLineBreak" ? "\n" : event.data;
      if (!text || !/[\r\n]/.test(text)) return;
      event.preventDefault();
      insertText(text);
    };
    document.addEventListener("selectionchange", change);
    root?.addEventListener("beforeinput", normalizeInsert);
    return () => {
      document.removeEventListener("selectionchange", change);
      root?.removeEventListener("beforeinput", normalizeInsert);
    };
  }, [editing]);
  useEffect(() => {
    if (!cellClick) return;
    const cell = ref.current?.closest<HTMLElement>(".card-cell");
    if (!cell) return;
    const click = (event: MouseEvent) => {
      if (locked || event.shiftKey || event.metaKey || event.ctrlKey || event.target !== cell) return;
      clickAt.current = { x: event.clientX, y: event.clientY };
      if (editing) ref.current?.focus(); else start();
    };
    cell.addEventListener("click", click);
    return () => cell.removeEventListener("click", click);
  }, [cellClick, editing, locked]);
  useEffect(() => () => {
    if (useActiveEditor.getState().active?.id === id.current) useActiveEditor.setState({ active: null });
  }, []);

  const commit = (relatedTarget: HTMLElement | null) => {
    if (relatedTarget?.closest(".rich-text-toolbar")) return;
    composing.current = false;
    closeSuggestions();
    setEditing(false);
    if (useActiveEditor.getState().active?.id === id.current) useActiveEditor.setState({ active: null });
    if (cancelled.current) { cancelled.current = false; return; }
    const next = multiline ? draft.current.text : draft.current.text.replace(/\n+$/, "");
    const nextSpans = normalizeSpans(draft.current.spans, next.length);
    if (next !== text || JSON.stringify(nextSpans) !== JSON.stringify(normalizeSpans(spans, text.length))) onSave(next, nextSpans);
  };
  return <div className={`rich-text-field ${showLocalToolbar && editing ? "with-toolbar" : ""}`}>
    {showLocalToolbar && rich && editing && <RichTextToolbar local />}
    {editing ? <div
      key="edit"
      ref={ref}
      className={`${className} editing nodrag nowheel`}
      contentEditable
      suppressContentEditableWarning
      role="textbox"
      aria-multiline={multiline}
      spellCheck
      data-placeholder={placeholder}
      aria-label={ariaLabel}
      onFocus={activate}
      onBlur={(event) => commit(event.relatedTarget as HTMLElement | null)}
      onInput={(event) => readInput(event.currentTarget)}
      onPaste={(event) => {
        event.preventDefault();
        const text = event.clipboardData.getData("text/plain");
        if (text) insertText(text);
      }}
      onCompositionStart={() => { composing.current = true; }}
      onCompositionEnd={(event) => { composing.current = false; readInput(event.currentTarget); }}
      onSelect={activate}
      onKeyDown={(event) => {
        event.stopPropagation();
        if (event.nativeEvent.isComposing || composing.current) return;
        const mark = rich && (event.ctrlKey || event.metaKey) && !event.altKey && !event.shiftKey ? MARK_SHORTCUTS[event.code] : undefined;
        if (mark) {
          event.preventDefault();
          currentRange();
          applyCommand({ type: "mark", mark });
          return;
        }
        if (event.code === "Space" && (event.ctrlKey || event.metaKey) && project) {
          event.preventDefault();
          refreshSuggestions(true);
          return;
        }
        if (completion && (event.key === "ArrowDown" || event.key === "ArrowUp")) {
          event.preventDefault();
          const step = event.key === "ArrowDown" ? 1 : -1;
          const count = completion.result.items.length;
          setActiveSuggestion((index) => (index + step + count) % count);
          return;
        }
        if (completion && (event.key === "Enter" && !event.shiftKey || event.key === "Tab")) {
          event.preventDefault();
          pickSuggestion(completion.result.items[activeSuggestion]);
          return;
        }
        if (event.key === "Escape") {
          event.preventDefault();
          if (completion) { closeSuggestions(); return; }
          cancelled.current = true;
          event.currentTarget.blur();
        } else if (event.key === "Enter" && !event.shiftKey && !multiline) {
          event.preventDefault();
          event.currentTarget.blur();
        }
      }}
      onDoubleClick={(event) => { if (!openFlow) event.stopPropagation(); }}
    />
      : <div
        key="view"
        ref={ref}
        className={`${className} ${text ? "" : "empty"}`}
        title={text || placeholder}
        aria-label={ariaLabel}
        tabIndex={locked ? undefined : 0}
        onClick={(event) => {
          if (locked || mode !== "click" || event.shiftKey || event.metaKey || event.ctrlKey) return;
          clickAt.current = { x: event.clientX, y: event.clientY };
          start();
        }}
        onDoubleClick={(event) => {
          if (locked || mode !== "doubleClick") return;
          event.stopPropagation();
          clickAt.current = { x: event.clientX, y: event.clientY };
          start();
        }}
        onKeyDown={(event) => {
          if (locked || event.key !== "Enter") return;
          event.preventDefault();
          event.stopPropagation();
          clickAt.current = null;
          start();
        }}
      ><RichTextView text={text} spans={spans} project={project} localNames={localNames} />{!text && placeholder}</div>}
    {editing && completion && ref.current && <Popup anchor={ref.current} onClose={closeSuggestions}>
      {completion.result.items.map((item, index) => <OptionRow key={item.insert} option={{ value: item.insert, label: item.label, hint: item.hint }}
        active={index === activeSuggestion} selected={false} onHover={() => setActiveSuggestion(index)} onPick={() => pickSuggestion(item)} />)}
    </Popup>}
  </div>;
}
