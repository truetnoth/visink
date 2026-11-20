// узел заметки на холсте — свободный текст
import { memo, useState } from "react";
import type { Node, NodeProps } from "@xyflow/react";
import { NodeResizer } from "@xyflow/react";
import { useStore } from "../store";
import type { NoteData } from "./constants";

export const NoteNode = memo(function NoteNode({ data, selected }: NodeProps<Node<NoteData>>) {
  const [text, setText] = useState(data.text);
  const [previous, setPrevious] = useState(data.text);
  const [hovered, setHovered] = useState(false);
  const [resizing, setResizing] = useState(false);
  if (previous !== data.text) { setPrevious(data.text); setText(data.text); }
  const editCanvas = useStore((s) => s.editCanvas);
  return (
    <div className={`note ${selected ? "selected" : ""}`} onMouseEnter={() => setHovered(true)} onMouseLeave={() => setHovered(false)}>
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
      <div className="note-grip">заметка</div>
      <textarea
        className="nodrag nowheel"
        value={text}
        onChange={(e) => setText(e.target.value)}
        onBlur={(e) => {
          const text = e.currentTarget.value;
          if (text !== data.text) {
            editCanvas((c) => {
              const n = c.notes.find((x) => x.id === data.id);
              if (n) n.text = text;
            });
          }
        }}
        onKeyDown={(e) => e.stopPropagation()}
      />
    </div>
  );
});
