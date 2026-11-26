import { draggedItems, variableDrop } from "../treeDrag";
// редактирование текста на карточке прямо на месте (без отдельного поля ввода)
import { memo, useEffect, useLayoutEffect, useRef, useState } from "react";
import { canvasAtPath, withTextSpans, type Card, type TextSpan } from "@visink/core";
import { editAtomic, useStore } from "../store";
import { CodeInput } from "../ui";
import { RichTextEditor } from "../richText";

const FIELD_CLASS = { text: "", menuText: "menu-text", stageDirection: "stage-dir", condition: "mono", description: "" } as const;
type InlineField = "text" | "menuText" | "stageDirection" | "condition" | "description";

/** Черновик условия сохраняется одним изменением, как обычный текст карточки. */
function InlineCondition({ card, placeholder, onClose }: { card: Card; placeholder: string; onClose: () => void }) {
  const project = useStore((s) => s.project)!;
  const [draft, setDraft] = useState(card.condition ?? "");
  const input = useRef<HTMLTextAreaElement & HTMLInputElement>(null);
  const cancelled = useRef(false);
  useLayoutEffect(() => {
    input.current?.focus();
    input.current?.setSelectionRange(draft.length, draft.length);
  }, []);
  const commit = (close = true) => {
    const text = draft.replace(/\n+$/, "");
    if (!cancelled.current && text !== (card.condition ?? "")) {
      useStore.getState().editCanvas((canvas) => {
        const target = canvas.cards.find((c) => c.id === card.id);
        if (target) target.condition = text;
      });
    }
    if (close) onClose();
  };
  return <div className="inline-condition nodrag nowheel" onKeyDown={(e) => e.stopPropagation()} onDoubleClick={(e) => e.stopPropagation()}>
    <CodeInput value={draft} onChange={setDraft} project={project} extra={card.inputs?.map((input) => input.name)} multiline rows={1} inputRef={input}
      className="card-text editing inline-condition-input" placeholder={placeholder} onBlur={(e) => commit(!(e.relatedTarget as HTMLElement | null)?.closest("[data-tree-id]"))}
      onUnhandledKeyDown={(e) => {
        if (e.key === "Escape") {
          e.preventDefault();
          cancelled.current = true;
          e.currentTarget.blur();
        } else if (e.key === "Enter" && !e.shiftKey) {
          e.preventDefault();
          e.currentTarget.blur();
        }
      }} />
  </div>;
}

export const InlineText = memo(function InlineText({
  card,
  field,
  placeholder,
  mono,
  autoEdit,
  locked,
  editOnDoubleClick,
  openFlow,
}: {
  card: Card;
  field: InlineField;
  placeholder: string;
  mono?: boolean;
  autoEdit?: boolean;
  locked?: boolean;
  editOnDoubleClick?: boolean;
  openFlow?: boolean;
}) {
  const [conditionEditing, setConditionEditing] = useState(false);
  const value = card[field] ?? "";
  const requested = useStore((s) => (autoEdit && s.editRequest?.card === card.id ? s.editRequest.nonce : 0));
  useEffect(() => {
    if (!requested) return;
    useStore.setState({ editRequest: null });
    if (field === "condition") setConditionEditing(true);
  }, [requested, field]);

  const save = (next: string, spans: TextSpan[]) => {
    useStore.getState().editCanvas((canvas) => {
      const target = canvas.cards.find((item) => item.id === card.id);
      if (!target) return;
      target[field] = next;
      target.formatting = withTextSpans(target.formatting, field, spans);
      if (field === "text" && target.type === "flow" && target.flow) {
        target.flow.title = next;
        target.flow.formatting = withTextSpans(target.flow.formatting, "title", spans);
      }
    });
  };
  const format = (next: string, spans: TextSpan[]) => editAtomic((project) => {
    const { activeCanvas, flowPath } = useStore.getState();
    const canvas = activeCanvas ? canvasAtPath(project.canvases[activeCanvas], flowPath) : undefined;
    const target = canvas?.cards.find((item) => item.id === card.id);
    if (!target) return;
    target[field] = next;
    target.formatting = withTextSpans(target.formatting, field, spans);
    if (field === "text" && target.type === "flow" && target.flow) {
      target.flow.title = next;
      target.flow.formatting = withTextSpans(target.flow.formatting, "title", spans);
    }
  });

  if (field === "condition") {
    if (conditionEditing) return <InlineCondition card={card} placeholder={placeholder} onClose={() => setConditionEditing(false)} />;
    return <div
      className="card-text mono"
      onClick={(e) => { if (!locked && !e.shiftKey && !e.metaKey && !e.ctrlKey) setConditionEditing(true); }}
      onDragOver={(e) => {
        const p = useStore.getState().project; if (!p || !draggedItems(e.dataTransfer, p)) return;
        e.preventDefault(); e.stopPropagation(); e.dataTransfer.dropEffect = variableDrop(e.dataTransfer, p) ? "copy" : "none";
      }}
      onDrop={(e) => {
        const p = useStore.getState().project; if (!p || !draggedItems(e.dataTransfer, p)) return;
        e.preventDefault(); e.stopPropagation(); const name = variableDrop(e.dataTransfer, p); if (!name) return;
        useStore.getState().editCanvas((c) => { const target = c.cards.find((item) => item.id === card.id); if (target) target.condition = value + name; });
      }}
    >{value || placeholder}</div>;
  }

  return <RichTextEditor
    text={value}
    spans={card.formatting?.[field]}
    onSave={save}
    onFormat={format}
    project={mono ? undefined : useStore.getState().project ?? undefined}
    localNames={card.inputs?.map((input) => input.name)}
    className={`card-text ${FIELD_CLASS[field]} ${mono ? "mono" : ""}`}
    placeholder={placeholder}
    mode={editOnDoubleClick ? "doubleClick" : "click"}
    locked={locked}
    startRequest={requested}
    cellClick
    openFlow={openFlow}
    rich={!mono}
  />;
});
