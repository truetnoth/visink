// узел заметки на холсте — свободный текст
import { memo, useRef, useState } from "react";
import type { Node, NodeProps } from "@xyflow/react";
import { NodeResizer } from "@xyflow/react";
import { useStore } from "../store";
import type { NoteData } from "./constants";

export const NoteNode = memo(function NoteNode({ data, selected }: NodeProps<Node<NoteData>>) {
  const [text, setText] = useState(data.text);
  const [previous, setPrevious] = useState(data.text);
  const [editing, setEditing] = useState(false);
  const [hovered, setHovered] = useState(false);
  const [resizing, setResizing] = useState(false);
  const cancelled = useRef(false);
  if (previous !== data.text) { setPrevious(data.text); setText(data.text); }
  const editCanvas = useStore((s) => s.editCanvas);
  return (
    <div className={`note ${selected ? "selected" : ""} ${editing ? "editing" : ""}`} style={{ ["--note-color" as string]: data.color }} onMouseEnter={() => setHovered(true)} onMouseLeave={() => setHovered(false)} onDoubleClick={(e) => {
      if (editing) return;
      e.stopPropagation();
      cancelled.current = false;
      setEditing(true);
    }}>
      <NodeResizer
        isVisible={selected || hovered || resizing}
        minWidth={120}
        minHeight={100}
        lineClassName="card-resize-line"
        handleClassName="card-resize-handle"
        onResizeStart={() => setResizing(true)}
        onResizeEnd={(_, size) => {
          setResizing(false);
          editCanvas((canvas) => {
            const note = canvas.notes.find((item) => item.id === data.id);
            if (note) Object.assign(note, { x: Math.round(size.x), y: Math.round(size.y), w: Math.round(size.width), h: Math.round(size.height) });
          });
        }}
      />
      {editing ? <textarea
        autoFocus
        aria-label="Текст заметки"
        className="nodrag nowheel"
        value={text}
        onChange={(e) => setText(e.target.value)}
        onBlur={(e) => {
          const next = e.currentTarget.value;
          if (!cancelled.current && next !== data.text) {
            editCanvas((c) => {
              const n = c.notes.find((x) => x.id === data.id);
              if (n) n.text = next;
            });
          }
          cancelled.current = false;
          setEditing(false);
        }}
        onKeyDown={(e) => {
          e.stopPropagation();
          if (e.key === "Escape") {
            e.preventDefault();
            cancelled.current = true;
            setText(data.text);
            e.currentTarget.blur();
          }
        }}
        onDoubleClick={(e) => e.stopPropagation()}
      /> : <div className="note-text" tabIndex={0} title="Двойной щелчок или Enter — редактировать" onKeyDown={(e) => {
        if (e.key !== "Enter") return;
        e.preventDefault();
        e.stopPropagation();
        cancelled.current = false;
        setEditing(true);
      }}>{text}</div>}
    </div>
  );
});
