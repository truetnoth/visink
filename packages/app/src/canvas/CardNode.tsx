// узел карточки на холсте: шапка, тело, пины условия/действия
import { memo, useEffect, useLayoutEffect, useRef, useState } from "react";
import type { Node, NodeProps } from "@xyflow/react";
import { Handle, NodeResizer, Position, useUpdateNodeInternals } from "@xyflow/react";
import { Flag, Layers, Repeat, StickyNote, User } from "lucide-react";
import type { Entity } from "@visink/core";
import { actionLines } from "@visink/compiler";
import { useStore } from "../store";
import { CARD_W } from "../ops";
import { usePortrait } from "../portraits";
import { usePrefs } from "../prefs";
import { CLICK_MS, COMPACT_W, isCompact, TYPE_COLOR, TYPE_ICON, TYPE_LABEL } from "./constants";
import type { CardData, PinPoint } from "./constants";
import { InlineText } from "./InlineText";

/** Аватарка спикера: портрет, если есть, иначе квадрат его цвета. */
export function Avatar({ speaker }: { speaker?: Entity }) {
  const url = usePortrait(speaker?.portrait);
  return (
    <div className="card-avatar" title={speaker?.name}>
      {url ? <img src={url} alt="" draggable={false} /> : <span>{speaker?.name?.[0] ?? "?"}</span>}
    </div>
  );
}

