import { useCallback, useEffect, useLayoutEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import type { LucideIcon } from "lucide-react";
import { Check, ChevronDown } from "lucide-react";
import type { Project } from "@visink/core";
import type { SuggestResult, Suggestion } from "./suggest";
import { applySuggestion, suggest } from "./suggest";

/** Кнопка-иконка: подпись показывается подсказкой при наведении. */
export function IconButton({
  icon: Icon,
  label,
  onClick,
  disabled,
  primary,
  badge,
  className = "",
}: {
  icon: LucideIcon;
  label: string;
  onClick: () => void;
  disabled?: boolean;
  primary?: boolean;
  /** маленькая точка или число в углу */
  badge?: string | number | boolean;
  className?: string;
}) {
  return (
    <button
      type="button"
      className={`icon-btn ${primary ? "primary" : ""} ${className}`}
      data-tip={label}
      aria-label={label}
      onClick={onClick}
      disabled={disabled}
    >
      <Icon size={16} strokeWidth={2} />
      {badge ? <span className="icon-badge">{badge === true ? "" : badge}</span> : null}
    </button>
  );
}

// ───────────── размеры панелей ─────────────

export interface PanelSizes {
  left: number;
  right: number;
  dock: number;
}

export interface PanelsOpen {
  showLeft: boolean;
  showRight: boolean;
  showDock: boolean;
}

const SIZES_KEY = "visink-panels";
export const DEFAULT_SIZES: PanelSizes = { left: 260, right: 320, dock: 220 };
export const MIN_SIZES: PanelSizes = { left: 220, right: 300, dock: 120 };
/** холст не уже этого — ограничивает боковые панели */
const MIN_CANVAS = 320;
const MIN_CANVAS_HEIGHT = 200;

const DEFAULT_OPEN: PanelsOpen = { showLeft: true, showRight: true, showDock: true };

function readSizes(): PanelSizes & PanelsOpen {
  try {
    const raw = JSON.parse(localStorage.getItem(SIZES_KEY) ?? "{}");
    return { ...DEFAULT_SIZES, ...DEFAULT_OPEN, ...raw };
  } catch {
    return { ...DEFAULT_SIZES, ...DEFAULT_OPEN };
  }
}

/** Ширины боковых панелей, высота нижней и какие из них открыты — с запоминанием между сессиями. */
export function usePanelSizes() {
  const [sizes, setSizes] = useState<PanelSizes & PanelsOpen>(readSizes);
  useEffect(() => {
    try {
      localStorage.setItem(SIZES_KEY, JSON.stringify(sizes));
    } catch {
      // не запомним — не страшно
    }
  }, [sizes]);

  const clamp = useCallback((next: PanelSizes & PanelsOpen): PanelSizes & PanelsOpen => {
    const w = window.innerWidth;
    const h = window.innerHeight;
    const otherRight = next.showRight ? next.right : 0;
    const left = Math.max(MIN_SIZES.left, Math.min(next.left, w - otherRight - MIN_CANVAS));
    const right = Math.max(MIN_SIZES.right, Math.min(next.right, w - (next.showLeft ? left : 0) - MIN_CANVAS));
    const dock = Math.max(MIN_SIZES.dock, Math.min(next.dock, h - MIN_CANVAS_HEIGHT));
    return { ...next, left, right, dock };
  }, []);

  const resize = useCallback((patch: Partial<PanelSizes>) => setSizes((s) => clamp({ ...s, ...patch })), [clamp]);
  const reset = useCallback((key: keyof PanelSizes) => setSizes((s) => clamp({ ...s, [key]: DEFAULT_SIZES[key] })), [clamp]);
  const toggle = useCallback((key: keyof PanelsOpen, open?: boolean) => setSizes((s) => clamp({ ...s, [key]: open ?? !s[key] })), [clamp]);

  // окно стало меньше — ужать панели
  useEffect(() => {
    const onResize = () => setSizes((s) => clamp(s));
    window.addEventListener("resize", onResize);
    return () => window.removeEventListener("resize", onResize);
  }, [clamp]);

  return { sizes, resize, reset, toggle };
}

/**
 * Полоса между панелями. onDrag получает смещение от начала перетаскивания в пикселях.
 * Двойной щелчок — размер по умолчанию.
 */
export function Splitter({
  direction,
  onDrag,
  onReset,
  className = "",
}: {
  direction: "col" | "row";
  onDrag: (delta: number, start: boolean) => void;
  onReset: () => void;
  className?: string;
}) {
  return (
    <div
      className={`splitter splitter-${direction} ${className}`}
      onDoubleClick={onReset}
      onPointerDown={(e) => {
        if (e.button !== 0) return;
        e.preventDefault();
        const el = e.currentTarget;
        try {
          el.setPointerCapture(e.pointerId);
        } catch {
          // указатель уже отпущен — перетаскивание всё равно сработает на этом элементе
        }
        el.classList.add("dragging");
        const origin = direction === "col" ? e.clientX : e.clientY;
        onDrag(0, true);
        const move = (ev: PointerEvent) => onDrag((direction === "col" ? ev.clientX : ev.clientY) - origin, false);
        const up = () => {
          el.classList.remove("dragging");
          el.removeEventListener("pointermove", move);
          el.removeEventListener("pointerup", up);
          el.removeEventListener("pointercancel", up);
        };
        el.addEventListener("pointermove", move);
        el.addEventListener("pointerup", up);
        el.addEventListener("pointercancel", up);
      }}
    />
  );
}

// ───────────── выпадающие списки ─────────────

export interface Option<T extends string = string> {
  value: T;
  label: string;
  /** цветной кружок слева (спикеры) */
  color?: string;
  /** серым справа */
  hint?: string;
}

/** Всплывающий список под якорем: портал в body, переворачивается вверх у нижнего края окна. */
function Popup({ anchor, onClose, children }: { anchor: HTMLElement; onClose: () => void; children: React.ReactNode }) {
  const ref = useRef<HTMLDivElement>(null);
  const [pos, setPos] = useState<{ left: number; top?: number; bottom?: number; width: number; maxHeight: number }>();
  useLayoutEffect(() => {
    const r = anchor.getBoundingClientRect();
    const below = window.innerHeight - r.bottom - 8;
    const above = r.top - 8;
    const flip = below < 200 && above > below;
    setPos({
      left: Math.min(r.left, window.innerWidth - Math.max(r.width, 180) - 8),
      width: Math.max(r.width, 180),
      ...(flip ? { bottom: window.innerHeight - r.top + 4 } : { top: r.bottom + 4 }),
      maxHeight: Math.min(320, flip ? above : below),
    });
  }, [anchor]);
  useEffect(() => {
    const down = (e: MouseEvent) => {
      if (!ref.current?.contains(e.target as globalThis.Node) && !anchor.contains(e.target as globalThis.Node)) onClose();
    };
    const away = (e: Event) => {
      if (!ref.current?.contains(e.target as globalThis.Node)) onClose();
    };
    document.addEventListener("mousedown", down, true);
    window.addEventListener("scroll", away, true);
    window.addEventListener("resize", onClose);
    return () => {
      document.removeEventListener("mousedown", down, true);
      window.removeEventListener("scroll", away, true);
      window.removeEventListener("resize", onClose);
    };
  }, [anchor, onClose]);
  if (!pos) return null;
  return createPortal(
    <div ref={ref} className="popup" style={pos} onMouseDown={(e) => e.preventDefault()}>
      {children}
    </div>,
    document.body,
  );
}

function OptionRow({ option, active, selected, onPick, onHover }: { option: Option; active: boolean; selected: boolean; onPick: () => void; onHover: () => void }) {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (active) ref.current?.scrollIntoView({ block: "nearest" });
  }, [active]);
  return (
    <div ref={ref} className={`popup-option ${active ? "active" : ""} ${selected ? "selected" : ""}`} onMouseEnter={onHover} onClick={onPick}>
      {option.color && <span className="swatch" style={{ background: option.color }} />}
      <span className="popup-label">{option.label}</span>
      {option.hint && <span className="popup-hint">{option.hint}</span>}
      {selected && <Check size={14} className="popup-check" />}
    </div>
  );
}

