// узел заметки на холсте — свободный текст
import { memo, useState } from "react";
import type { Node, NodeProps } from "@xyflow/react";
import { NodeResizer } from "@xyflow/react";
import { canvasAtPath, withTextSpans, type TextSpan } from "@visink/core";
import { editAtomic, useStore } from "../store";
import { RichTextEditor } from "../richText";
import type { NoteData } from "./constants";

export const NoteNode = memo(function NoteNode({ data, selected }: NodeProps<Node<NoteData>>) {
  const [hovered, setHovered] = useState(false);
  const [resizing, setResizing] = useState(false);
  const editCanvas = useStore((s) => s.editCanvas);
  const save = (text: string, spans: TextSpan[]) => editCanvas((canvas) => {
    const note = canvas.notes.find((item) => item.id === data.id);
    if (note) {
      note.text = text;
      note.formatting = withTextSpans(note.formatting, "text", spans);
    }
  });
  const format = (text: string, spans: TextSpan[]) => editAtomic((project) => {
    const { activeCanvas, flowPath } = useStore.getState();
    const canvas = activeCanvas ? canvasAtPath(project.canvases[activeCanvas], flowPath) : undefined;
    const note = canvas?.notes.find((item) => item.id === data.id);
    if (note) {
      note.text = text;
      note.formatting = withTextSpans(note.formatting, "text", spans);
    }
  });
  return (
    <div className={`note ${selected ? "selected" : ""}`} style={{ ["--note-color" as string]: data.color }} onMouseEnter={() => setHovered(true)} onMouseLeave={() => setHovered(false)}>
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
      <RichTextEditor text={data.text} spans={data.formatting} onSave={save} onFormat={format} className="note-text" mode="doubleClick" multiline />
    </div>
  );
});