export const CardNode = memo(function CardNode({ id, data, selected, width, height }: NodeProps<Node<CardData>>) {
  const { card, speaker, player, isStart, fixedHeight, problem, problemText, problemCount } = data;
  const editCanvas = useStore((s) => s.editCanvas);
  const updateNodeInternals = useUpdateNodeInternals();
  const [hovered, setHovered] = useState(false);
  const [resizing, setResizing] = useState(false);
  const pinTimer = useRef<number | undefined>(undefined);
  const multi = useStore((s) => selected && s.selection.length > 1);
  const color = card.type === "line" ? speaker?.color ?? "var(--service)" : TYPE_COLOR[card.type];
  const Icon = player ? User : TYPE_ICON[card.type];
  const action = actionLines(card.action);
  const gate = card.type !== "condition" ? card.condition?.trim() : "";
  const outPin = card.type === "line" || card.type === "hub" || card.type === "flow" || card.type === "ink";
  const compact = isCompact(card.type);
  const headLabel = card.type === "line" ? speaker?.name ?? "без спикера" : card.type === "hub" && card.text ? `Хаб · ${card.text}` : card.type === "jump" ? `→ ${card.target || "цель?"}` : TYPE_LABEL[card.type];
  const fontSize = usePrefs((s) => s.cardFontSize);
  const content = card.text || card.condition || "";
  const chars = Math.max(12, ((width ?? CARD_W) - 24) / (fontSize * 0.54));
  const textLines = content.split("\n").reduce((n, line) => n + Math.max(1, Math.ceil(line.length / chars)), 0);
  const minHeight = (card.type === "line" ? 120 : 60) + (content.trim() ? Math.max(20, textLines * fontSize * 1.4) : 0);

  useLayoutEffect(() => updateNodeInternals(id), [id, width, height, fixedHeight, card.type, player, card.flow, updateNodeInternals]);
  useEffect(() => () => clearTimeout(pinTimer.current), []);

  const clearPinTimer = () => clearTimeout(pinTimer.current);
  const openLogic = (field: "condition" | "action", point: PinPoint) => {
    clearPinTimer();
    data.onPin(card.id, field, point);
  };
  const branch = (port: "yes" | "no" | undefined, point: PinPoint, delay: number) => {
    clearPinTimer();
    pinTimer.current = window.setTimeout(() => data.onBranch(card.id, port, point), delay);
  };
  // РЕШЕНИЕ ПОЛЬЗОВАТЕЛЯ: меню 1–4 открывается только по щелчку, наведение на пин ничего не открывает.
  const outPinHandlers = (port?: "yes" | "no") => ({
    onPointerDown: clearPinTimer,
    onClick: (e: React.MouseEvent) => branch(port, { x: e.clientX, y: e.clientY }, CLICK_MS),
    onDoubleClick: (e: React.MouseEvent) => openLogic("action", { x: e.clientX, y: e.clientY }),
  });

  return (
    <div className={`card card-${card.type} ${player ? "player" : ""} ${selected ? "selected" : ""} ${fixedHeight ? "fixed-h" : ""}`} style={{ ["--speaker" as string]: color }} onMouseEnter={() => setHovered(true)} onMouseLeave={() => setHovered(false)}>
      {!compact && <NodeResizer
        isVisible={selected || hovered || resizing}
        minWidth={card.type === "line" ? 200 : 160}
        minHeight={minHeight}
        lineClassName="card-resize-line"
        handleClassName="card-resize-handle"
        onResizeStart={() => setResizing(true)}
        onResizeEnd={(_, p) => {
          setResizing(false);
          editCanvas((c) => { c.layout[card.id] = { x: Math.round(p.x), y: Math.round(p.y), w: Math.round(p.width), h: Math.round(Math.max(minHeight, p.height)) }; });
        }}
      />}
      <Handle type="target" position={Position.Left} style={{ top: "50%" }} className={`pin pin-in ${gate ? "has-logic cond" : ""}`} title={gate ? `Условие: ${gate}` : "Вход. Щелчок — условие"} onClick={card.type !== "condition" ? (e) => openLogic("condition", { x: e.clientX, y: e.clientY }) : undefined} />
      {problem && <span className={`problem-badge ${problem}`} title={problemText}>!{problemCount && problemCount > 1 ? problemCount : ""}</span>}
      <div className="card-head" title={`id: ${card.id} · двойной щелчок — настройки`} onDoubleClick={(e) => {
        e.stopPropagation();
        useStore.getState().openCardSettings(card.id);
      }}>
        {isStart && <span className="chip" title="Начало файла"><Flag size={11} /></span>}
        <span className="card-type">{headLabel}</span>
        {card.flow && card.type !== "flow" && <span className="chip nested-chip" title="Двойной щелчок по телу — открыть вложенный поток"><Layers size={11} /></span>}
        {card.entry && <span className="chip mono" title={`Точка входа: ${card.entry}`}>▶ {card.entry}</span>}
        {player && card.repeat === "sticky" && <span className="chip" title="Повторяемый вариант (+)"><Repeat size={11} /></span>}
        {player && card.repeat === "fallback" && <span className="chip" title="Запасной вариант">запасной</span>}
        {card.status && card.status !== "draft" && <span className={`status-dot ${card.status}`} title={card.status === "final" ? "Финал" : "На вычитке"} />}
        {card.note && <span className="chip" title={card.note}><StickyNote size={11} /></span>}
        {card.type === "jump" && action.length > 0 && <span className="chip mono" title={action.join("\n")}>~</span>}
        <Icon size={14} className="card-icon" />
      </div>
      {compact ? null : card.type === "line" ? <div className={`card-body line-body ${multi ? "" : "nodrag"}`}>
        <div className="card-top"><Avatar speaker={speaker} /><div className={`card-cell ${player ? "" : "unused"}`} title={player ? undefined : "У реплик NPC текст на кнопке не используется"}><InlineText card={card} field="menuText" locked={multi} autoEdit={player} placeholder={player ? (card.text ? "в выборе будет реплика" : "текст на кнопке…") : "не используется"} /></div></div>
        <div className="card-cell"><InlineText card={card} field="stageDirection" locked={multi} placeholder="ремарка…" /></div>
        <div className={`card-cell grow ${card.text ? "has-text" : ""}`}><InlineText card={card} field="text" locked={multi} autoEdit={!player} placeholder={player ? "(реплика не звучит)" : "текст реплики…"} /></div>
      </div> : <div className={`card-body ${multi ? "" : "nodrag"}`}>
        {card.type === "condition" && <InlineText card={card} field="condition" locked={multi} autoEdit placeholder="условие?" />}
        {card.type === "flow" && <InlineText card={card} field="text" locked={multi} autoEdit placeholder="название вложенности…" />}
        {card.type === "ink" && <InlineText card={card} field="text" mono locked={multi} autoEdit placeholder="чистый ink" />}
        {!outPin && action.map((l, i) => <div key={i} className="card-action mono">{l}</div>)}
      </div>}
      {card.type === "condition" ? <>
        <Handle type="source" id="yes" position={Position.Right} style={{ top: "40%" }} className="pin pin-out pin-yes" title="Выход «да»: щелчок — 1–4 карточки, двойной щелчок — действие до проверки" {...outPinHandlers("yes")} />
        <Handle type="source" id="no" position={Position.Right} style={{ top: "75%" }} className="pin pin-out pin-no" title="Выход «нет»: щелчок — 1–4 карточки, двойной щелчок — действие до проверки" {...outPinHandlers("no")} />
        <span className="port-label" style={{ top: "calc(40% - 20px)" }}>да</span><span className="port-label" style={{ top: "calc(75% - 20px)" }}>нет</span>
      </> : outPin ? <Handle type="source" position={Position.Right} style={{ top: "50%" }} className={`pin pin-out ${action.length ? "has-logic act" : ""}`} title="Выход: тяните стрелку; щелчок — 1–4 карточки, двойной щелчок — действие" {...outPinHandlers()} /> : null}
    </div>
  );
});