/** Выпадающий список в стиле приложения вместо браузерного select. */
export function Select<T extends string>({
  value,
  options,
  onChange,
  placeholder = "—",
  mono,
}: {
  /** null — у выделенных карточек разные значения */
  value: T | null;
  options: Option<T>[];
  onChange: (v: T) => void;
  placeholder?: string;
  mono?: boolean;
}) {
  const [open, setOpen] = useState(false);
  const [active, setActive] = useState(0);
  const button = useRef<HTMLButtonElement>(null);
  const typed = useRef({ text: "", at: 0 });
  const current = options.find((o) => o.value === value);
  const show = () => {
    setActive(Math.max(0, options.findIndex((o) => o.value === value)));
    setOpen(true);
  };
  const pick = (o: Option<T>) => {
    setOpen(false);
    if (o.value !== value) onChange(o.value);
    button.current?.focus();
  };
  const close = useCallback(() => setOpen(false), []);
  return (
    <>
      <button
        ref={button}
        type="button"
        className={`select ${mono ? "mono" : ""} ${open ? "open" : ""}`}
        onClick={() => (open ? setOpen(false) : show())}
        onKeyDown={(e) => {
          if (e.key === "ArrowDown" || e.key === "ArrowUp") {
            e.preventDefault();
            if (!open) return show();
            setActive((i) => (i + (e.key === "ArrowDown" ? 1 : -1) + options.length) % options.length);
          } else if (e.key === "Enter" && open) {
            e.preventDefault();
            if (options[active]) pick(options[active]);
          } else if (e.key === "Escape" && open) {
            e.preventDefault();
            e.stopPropagation();
            setOpen(false);
          } else if (e.key.length === 1 && !e.metaKey && !e.ctrlKey) {
            // ввод первых букв — переход к варианту
            const now = Date.now();
            typed.current = { text: (now - typed.current.at < 700 ? typed.current.text : "") + e.key.toLowerCase(), at: now };
            const i = options.findIndex((o) => o.label.toLowerCase().startsWith(typed.current.text));
            if (i >= 0) {
              if (!open) show();
              setActive(i);
            }
          }
        }}
      >
        {current?.color && <span className="swatch" style={{ background: current.color }} />}
        <span className={`select-value ${current ? "" : "muted"}`}>{current ? current.label : value === null ? "— разные —" : placeholder}</span>
        <ChevronDown size={14} className="select-chevron" />
      </button>
      {open && button.current && (
        <Popup anchor={button.current} onClose={close}>
          {options.map((o, i) => (
            <OptionRow key={o.value} option={o} active={i === active} selected={o.value === value} onPick={() => pick(o)} onHover={() => setActive(i)} />
          ))}
        </Popup>
      )}
    </>
  );
}

