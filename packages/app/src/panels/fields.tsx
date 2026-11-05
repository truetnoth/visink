// мелкие поля форм свойств: текстовые поля, select, выражения ink
import { CodeInput, Select as UiSelect } from "../ui";
import type { Option } from "../ui";
import type { Entity, Project } from "@visink/core";
import { unknownIdentifiers } from "@visink/checker";
import { usePortrait } from "../portraits";

export const COLORS = ["#8a5cf6", "#10b981", "#f59e0b", "#ef4444", "#06b6d4", "#ec4899", "#84cc16", "#f97316"];

// ───────────── общие поля ─────────────

export function PortraitPreview({ entity }: { entity: Entity }) {
  const url = usePortrait(entity.portrait);
  return (
    <div className="portrait-preview" style={{ background: entity.color }} title={entity.portrait && !url ? "файл не найден или не картинка" : undefined}>
      {url && <img src={url} alt="" />}
    </div>
  );
}

export function Field({ label, hint, children }: { label: string; hint?: React.ReactNode; children: React.ReactNode }) {
  return (
    <label className="field">
      <span className="field-label">{label}</span>
      {children}
      {hint && <span className="field-hint">{hint}</span>}
    </label>
  );
}

export function Text({
  value,
  onChange,
  multiline,
  mono,
  placeholder,
  rows = 3,
  inputRef,
  list,
}: {
  value: string;
  onChange: (v: string) => void;
  multiline?: boolean;
  mono?: boolean;
  placeholder?: string;
  rows?: number;
  inputRef?: React.Ref<HTMLTextAreaElement & HTMLInputElement>;
  list?: string;
}) {
  const cls = mono ? "mono" : "";
  return multiline ? (
    <textarea ref={inputRef} className={cls} rows={rows} value={value} placeholder={placeholder} spellCheck={!mono} autoCapitalize={mono ? "off" : undefined} autoCorrect={mono ? "off" : undefined} onChange={(e) => onChange(e.target.value)} />
  ) : (
    <input ref={inputRef} className={cls} value={value} placeholder={placeholder} list={list} spellCheck={!mono} autoCapitalize={mono ? "off" : undefined} autoCorrect={mono ? "off" : undefined} onChange={(e) => onChange(e.target.value)} />
  );
}

export function Select<T extends string>({ value, options, onChange }: { value: T | null; options: ([T, string] | Option<T>)[]; onChange: (v: T) => void }) {
  const opts = options.map((o): Option<T> => (Array.isArray(o) ? { value: o[0], label: o[1] } : o));
  return <UiSelect value={value} options={opts} onChange={onChange} />;
}

/** Персонажи как варианты выпадающего списка — с цветом. */
export function characterOptions(project: Project, empty = "— без спикера —"): Option[] {
  return [
    { value: "", label: empty },
    ...project.entities.filter((e) => e.kind === "character").map((e) => ({ value: e.id, label: e.name, color: e.color, hint: e.isPlayer ? "игрок" : undefined })),
  ];
}

/** Поле ink-выражения: подсказки по мере ввода (и по Ctrl+Space), подсветка неизвестных имён. */
export function ExprField({
  label,
  value,
  onChange,
  project,
  multiline,
  rows,
  extra,
  hint,
  noCheck,
}: {
  label: string;
  value: string;
  onChange: (v: string) => void;
  project: Project;
  multiline?: boolean;
  rows?: number;
  /** локальные имена — параметры функции */
  extra?: string[];
  hint?: string;
  /** не проверять имена — в чистом ink есть обычный текст */
  noCheck?: boolean;
}) {
  const unknown = value && !noCheck ? unknownIdentifiers(value, project, extra) : [];
  return (
    <Field label={label} hint={unknown.length > 0 ? <span className="bad">Неизвестно: {unknown.join(", ")}</span> : hint}>
      <CodeInput value={value} onChange={onChange} project={project} multiline={multiline} rows={rows} extra={extra} />
    </Field>
  );
}
