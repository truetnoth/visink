import { memo, useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import type { Connection, Edge, EdgeProps, Node, NodeProps, OnConnectEnd, OnConnectStart, OnSelectionChangeParams } from "@xyflow/react";
import {
  BaseEdge,
  Background,
  BackgroundVariant,
  EdgeLabelRenderer,
  Handle,
  MarkerType,
  NodeResizer,
  Panel,
  Position,
  ReactFlow,
  ReactFlowProvider,
  SelectionMode,
  getBezierPath,
  useEdgesState,
  useNodesState,
  useReactFlow,
  useUpdateNodeInternals,
} from "@xyflow/react";
import type { LucideIcon } from "lucide-react";
import { ArrowRightFromLine, ChevronRight, Code, Flag, GitBranch, Layers, LayoutGrid, Magnet, Maximize, MessageSquare, Repeat, StickyNote, Trash2, User } from "lucide-react";
import type { Card, CardType, Entity, Project } from "@visink/core";
import { canvasAtPath, flowCards, isPlayerCard, linkId } from "@visink/core";
import { actionLines, rootCard } from "@visink/compiler";
import { useStore } from "./store";
import {
  CARD_W,
  addBranchCards,
  addCard,
  addNextLine,
  addNote,
  addPlayerOption,
  alignToGrid,
  connect,
  copyFragment,
  defaultNpc,
  deleteCards,
  deleteLinks,
  nextSpeaker,
  parseFragment,
  pasteFragment,
  reorderLinks,
  snapPoint,
} from "./ops";
import { GRID, usePrefs } from "./prefs";
import { usePortrait } from "./portraits";
import { useTheme } from "./theme";
import { CodeInput, IconButton } from "./ui";

type PinPoint = { x: number; y: number };
type CardData = { card: Card; speaker?: Entity; player: boolean; isStart: boolean; fixedHeight: boolean; problem?: "error" | "warning"; problemText?: string; problemCount?: number; onPin: (id: string, field: "condition" | "action", point: PinPoint) => void; onBranch: (id: string, port: "yes" | "no" | undefined, point: PinPoint) => void };
type NoteData = { id: string; text: string };
type EdgeData = { condition?: string; action?: string; error?: boolean; draft?: boolean };
type DraftLink = { id: string; from: string; port?: "yes" | "no"; x: number; y: number };

export const TYPE_LABEL: Record<CardType, string> = {
  line: "Реплика",
  hub: "Хаб",
  condition: "Условие",
  jump: "Переход",
  flow: "Вложенность",
  ink: "ink",
};

export const TYPE_ICON: Record<CardType, LucideIcon> = {
  line: MessageSquare,
  hub: Repeat,
  condition: GitBranch,
  jump: ArrowRightFromLine,
  flow: Layers,
  ink: Code,
};

/** Цвет шапки служебных карточек; у реплик — цвет спикера. */
const TYPE_COLOR: Record<CardType, string> = {
  line: "var(--service)",
  hub: "var(--service)",
  condition: "#c98a1c",
  jump: "#2a8d96",
  flow: "#7464a8",
  ink: "#56707a",
};
const COMPACT_W: Partial<Record<CardType, number>> = { hub: 180, jump: 220 };
/** Компактные карточки (хаб, переход): без тела и без запроса на ввод при создании. */
const isCompact = (type?: string) => type === "hub" || type === "jump";
/** Порог «щелчок, а не протяжка» для выходного пина. */
const CLICK_MS = 240;

export function isTyping() {
  const el = document.activeElement as HTMLElement | null;
  return !!el && (el.tagName === "INPUT" || el.tagName === "TEXTAREA" || el.tagName === "SELECT" || el.isContentEditable);
}

const FIELD_CLASS = { text: "", menuText: "menu-text", stageDirection: "stage-dir", condition: "mono" } as const;

/**
 * Текст на карточке: правится прямо на месте по одному щелчку (тот же элемент становится редактируемым),
 * поэтому шрифт, переносы и размер карточки не скачут. Enter — сохранить, Shift+Enter — перенос, Esc — отмена.
 * Когда выделено несколько карточек, щелчок по тексту только выделяет — так группу можно тащить за тело.
 */
const InlineText = memo(function InlineText({
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

/** Аватарка спикера: портрет, если есть, иначе квадрат его цвета. */
function Avatar({ speaker }: { speaker?: Entity }) {
  const url = usePortrait(speaker?.portrait);
  return (
    <div className="card-avatar" title={speaker?.name}>
      {url ? <img src={url} alt="" draggable={false} /> : <span>{speaker?.name?.[0] ?? "?"}</span>}
    </div>
  );
}

const CardNode = memo(function CardNode({ id, data, selected, width, height }: NodeProps<Node<CardData>>) {
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

const NoteNode = memo(function NoteNode({ data, selected }: NodeProps<Node<NoteData>>) {
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

function roundedRoute(points: { x: number; y: number }[], radius = 16) {
  if (points.length < 2) return "";
  let path = `M ${points[0].x} ${points[0].y}`;
  for (let i = 1; i < points.length - 1; i++) {
    const prev = points[i - 1], at = points[i], next = points[i + 1];
    const before = Math.min(radius, Math.hypot(at.x - prev.x, at.y - prev.y) / 2);
    const after = Math.min(radius, Math.hypot(next.x - at.x, next.y - at.y) / 2);
    const a = { x: at.x + Math.sign(prev.x - at.x) * before, y: at.y + Math.sign(prev.y - at.y) * before };
    const b = { x: at.x + Math.sign(next.x - at.x) * after, y: at.y + Math.sign(next.y - at.y) * after };
    path += ` L ${a.x} ${a.y} Q ${at.x} ${at.y} ${b.x} ${b.y}`;
  }
  const end = points.at(-1)!;
  return path + ` L ${end.x} ${end.y}`;
}

/** Прямые связи остаются плавными; обратные и петли проходят большой дугой над карточками. */
const LogicEdge = memo(function LogicEdge(props: EdgeProps<Edge<EdgeData>>) {
  const { id, data, selected, markerEnd, style, source, target, sourceX, sourceY, targetX, targetY } = props;
  const { setNodes, setEdges, getNode } = useReactFlow();
  const select = (additive = false) => {
    if (data?.draft) return;
    if (!additive) setNodes((ns) => ns.map((n) => (n.selected ? { ...n, selected: false } : n)));
    setEdges((es) => es.map((e) => {
      const next = e.id === id ? (additive ? !e.selected : true) : additive ? !!e.selected : false;
      return !!e.selected !== next ? { ...e, selected: next } : e;
    }));
  };
  let [path, x, y] = getBezierPath(props);
  if (source === target || sourceX > targetX + 20) {
    const s = getNode(source), t = getNode(target);
    const top = Math.min(s?.position.y ?? sourceY, t?.position.y ?? targetY) - 90;
    const right = sourceX + 60, left = targetX - 60;
    path = roundedRoute([{ x: sourceX, y: sourceY }, { x: right, y: sourceY }, { x: right, y: top }, { x: left, y: top }, { x: left, y: targetY }, { x: targetX, y: targetY }]);
    x = (right + left) / 2;
    y = top;
  }
  const cond = data?.condition?.trim();
  const action = actionLines(data?.action);
  return <>
    <BaseEdge id={id} path={path} markerEnd={markerEnd} style={{ ...style, strokeWidth: selected ? 3 : 2.25, strokeOpacity: 1 }} interactionWidth={28} />
    {(cond || action.length > 0) && <EdgeLabelRenderer><div className={`edge-logic nodrag nopan ${selected ? "selected" : ""} ${data?.error ? "error" : ""}`} style={{ transform: `translate(-50%, -50%) translate(${x}px, ${y}px)` }} onClick={(e) => select(e.shiftKey || e.metaKey || e.ctrlKey)} onDoubleClick={() => { select(); useStore.getState().openEditor(); setTimeout(() => (document.querySelector(".link-props input, .link-props textarea") as HTMLElement | null)?.focus(), 50); }}>
      {cond && <div className="edge-cond mono">{`{${cond}}`}</div>}{action.map((l, i) => <div key={i} className="edge-action mono">{l}</div>)}
    </div></EdgeLabelRenderer>}
  </>;
});

function DraftNode() {
  return <div className="draft-target"><Handle type="target" position={Position.Left} className="draft-handle" /></div>;
}

const nodeTypes = { card: CardNode, note: NoteNode, draft: DraftNode };
const edgeTypes = { logic: LogicEdge };

type MenuItem = { label: string; color?: string; icon: LucideIcon; type?: CardType | "note"; init?: Partial<Card>; run?: () => void; children?: MenuItem[] };
type MenuState = { x: number; y: number; at: { x: number; y: number }; from?: string; port?: "yes" | "no"; count?: number };
type PinEditorState = { id: string; field: "condition" | "action"; x: number; y: number };

function CreateMenu({ menu, items, onPick, onClose }: { menu: MenuState; items: MenuItem[]; onPick: (item: MenuItem) => void; onClose: () => void }) {
  const [active, setActive] = useState(0);
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => ref.current?.focus(), []);
  return <div ref={ref} className="create-menu" style={{ left: Math.max(8, menu.x), top: Math.max(8, menu.y) }} tabIndex={-1} onBlur={(e) => { if (!e.currentTarget.contains(e.relatedTarget as globalThis.Node | null)) onClose(); }} onKeyDown={(e) => {
    e.stopPropagation();
    if (e.key === "Escape") onClose();
    else if (e.key === "ArrowDown") setActive((i) => (i + 1) % items.length);
    else if (e.key === "ArrowUp") setActive((i) => (i - 1 + items.length) % items.length);
    else if (e.key === "Enter" && !items[active].children) onPick(items[active]);
    else if (/^[1-9]$/.test(e.key) && items[Number(e.key) - 1] && !items[Number(e.key) - 1].children) onPick(items[Number(e.key) - 1]);
    else return;
    e.preventDefault();
  }} onContextMenu={(e) => e.preventDefault()}>
    {items.map((item, i) => <div className="menu-item-wrap" key={item.label}>
      <button className={i === active ? "on" : ""} onMouseEnter={() => setActive(i)} onMouseDown={(e) => e.preventDefault()} onClick={() => !item.children && onPick(item)}>
        <item.icon size={15} style={{ color: item.color ?? "var(--service)" }} />{item.label}{item.children ? <ChevronRight size={14} className="submenu-arrow" /> : i < 9 && <span className="kbd mono muted">{i + 1}</span>}
      </button>
      {item.children && i === active && <div className="create-submenu">{item.children.map((child) => <button key={child.label} onMouseDown={(e) => e.preventDefault()} onClick={() => onPick(child)}><child.icon size={15} style={{ color: child.color ?? "var(--service)" }} />{child.label}</button>)}</div>}
    </div>)}
  </div>;
}

function PinEditor({ card, field, project, onCommit, onClose }: { card: Card; field: "condition" | "action"; project: Project; onCommit: (value: string) => void; onClose: () => void }) {
  const [value, setValue] = useState(card[field] ?? "");
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => { ref.current?.querySelector<HTMLElement>("input, textarea")?.focus(); }, []);
  const title = field === "condition" ? "Условие на входе" : card.type === "condition" ? "Действие до проверки условия" : "Действие на выходе";
  return <div ref={ref} className="pin-editor" onKeyDown={(e) => {
    e.stopPropagation();
    if (e.defaultPrevented) return;
    if (e.key === "Escape") onClose();
    else if (e.key === "Enter" && (field === "condition" || e.ctrlKey || e.metaKey)) {
      e.preventDefault();
      onCommit(value);
    }
  }}>
    <div className="pin-editor-title">{title}</div>
    <CodeInput value={value} onChange={setValue} project={project} multiline={field === "action"} rows={3} placeholder={field === "condition" ? "например: trust > 0" : "по строке, тильда не нужна"} />
    <div className="pin-editor-actions"><button onClick={onClose}>Отмена</button><button className="primary" onClick={() => onCommit(value)}>ОК</button></div>
  </div>;
}

function Flow({ flowKey, viewports }: { flowKey: string; viewports: Map<string, { x: number; y: number; zoom: number }> }) {
  const project = useStore((s) => s.project);
  const key = useStore((s) => s.activeCanvas);
  const flowPath = useStore((s) => s.flowPath);
  const selection = useStore((s) => s.selection);
  const check = useStore((s) => s.check);
  const focus = useStore((s) => s.focus);
  const colorMode = useTheme((s) => s.resolved);
  const snap = usePrefs((s) => s.snap);
  const fontSize = usePrefs((s) => s.cardFontSize);
  const { editCanvas, setSelection, focusCard, requestEdit } = useStore.getState();
  const { screenToFlowPosition, setCenter, fitView, getViewport } = useReactFlow();
  const wrapper = useRef<HTMLDivElement>(null);
  const [pinPicker, setPinPicker] = useState<{ id: string; port?: "yes" | "no"; x: number; y: number } | null>(null);
  const [pinEditor, setPinEditor] = useState<PinEditorState | null>(null);
  const [menu, setMenu] = useState<MenuState | null>(null);

  const root = project && key ? project.canvases[key] : null;
  const canvas = root ? canvasAtPath(root, flowPath) ?? null : null;
  const initialViewport = useRef(viewports.get(flowKey));
  useEffect(() => () => { viewports.set(flowKey, getViewport()); }, [flowKey, getViewport, viewports]);

  const problems = useMemo(() => {
    const map = new Map<string, { severity: "error" | "warning"; text: string[] }>();
    for (const d of check?.diagnostics ?? []) {
      if (d.canvas !== key || !d.card) continue;
      const cur = map.get(d.card) ?? { severity: d.severity, text: [] };
      if (d.severity === "error") cur.severity = "error";
      cur.text.push(d.message);
      map.set(d.card, cur);
    }
    return map;
  }, [check, key]);

  const onPin = useCallback((id: string, field: "condition" | "action", point: PinPoint) => {
    setPinPicker(null);
    setMenu(null);
    setPinEditor({ id, field, ...point });
  }, []);
  const onBranch = useCallback((id: string, port: "yes" | "no" | undefined, point: PinPoint) => {
    setPinEditor(null);
    setMenu(null);
    setPinPicker({ id, ...(port ? { port } : {}), ...point });
  }, []);
  useEffect(() => {
    if (!pinPicker && !pinEditor) return;
    const down = (e: MouseEvent) => {
      const target = e.target as HTMLElement;
      if (pinPicker && !target.closest(".pin-count-menu, .create-menu")) setPinPicker(null);
      if (pinEditor && !target.closest(".pin-editor-wrap") && !target.closest(".popup")) setPinEditor(null);
    };
    document.addEventListener("mousedown", down, true);
    return () => document.removeEventListener("mousedown", down, true);
  }, [pinPicker, pinEditor]);

  const activeDrafts = useMemo<DraftLink[]>(() => menu?.from ? [{ id: "draft:menu", from: menu.from, ...(menu.port ? { port: menu.port } : {}), x: menu.at.x, y: menu.at.y }] : [], [menu]);

  // Выделением владеет React Flow: узлы пересобираются только при правке проекта,
  // а выделение и размеры переносятся со старых узлов.
  const derivedNodes = useMemo<Node[]>(() => {
    if (!canvas || !project) return [];
    const cards: Node<CardData>[] = canvas.cards.map((card) => {
      const pr = problems.get(card.id);
      const compactWidth = COMPACT_W[card.type];
      return {
        id: card.id,
        type: "card",
        position: { x: canvas.layout[card.id]?.x ?? 0, y: canvas.layout[card.id]?.y ?? 0 },
        width: compactWidth ?? canvas.layout[card.id]?.w ?? CARD_W,
        ...(compactWidth == null && canvas.layout[card.id]?.h != null ? { height: canvas.layout[card.id]!.h } : {}),
        data: {
          card,
          speaker: project.entities.find((e) => e.id === card.speaker),
          player: isPlayerCard(project, card),
          isStart: canvas.start === card.id,
          fixedHeight: compactWidth == null && canvas.layout[card.id]?.h != null,
          problem: pr?.severity,
          problemText: pr?.text.join("\n"),
          problemCount: pr?.text.length,
          onPin,
          onBranch,
        },
      };
    });
    const notes: Node<NoteData>[] = canvas.notes.map((n) => ({ id: n.id, type: "note", position: { x: n.x, y: n.y }, data: { id: n.id, text: n.text } }));
    const placeholders: Node[] = activeDrafts.map((draft) => ({ id: draft.id, type: "draft", position: { x: draft.x, y: draft.y }, selectable: false, deletable: false, data: {} }));
    return [...notes, ...cards, ...placeholders];
  }, [canvas, project, problems, activeDrafts, onPin, onBranch]);

  const [nodes, setNodes, onNodesChange] = useNodesState<Node>(derivedNodes);
  useEffect(() => {
    const sel = new Set(useStore.getState().selection);
    setNodes((prev) => {
      const old = new Map(prev.map((n) => [n.id, n]));
      return derivedNodes.map((n) => {
        const o = old.get(n.id);
        return { ...n, selected: o ? !!o.selected : sel.has(n.id), ...(o?.measured ? { measured: o.measured } : {}) };
      });
    });
  }, [derivedNodes, setNodes]);

  // выделение поменяли снаружи (поиск, новая карточка, «удалить выбранные») — отразить на холсте
  useEffect(() => {
    const sel = new Set(selection);
    setNodes((prev) => (prev.some((n) => !!n.selected !== sel.has(n.id)) ? prev.map((n) => (!!n.selected !== sel.has(n.id) ? { ...n, selected: sel.has(n.id) } : n)) : prev));
  }, [selection, setNodes]);

  const badLinks = useMemo(() => {
    const out = new Set<string>();
    for (const d of check?.diagnostics ?? []) if (d.canvas === key && d.link) out.add(linkId(d.link));
    return out;
  }, [check, key]);

  const derivedEdges = useMemo<Edge<EdgeData>[]>(() => {
    if (!canvas) return [];
    const real = canvas.links.map((l): Edge<EdgeData> => {
      const id = linkId(l);
      const error = badLinks.has(id);
      return { id, type: "logic", source: l.from, target: l.to, sourceHandle: l.port ?? null, markerEnd: { type: MarkerType.ArrowClosed }, className: [l.port ? `edge-${l.port}` : "", error ? "edge-error" : ""].join(" ").trim() || undefined, data: { condition: l.condition, action: l.action, error } };
    });
    const temporary = activeDrafts.map((d): Edge<EdgeData> => ({ id: `draft-edge:${d.id}`, type: "logic", source: d.from, target: d.id, sourceHandle: d.port ?? null, markerEnd: { type: MarkerType.ArrowClosed }, className: "edge-draft", selectable: false, deletable: false, data: { draft: true } }));
    return [...real, ...temporary];
  }, [canvas, badLinks, activeDrafts]);

  const [edges, setEdges, onEdgesChange] = useEdgesState<Edge<EdgeData>>(derivedEdges);
  useEffect(() => {
    const links = new Set(useStore.getState().selectedLinks);
    setEdges((prev) => {
      const old = new Map(prev.map((e) => [e.id, e]));
      return derivedEdges.map((e) => ({ ...e, selected: old.has(e.id) ? !!old.get(e.id)!.selected : links.has(e.id) }));
    });
  }, [derivedEdges, setEdges]);

  // стрелки выделили снаружи (поиск, «где используется», проблемы) — отразить на холсте
  const selectedLinks = useStore((s) => s.selectedLinks);
  useEffect(() => {
    const links = new Set(selectedLinks);
    setEdges((prev) =>
      prev.some((e) => !!e.selected !== links.has(e.id)) ? prev.map((e) => (!!e.selected !== links.has(e.id) ? { ...e, selected: links.has(e.id) } : e)) : prev,
    );
  }, [selectedLinks, setEdges]);

  useEffect(() => {
    if (!focus || focus.canvas !== key) return;
    const t = setTimeout(() => {
      const state = useStore.getState();
      if (state.focus?.nonce !== focus.nonce) return;
      const currentRoot = state.project?.canvases[focus.canvas];
      const at = currentRoot && canvasAtPath(currentRoot, state.flowPath)?.layout[focus.card];
      if (at) setCenter(at.x + (at.w ?? CARD_W) / 2, at.y + 60, { zoom: 1, duration: 300 });
      useStore.setState({ focus: null });
    }, 80);
    return () => clearTimeout(t);
  }, [focus, key, setCenter]);

  const onSelectionChange = useCallback(
    ({ nodes, edges }: OnSelectionChangeParams) => {
      const links = edges.filter((e) => !e.id.startsWith("draft-edge:")).map((e) => e.id).sort();
      const pickedNodes = nodes.filter((n) => n.type !== "draft").map((n) => n.id).sort();
      setSelection(pickedNodes, !pickedNodes.length && links.length === 1 ? links[0] : null, links);
    },
    [setSelection],
  );

  const onConnect = useCallback(
    (c: Connection) => {
      if (c.target.startsWith("draft:")) return;
      editCanvas((canvas) => connect(canvas, c.source, c.target, (c.sourceHandle as "yes" | "no") || undefined));
    },
    [editCanvas],
  );

  const openMenu = useCallback(
    (clientX: number, clientY: number, from?: string, port?: "yes" | "no", count = 1, keepPicker = false) => {
      const rect = wrapper.current?.getBoundingClientRect();
      const at = screenToFlowPosition({ x: clientX, y: clientY - 30 });
      if (!keepPicker) setPinPicker(null);
      setPinEditor(null);
      setMenu({
        x: Math.min(clientX - (rect?.left ?? 0), (rect?.width ?? 1e4) - 230),
        y: Math.min(clientY - (rect?.top ?? 0), (rect?.height ?? 1e4) - 300),
        at: snapPoint(at, usePrefs.getState().snap ? GRID : 1),
        from,
        port,
        count,
      });
    },
    [screenToFlowPosition],
  );
  const closeMenu = useCallback(() => { setMenu(null); setPinPicker(null); }, []);

  // Стрелка в пустоту — меню: что поставить там, где отпустили. Щелчок по пину без протяжки — не стрелка.
  const connectFrom = useRef<{ x: number; y: number } | null>(null);
  const onConnectStart: OnConnectStart = useCallback((event) => {
    const point = "changedTouches" in event ? event.changedTouches[0] : event;
    connectFrom.current = { x: point.clientX, y: point.clientY };
    setPinPicker(null);
    setPinEditor(null);
    setMenu(null);
  }, []);
  const onConnectEnd: OnConnectEnd = useCallback(
    (event, state) => {
      if (state.isValid || !state.fromNode || state.fromHandle?.type !== "source") return;
      const point = "changedTouches" in event ? event.changedTouches[0] : event;
      const from = connectFrom.current;
      if (from && Math.hypot(point.clientX - from.x, point.clientY - from.y) < 6) return;
      openMenu(point.clientX, point.clientY, state.fromNode.id, (state.fromHandle.id as "yes" | "no" | null) ?? undefined);
    },
    [openMenu],
  );

  const menuItems = useMemo<MenuItem[]>(() => {
    if (!menu || !project || !canvas) return [];
    const from = menu.from ? canvas.cards.find((c) => c.id === menu.from) : undefined;
    const player = project.entities.find((e) => e.isPlayer);
    const suggested = from ? nextSpeaker(project, canvas, from) : defaultNpc(project, canvas);
    // первым — тот, кто скорее всего говорит дальше; игрок отдельным пунктом
    const npcs = project.entities.filter((e) => e.kind === "character" && !e.isPlayer);
    const npcFirst = npcs.some((e) => e.id === suggested)
      ? suggested
      : from?.type === "line" && npcs.some((e) => e.id === from.speaker)
        ? from.speaker
        : defaultNpc(project, canvas);
    npcs.sort((a, b) => (a.id === npcFirst ? -1 : b.id === npcFirst ? 1 : 0));
    const lines: MenuItem[] = npcs.map((e) => ({ label: e.name, color: e.color, icon: MessageSquare, type: "line", init: { speaker: e.id } }));
    const option: MenuItem[] = player ? [{ label: "Вариант игрока", color: player.color, icon: User, type: "line", init: { speaker: player.id } }] : [];
    const items: MenuItem[] = [{ label: "Реплика NPC", icon: MessageSquare, color: project.entities.find((e) => e.id === suggested)?.color, children: lines }, ...option];
    items.push(
      { label: "Хаб", icon: Repeat, type: "hub" },
      { label: "Условие да/нет", icon: GitBranch, type: "condition" },
      { label: "Переход в другой файл", icon: ArrowRightFromLine, type: "jump" },
      { label: "Вложенность", icon: Layers, type: "flow" },
      { label: "Чистый ink", icon: Code, type: "ink" },
    );
    if (!menu.from) {
      items.push({ label: "Заметка", icon: StickyNote, type: "note" });
      items.push({ label: "Выровнять всё по сетке", icon: LayoutGrid, run: () => editCanvas((c) => alignToGrid(c, GRID)) });
      items.push({ label: "Показать всё (Shift+1)", icon: Maximize, run: () => fitView({ padding: 0.2, maxZoom: 1, duration: 200 }) });
    }
    return items;
  }, [menu, project, canvas, fitView, editCanvas]);

  const pickMenu = useCallback(
    (item: MenuItem) => {
      if (!menu) return;
      setMenu(null);
      setPinPicker(null);
      if (item.run) return item.run();
      let newIds: string[] = [];
      editCanvas((canvas) => {
        if (item.type === "note") {
          newIds = [addNote(canvas, menu.at, root ?? canvas).id];
          return;
        }
        if (menu.from) {
          newIds = addBranchCards(canvas, menu.from, item.type ?? "line", menu.count ?? 1, item.init ?? {}, root ?? canvas, usePrefs.getState().snap ? GRID : 1, menu.port).map((card) => card.id);
          return;
        }
        newIds = [addCard(canvas, item.type ?? "line", menu.at, item.init, root ?? canvas).id];
      });
      if (newIds.length) {
        setSelection([...newIds].sort());
        if (newIds.length === 1 && item.type !== "note" && !isCompact(item.type)) requestEdit(newIds[0]);
      }
      wrapper.current?.focus();
    },
    [menu, editCanvas, setSelection, requestEdit, root],
  );

  // правый щелчок по карточке — действия с ней
  const [cardMenu, setCardMenu] = useState<{ x: number; y: number; id: string } | null>(null);
  const onNodeContextMenu = useCallback((e: React.MouseEvent, node: Node) => {
    e.preventDefault();
    if (node.type !== "card") return;
    const rect = wrapper.current?.getBoundingClientRect();
    setMenu(null);
    setCardMenu({ x: e.clientX - (rect?.left ?? 0), y: e.clientY - (rect?.top ?? 0), id: node.id });
  }, []);

  const onPaneContextMenu = useCallback(
    (e: React.MouseEvent | MouseEvent) => {
      e.preventDefault();
      openMenu(e.clientX, e.clientY);
    },
    [openMenu],
  );

  const onNodeDragStop = useCallback(
    (_: unknown, __: Node, dragged: Node[]) => {
      editCanvas((canvas) => {
        for (const n of dragged) {
          const pos = { x: Math.round(n.position.x), y: Math.round(n.position.y) };
          const note = canvas.notes.find((x) => x.id === n.id);
          if (note) Object.assign(note, pos);
          else canvas.layout[n.id] = { ...canvas.layout[n.id], ...pos };
        }
        reorderLinks(canvas);
      });
    },
    [editCanvas],
  );

  useEffect(() => {
    const onDelete = (e: KeyboardEvent) => {
      if (e.key !== "Delete" && e.key !== "Backspace") return;
      const { view, editorOpen, selection, selectedLinks } = useStore.getState();
      if (view !== "canvas" || editorOpen || isTyping() || document.querySelector(".modal-backdrop")) return;
      if (!selection.length && !selectedLinks.length) return;
      e.preventDefault();
      editCanvas((c) => {
        if (selection.length) deleteCards(c, selection);
        if (selectedLinks.length) deleteLinks(c, selectedLinks);
      });
      setSelection([], null, []);
    };
    window.addEventListener("keydown", onDelete);
    return () => window.removeEventListener("keydown", onDelete);
  }, [editCanvas, setSelection]);

  const onNodeClick = useCallback(
    (e: React.MouseEvent, node: Node) => {
      if (node.type !== "card") return;
      if (!(e.ctrlKey || e.metaKey)) return;
      const card = (node.data as CardData).card;
      if (card.type !== "jump" || !card.target || !project) return;
      const [canvasId, sub] = card.target.split(".");
      const entry = Object.entries(project.canvases).find(([, c]) => c.id === canvasId);
      if (!entry) return;
      const [targetKey, target] = entry;
      const targetCard = flowCards(target).map((x) => x.card).find((c) => c.id === sub || (c.entry && (c.entry === sub || `entry_${c.entry}` === sub))) ?? rootCard(target);
      focusCard(targetKey, targetCard?.id);
    },
    [project, focusCard],
  );

  const createAt = useCallback(
    (type: CardType | "note" | "player", at?: { x: number; y: number }) => {
      const rect = wrapper.current?.getBoundingClientRect();
      const pos = snapPoint(at ?? screenToFlowPosition({ x: (rect?.left ?? 0) + (rect?.width ?? 800) / 2 - CARD_W / 2, y: (rect?.top ?? 0) + (rect?.height ?? 600) / 2 - 40 }), usePrefs.getState().snap ? GRID : 1);
      let newId = "";
      editCanvas((canvas, p) => {
        const rootCanvas = root ?? canvas;
        if (type === "note") {
          newId = addNote(canvas, pos, rootCanvas).id;
          return;
        }
        if (type === "player") {
          newId = addCard(canvas, "line", pos, { speaker: p.entities.find((e) => e.isPlayer)?.id }, rootCanvas).id;
          return;
        }
        const init: Partial<Card> = type === "line" ? { speaker: defaultNpc(p, canvas) } : {};
        newId = addCard(canvas, type, pos, init, rootCanvas).id;
      });
      if (newId) {
        setSelection([newId]);
        if (!isCompact(type)) requestEdit(newId);
      }
    },
    [editCanvas, screenToFlowPosition, setSelection, requestEdit, root],
  );

  const onDoubleClick = useCallback(
    (e: React.MouseEvent) => {
      if (!(e.target as HTMLElement).classList.contains("react-flow__pane")) return;
      createAt("line", screenToFlowPosition({ x: e.clientX - CARD_W / 2, y: e.clientY - 30 }));
    },
    [createAt, screenToFlowPosition],
  );

  // Enter / Tab / Ctrl+1…9 на выделенной карточке
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (useStore.getState().view !== "canvas" || isTyping()) return;
      if (e.key === "Escape" && (pinPicker || pinEditor)) {
        e.preventDefault();
        setPinPicker(null);
        setPinEditor(null);
        return;
      }
      if (pinPicker && !e.ctrlKey && !e.metaKey && /^[1-4]$/.test(e.key)) {
        e.preventDefault();
        openMenu(pinPicker.x + 20, pinPicker.y, pinPicker.id, pinPicker.port, Number(e.key));
        return;
      }
      if (e.shiftKey && e.code === "Digit1") {
        e.preventDefault();
        fitView({ padding: 0.2, maxZoom: 1, duration: 200 });
        return;
      }
      const { selection, project, activeCanvas, flowPath: path } = useStore.getState();
      if (!selection.length || !project || !activeCanvas) return;
      if ((e.key === "Enter" || e.key === "Tab") && selection.length === 1) {
        e.preventDefault();
        const id = selection[0];
        let newId = "";
        editCanvas((canvas, p) => {
          const rootCanvas = p.canvases[activeCanvas];
          const card = e.key === "Enter" ? addNextLine(p, canvas, id, rootCanvas) : addPlayerOption(p, canvas, id, rootCanvas);
          newId = card?.id ?? "";
        });
        if (newId) {
          setSelection([newId]);
          requestEdit(newId);
          const rootCanvas = useStore.getState().project?.canvases[activeCanvas];
          const at = rootCanvas && canvasAtPath(rootCanvas, path)?.layout[newId];
          if (at) setCenter(at.x + (at.w ?? CARD_W) / 2, at.y + 60, { zoom: 1, duration: 200 });
        }
      }
      if ((e.ctrlKey || e.metaKey) && /^[1-9]$/.test(e.key)) {
        e.preventDefault();
        const speaker = project.entities.filter((x) => x.kind === "character")[Number(e.key) - 1];
        if (speaker) editCanvas((canvas) => { for (const c of canvas.cards) if (c.type === "line" && selection.includes(c.id)) c.speaker = speaker.id; });
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [editCanvas, setSelection, setCenter, requestEdit, fitView, pinPicker, pinEditor, openMenu]);

  // Ctrl+C / Ctrl+X / Ctrl+V: карточки и заметки со стрелками между ними — через системный буфер,
  // поэтому можно вставлять в другой файл и даже в другое окно. В полях ввода — обычный текст.
  const pointer = useRef<{ x: number; y: number } | null>(null);
  useEffect(() => {
    const onCopy = (e: ClipboardEvent) => {
      if (useStore.getState().view !== "canvas" || isTyping()) return;
      const { selection, project, activeCanvas, flowPath: path } = useStore.getState();
      const rootCanvas = project && activeCanvas ? project.canvases[activeCanvas] : null;
      const canvas = rootCanvas && canvasAtPath(rootCanvas, path);
      const fragment = canvas && copyFragment(canvas, selection);
      if (!fragment || !e.clipboardData) return;
      e.preventDefault();
      e.clipboardData.setData("text/plain", JSON.stringify(fragment));
      if (e.type === "cut") {
        editCanvas((c) => deleteCards(c, selection));
        setSelection([]);
      }
    };
    const onPaste = (e: ClipboardEvent) => {
      if (useStore.getState().view !== "canvas" || isTyping()) return;
      const fragment = parseFragment(e.clipboardData?.getData("text/plain") ?? "");
      if (!fragment) return;
      e.preventDefault();
      const at = pointer.current ? screenToFlowPosition(pointer.current) : undefined;
      let ids: string[] = [];
      editCanvas((c, p) => (ids = pasteFragment(p, c, fragment, at, usePrefs.getState().snap ? GRID : 1, root ?? c)));
      setSelection([...ids].sort());
    };
    window.addEventListener("copy", onCopy);
    window.addEventListener("cut", onCopy);
    window.addEventListener("paste", onPaste);
    return () => {
      window.removeEventListener("copy", onCopy);
      window.removeEventListener("cut", onCopy);
      window.removeEventListener("paste", onPaste);
    };
  }, [editCanvas, setSelection, screenToFlowPosition]);

  if (!canvas) return <div className="empty-state">Выберите или создайте файл слева</div>;

  return (
    <div
      className="flow"
      ref={wrapper}
      onDoubleClick={onDoubleClick}
      onMouseMove={(e) => (pointer.current = { x: e.clientX, y: e.clientY })}
      onMouseLeave={() => (pointer.current = null)}
      style={{ ["--card-font" as string]: `${fontSize}px` }}
      tabIndex={-1}
    >
      <ReactFlow
        nodes={nodes}
        edges={edges}
        defaultViewport={initialViewport.current ?? { x: 0, y: 0, zoom: 1 }}
        fitView={!initialViewport.current}
        fitViewOptions={{ padding: 0.2, maxZoom: 1 }}
        onMoveEnd={() => viewports.set(flowKey, getViewport())}
        nodeTypes={nodeTypes}
        edgeTypes={edgeTypes}
        onNodesChange={onNodesChange}
        onEdgesChange={onEdgesChange}
        connectionRadius={60}
        connectOnClick={false}
        selectionMode={SelectionMode.Partial}
        onNodeContextMenu={onNodeContextMenu}
        onSelectionChange={onSelectionChange}
        onConnect={onConnect}
        onConnectStart={onConnectStart}
        onConnectEnd={onConnectEnd}
        onNodeDragStop={onNodeDragStop}
        onNodeClick={onNodeClick}
        onNodeDoubleClick={(_, node) => {
          if (node.type !== "card" || !key) return;
          const card = (node.data as CardData).card;
          if (card.flow) useStore.getState().setActiveCanvas(key, [...flowPath, card.id]);
        }}
        onPaneContextMenu={onPaneContextMenu}
        onPaneClick={() => {
          setMenu(null);
          setCardMenu(null);
          setPinPicker(null);
          setPinEditor(null);
          useStore.getState().clearInspector();
        }}
        proOptions={{ hideAttribution: true }}
        zoomOnDoubleClick={false}
        snapToGrid={snap}
        snapGrid={[GRID, GRID]}
        deleteKeyCode={null}
        selectionOnDrag
        panOnDrag={[1]}
        panActivationKeyCode={["Meta", "Control"]}
        panOnScroll
        zoomOnScroll={false}
        zoomOnPinch
        multiSelectionKeyCode={["Shift", "Meta", "Control"]}
        minZoom={0.1}
        colorMode={colorMode}
      >
        <Background variant={BackgroundVariant.Lines} gap={20} />
        <Panel position="top-left" className="palette">
          <IconButton icon={MessageSquare} label="Реплика" onClick={() => createAt("line")} />
          <IconButton icon={User} label="Вариант игрока" onClick={() => createAt("player")} />
          <IconButton icon={Repeat} label="Хаб" onClick={() => createAt("hub")} />
          <IconButton icon={GitBranch} label="Условие" onClick={() => createAt("condition")} />
          <IconButton icon={ArrowRightFromLine} label="Переход" onClick={() => createAt("jump")} />
          <IconButton icon={Layers} label="Вложенность" onClick={() => createAt("flow")} />
          <IconButton icon={Code} label="Чистый ink" onClick={() => createAt("ink")} />
          <IconButton icon={StickyNote} label="Заметка" onClick={() => createAt("note")} />
          <span className="toolbar-sep" />
          <IconButton icon={Magnet} className={`toggle ${snap ? "on" : ""}`} label={snap ? "Привязка к сетке" : "Свободное перемещение"} onClick={() => usePrefs.getState().set({ snap: !snap })} />
        </Panel>
      </ReactFlow>
      {pinPicker && <div className="create-menu pin-count-menu" style={{
        left: Math.max(8, Math.min(pinPicker.x - (wrapper.current?.getBoundingClientRect().left ?? 0) + 12, (wrapper.current?.clientWidth ?? 400) - 70)),
        top: Math.max(8, Math.min(pinPicker.y - (wrapper.current?.getBoundingClientRect().top ?? 0), (wrapper.current?.clientHeight ?? 400) - 170)),
      }} onContextMenu={(e) => e.preventDefault()}>
        <div className="pin-count-title">Новых связей</div>
        {[1, 2, 3, 4].map((count) => {
          const open = (e: React.MouseEvent<HTMLButtonElement>) => {
            const r = e.currentTarget.getBoundingClientRect();
            openMenu(r.right + 4, r.top, pinPicker.id, pinPicker.port, count, true);
          };
          return <button key={count} className={menu?.from === pinPicker.id && menu.count === count ? "on" : ""} onMouseDown={(e) => e.preventDefault()} onMouseEnter={open} onClick={open}>{count}<ChevronRight size={14} className="submenu-arrow" /></button>;
        })}
      </div>}
      {pinEditor && project && canvas.cards.some((card) => card.id === pinEditor.id) && <div className="pin-editor-wrap" style={{
        left: Math.max(8, Math.min(pinEditor.x - (wrapper.current?.getBoundingClientRect().left ?? 0) + 12, (wrapper.current?.clientWidth ?? 400) - 308)),
        top: Math.max(8, Math.min(pinEditor.y - (wrapper.current?.getBoundingClientRect().top ?? 0) + 12, (wrapper.current?.clientHeight ?? 400) - 190)),
      }} onMouseDown={(e) => e.stopPropagation()}><PinEditor card={canvas.cards.find((card) => card.id === pinEditor.id)!} field={pinEditor.field} project={project} onClose={() => setPinEditor(null)} onCommit={(value) => {
        editCanvas((c) => {
          const target = c.cards.find((card) => card.id === pinEditor.id);
          if (!target) return;
          if (value.trim()) target[pinEditor.field] = value;
          else delete target[pinEditor.field];
        });
        setPinEditor(null);
      }} /></div>}
      {cardMenu && canvas && <CreateMenu key={`card:${cardMenu.id}`} menu={{ x: cardMenu.x, y: cardMenu.y, at: { x: 0, y: 0 } }} items={[
        { label: "Настройки карточки", icon: GitBranch, run: () => useStore.getState().openCardSettings(cardMenu.id) },
        ...(canvas.cards.find((c) => c.id === cardMenu.id)?.flow ? [{ label: "Открыть вложенность", icon: Layers, run: () => {
          if (key) useStore.getState().setActiveCanvas(key, [...flowPath, cardMenu.id]);
        } }] : []),
        { label: canvas.start === cardMenu.id ? "Уже начало файла" : "Сделать началом файла", icon: Flag, run: () => editCanvas((c) => (c.start = cardMenu.id)) },
        ...(canvas.layout[cardMenu.id]?.w != null && !isCompact(canvas.cards.find((c) => c.id === cardMenu.id)?.type) ? [{ label: "Вернуть автоматический размер", icon: Maximize, run: () => editCanvas((c) => { const { x, y } = c.layout[cardMenu.id]; c.layout[cardMenu.id] = { x, y }; }) }] : []),
        { label: "Удалить карточку", icon: Trash2, run: () => { editCanvas((c) => deleteCards(c, [cardMenu.id])); setSelection([]); } },
      ]} onPick={(item) => { setCardMenu(null); item.run?.(); }} onClose={() => setCardMenu(null)} />}
      {menu && <CreateMenu key={`${menu.x}:${menu.y}:${menu.count ?? 1}`} menu={menu} items={menuItems} onPick={pickMenu} onClose={closeMenu} />}
    </div>
  );
}

export function CanvasView() {
  const key = useStore((s) => s.activeCanvas);
  const flowPath = useStore((s) => s.flowPath);
  const flowKey = `${key ?? ""}:${flowPath.join("/")}`;
  const viewports = useRef(new Map<string, { x: number; y: number; zoom: number }>());
  return (
    <ReactFlowProvider key={flowKey}>
      <Flow flowKey={flowKey} viewports={viewports.current} />
    </ReactFlowProvider>
  );
}
