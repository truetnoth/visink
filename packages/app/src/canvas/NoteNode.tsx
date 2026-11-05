// узел заметки на холсте — свободный текст, не попадает в ink
import { memo } from "react";
import type { Node, NodeProps } from "@xyflow/react";
import { useStore } from "../store";
import type { NoteData } from "./constants";

export const NoteNode = memo(function NoteNode({ data, selected }: NodeProps<Node<NoteData>>) {
  const editCanvas = useStore((s) => s.editCanvas);
  return (
    <div className={`note ${selected ? "selected" : ""}`}>
      <div className="note-grip">заметка · не попадает в ink</div>
      <textarea
        className="nodrag nowheel"
        defaultValue={data.text}
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