/** Поле ввода с подсказками в стиле приложения вместо datalist. */
export function Combobox({
  value,
  options,
  onChange,
  placeholder,
  mono,
}: {
  value: string;
  options: string[];
  onChange: (v: string) => void;
  placeholder?: string;
  mono?: boolean;
}) {
  const [open, setOpen] = useState(false);
  const [active, setActive] = useState(-1);
  const input = useRef<HTMLInputElement>(null);
  const q = value.trim().toLowerCase();
  const shown = options.filter((o) => !q || (o.toLowerCase().includes(q) && o !== value)).slice(0, 50);
  const close = useCallback(() => setOpen(false), []);
  const pick = (v: string) => {
    onChange(v);
    setOpen(false);
  };
  return (
    <>
      <input
        ref={input}
        className={mono ? "mono" : ""}
        value={value}
        placeholder={placeholder}
        onChange={(e) => {
          onChange(e.target.value);
          setOpen(true);
          setActive(-1);
        }}
        onFocus={() => setOpen(true)}
        onBlur={close}
        onKeyDown={(e) => {
          if (e.key === "ArrowDown" || e.key === "ArrowUp") {
            e.preventDefault();
            setOpen(true);
            if (shown.length) setActive((i) => (i + (e.key === "ArrowDown" ? 1 : -1) + shown.length) % shown.length);
          } else if (e.key === "Enter" && open && shown[active]) {
            e.preventDefault();
            pick(shown[active]);
          } else if (e.key === "Escape" && open) {
            e.stopPropagation();
            setOpen(false);
          }
        }}
      />
      {open && shown.length > 0 && input.current && (
        <Popup anchor={input.current} onClose={close}>
          {shown.map((o, i) => (
            <OptionRow key={o} option={{ value: o, label: o }} active={i === active} selected={false} onPick={() => pick(o)} onHover={() => setActive(i)} />
          ))}
        </Popup>
      )}
    </>
  );
}

