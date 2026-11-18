// узел заметки на холсте — свободный текст, не попадает в ink
import { memo, useState } from "react";
import type { Node, NodeProps } from "@xyflow/react";
import { useStore } from "../store";
import type { NoteData } from "./constants";

export const NoteNode = memo(function NoteNode({ data, selected }: NodeProps<Node<NoteData>>) {
  const [text, setText] = useState(data.text);
  const [previous, setPrevious] = useState(data.text);
  if (previous !== data.text) { setPrevious(data.text); setText(data.text); }
  const editCanvas = useStore((s) => s.editCanvas);
  return (
    <div className={`note ${selected ? "selected" : ""}`}>
      <div className="note-grip">заметка · не попадает в ink</div>
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
