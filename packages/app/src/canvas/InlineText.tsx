import { draggedItems, variableDrop } from "../treeDrag";
// редактирование текста на карточке прямо на месте (без отдельного поля ввода)
import { memo, useEffect, useLayoutEffect, useRef, useState } from "react";
import type { Card } from "@visink/core";
import { useStore } from "../store";
import { CodeInput } from "../ui";

const FIELD_CLASS = { text: "", menuText: "menu-text", stageDirection: "stage-dir", condition: "mono", description: "" } as const;

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
    <CodeInput value={draft} onChange={setDraft} project={project} multiline rows={1} inputRef={input}
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

/**
 * Текст на карточке: правится прямо на месте по одному щелчку (тот же элемент становится редактируемым),
 * поэтому шрифт, переносы и размер карточки не скачут. Enter — сохранить, Shift+Enter — перенос, Esc — отмена.
 * Когда выделено несколько карточек, щелчок по тексту только выделяет — так группу можно тащить за тело.
 */
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
  field: "text" | "menuText" | "stageDirection" | "condition" | "description";
  placeholder: string;
  mono?: boolean;
  /** это поле открывается на ввод, когда карточку только что создали */
  autoEdit?: boolean;
  locked?: boolean;
  editOnDoubleClick?: boolean;
  openFlow?: boolean;
}) {
  const [editing, setEditing] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  const clickAt = useRef<{ x: number; y: number } | null>(null);
  const cancelled = useRef(false);
  const editCanvas = useStore((s) => s.editCanvas);
  const value = card[field] ?? "";
  const requested = useStore((s) => (autoEdit && s.editRequest?.card === card.id ? s.editRequest.nonce : 0));

  useEffect(() => {
    if (!requested) return;
    useStore.setState({ editRequest: null });
    clickAt.current = null;
    setEditing(true);
  }, [requested]);

  // The entire visual cell is editable, including its padding and unused height.
  useEffect(() => {
    const cell = ref.current?.parentElement;
    if (!cell?.classList.contains("card-cell")) return;
    const click = (e: MouseEvent) => {
      if (locked || e.shiftKey || e.metaKey || e.ctrlKey || e.target !== cell) return;
      clickAt.current = { x: e.clientX, y: e.clientY };
      if (editing) ref.current?.focus(); else setEditing(true);
    };
    cell.addEventListener("click", click);
    return () => cell.removeEventListener("click", click);
  }, [editing, locked]);

  useLayoutEffect(() => {
    const el = ref.current;
    if (!editing || !el) return;
    el.textContent = value;
    el.focus();
    // курсор — туда, куда щёлкнули, иначе в конец
    const sel = window.getSelection();
    const at = clickAt.current;
    const range = at && document.caretRangeFromPoint ? document.caretRangeFromPoint(at.x, at.y) : null;
    if (sel) {
      sel.removeAllRanges();
      if (range && el.contains(range.startContainer)) sel.addRange(range);
      else {
        const end = document.createRange();
        end.selectNodeContents(el);
        end.collapse(false);
        sel.addRange(end);
      }
    }
  }, [editing]); // eslint-disable-line react-hooks/exhaustive-deps

  const commit = () => {
    const text = (ref.current?.innerText ?? "").replace(/\n+$/, "");
    setEditing(false);
    if (cancelled.current) {
      cancelled.current = false;
      return;
    }
    if (text !== value) {
      editCanvas((c) => {
        const target = c.cards.find((x) => x.id === card.id);
        if (target) {
          target[field] = text;
          if (field === "text" && target.type === "flow" && target.flow) target.flow.title = text;
        }
      });
    }
  };

  const cls = `card-text ${FIELD_CLASS[field]} ${mono ? "mono" : ""}`;
  if (editing) {
    if (field === "condition") return <InlineCondition card={card} placeholder={placeholder} onClose={() => setEditing(false)} />;
    return (
      <div
        key="edit"
        ref={ref}
        className={`${cls} editing nodrag nowheel`}
        contentEditable="plaintext-only"
        suppressContentEditableWarning
        spellCheck={!mono}
        autoCapitalize={mono ? "off" : undefined}
        autoCorrect={mono ? "off" : undefined}
        data-placeholder={placeholder}
        onBlur={commit}
        onDoubleClick={(e) => { if (!openFlow) e.stopPropagation(); }}
        onKeyDown={(e) => {
          e.stopPropagation();
          if (e.key === "Escape") {
            cancelled.current = true;
            e.currentTarget.blur();
          } else if (e.key === "Enter" && !e.shiftKey) {
            e.preventDefault();
            e.currentTarget.blur();
          }
        }}
      />
    );
  }
  return (
    <div
      onDragOver={(e) => {
        const p = useStore.getState().project; if (field !== "condition" || !p || !draggedItems(e.dataTransfer, p)) return;
        e.preventDefault(); e.stopPropagation(); e.dataTransfer.dropEffect = variableDrop(e.dataTransfer, p) ? "copy" : "none";
      }}
      onDrop={(e) => {
        const p = useStore.getState().project; if (field !== "condition" || !p || !draggedItems(e.dataTransfer, p)) return;
        e.preventDefault(); e.stopPropagation(); const name = variableDrop(e.dataTransfer, p); if (!name) return;
        editCanvas((c) => { const target = c.cards.find((c) => c.id === card.id); if (target) target.condition = value + name; });
      }}
      ref={ref}
      key="view"
      className={`${cls} ${value ? "" : "empty"}`}
      title={value || undefined}
      onClick={(e) => {
        if (locked || editOnDoubleClick || e.shiftKey || e.metaKey || e.ctrlKey) return;
        clickAt.current = { x: e.clientX, y: e.clientY };
        setEditing(true);
      }}
      onDoubleClick={(e) => {
        if (!editOnDoubleClick || locked) return;
        e.stopPropagation();
        clickAt.current = { x: e.clientX, y: e.clientY };
        setEditing(true);
      }}
    >
      {value || placeholder}
    </div>
  );
});