// ───────────── поле ink-выражения с подсказками ─────────────

/** Поле для условий, действий и кода ink: подсказки по мере ввода и по Ctrl+Space. */
export function CodeInput({
  value,
  onChange,
  project,
  multiline,
  rows = 2,
  extra,
  placeholder,
}: {
  value: string;
  onChange: (v: string) => void;
  project: Project;
  multiline?: boolean;
  rows?: number;
  /** локальные имена — параметры функции */
  extra?: string[];
  placeholder?: string;
}) {
  const ref = useRef<HTMLTextAreaElement & HTMLInputElement>(null);
  const [result, setResult] = useState<SuggestResult | null>(null);
  const [active, setActive] = useState(0);
  const update = (text: string, caret: number, forced = false) => {
    setResult(suggest(text, caret, project, { forced, extra }));
    setActive(0);
  };
  const apply = (s: Suggestion) => {
    if (!result) return;
    const next = applySuggestion(value, result, s);
    onChange(next.text);
    setResult(null);
    requestAnimationFrame(() => {
      ref.current?.focus();
      ref.current?.setSelectionRange(next.caret, next.caret);
    });
  };
  const close = useCallback(() => setResult(null), []);
  const props = {
    ref,
    className: "mono code-input",
    value,
    placeholder,
    spellCheck: false,
    onChange: (e: React.ChangeEvent<HTMLTextAreaElement & HTMLInputElement>) => {
      onChange(e.target.value);
      update(e.target.value, e.target.selectionStart ?? e.target.value.length);
    },
    onBlur: close,
    onKeyDown: (e: React.KeyboardEvent<HTMLTextAreaElement & HTMLInputElement>) => {
      if (e.key === " " && (e.ctrlKey || e.metaKey)) {
        e.preventDefault();
        update(value, e.currentTarget.selectionStart ?? value.length, true);
        return;
      }
      if (!result) return;
      const n = result.items.length;
      if (e.key === "ArrowDown" || e.key === "ArrowUp") {
        e.preventDefault();
        setActive((i) => (i + (e.key === "ArrowDown" ? 1 : -1) + n) % n);
      } else if (e.key === "Enter" || e.key === "Tab") {
        e.preventDefault();
        apply(result.items[active]);
      } else if (e.key === "Escape") {
        e.preventDefault();
        e.stopPropagation();
        setResult(null);
      }
    },
  };
  return (
    <>
      {multiline ? <textarea rows={rows} {...props} /> : <input {...props} />}
      {result && ref.current && (
        <Popup anchor={ref.current} onClose={close}>
          {result.items.map((s, i) => (
            <OptionRow
              key={s.kind + s.insert}
              option={{ value: s.insert, label: s.label, hint: s.hint }}
              active={i === active}
              selected={false}
              onPick={() => apply(s)}
              onHover={() => setActive(i)}
            />
          ))}
        </Popup>
      )}
    </>
  );
}
