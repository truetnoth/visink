// редактирование текста на карточке прямо на месте (без отдельного поля ввода)
import { memo, useEffect, useLayoutEffect, useRef, useState } from "react";
import type { Card } from "@visink/core";
import { useStore } from "../store";

const FIELD_CLASS = { text: "", menuText: "menu-text", stageDirection: "stage-dir", condition: "mono" } as const;

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
}: {
  card: Card;
  field: "text" | "menuText" | "stageDirection" | "condition";
  placeholder: string;
  mono?: boolean;
  /** это поле открывается на ввод, когда карточку только что создали */
  autoEdit?: boolean;
  locked?: boolean;
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
        if (target) target[field] = text;
      });
    }
  };

  const cls = `card-text ${FIELD_CLASS[field]} ${mono ? "mono" : ""}`;
  if (editing) {
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
      key="view"
      className={`${cls} ${value ? "" : "empty"}`}
      title={value || undefined}
      onClick={(e) => {
        if (locked || e.shiftKey || e.metaKey || e.ctrlKey) return;
        clickAt.current = { x: e.clientX, y: e.clientY };
        setEditing(true);
      }}
    >
      {value || placeholder}
    </div>
  );
});
