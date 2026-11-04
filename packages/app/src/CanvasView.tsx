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
import { ArrowRightFromLine, ChevronRight, Code, Flag, GitBranch, Layers, LayoutGrid, Magnet, Maximize, MessageSquare, Repeat, StickyNote, Trash2, User, X } from "lucide-react";
import type { Card, CardType, Entity } from "@visink/core";
import { canvasAtPath, flowCards, isPlayerCard } from "@visink/core";
import { rootCard } from "@visink/compiler";
import { useStore } from "./store";
import {
  CARD_W,
  addCard,
  addNextLine,
  addNote,
  addPlayerOption,
  alignToGrid,
  connect,
  copyFragment,
  defaultNpc,
  deleteCards,
  deleteLink,
  nextSpeaker,
  parseFragment,
  pasteFragment,
  reorderLinks,
  snapPoint,
} from "./ops";
import { GRID, usePrefs } from "./prefs";
import { usePortrait } from "./portraits";
import { useTheme } from "./theme";
import { IconButton } from "./ui";

type CardData = { card: Card; speaker?: Entity; player: boolean; isStart: boolean; fixedHeight: boolean; problem?: "error" | "warning"; problemText?: string; problemCount?: number; onPin: (id: string, field: "condition" | "action", port?: "yes" | "no") => void };
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

/** Строки действия в виде ink: тильду можно не писать. */
const actionLinesOf = (action?: string) =>
  action
    ?.split("\n")
    .map((l) => l.trim())
    .filter(Boolean)
    .map((l) => (l.startsWith("~") ? l : `~ ${l}`)) ?? [];

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
  const action = actionLinesOf(card.action);
  const gate = card.type !== "condition" ? card.condition?.trim() : "";
  const outPin = card.type === "line" || card.type === "hub" || card.type === "flow" || card.type === "ink";
  const fontSize = usePrefs((s) => s.cardFontSize);
  const content = card.text || card.condition || "";
  const chars = Math.max(12, ((width ?? CARD_W) - 24) / (fontSize * 0.54));
  const textLines = content.split("\n").reduce((n, line) => n + Math.max(1, Math.ceil(line.length / chars)), 0);
  const minHeight = (card.type === "line" ? 120 : 60) + (content.trim() ? Math.max(20, textLines * fontSize * 1.4) : 0);

  useLayoutEffect(() => updateNodeInternals(id), [id, width, height, fixedHeight, card.type, player, card.flow, updateNodeInternals]);
  useEffect(() => () => clearTimeout(pinTimer.current), []);

  const openLogic = (field: "condition" | "action") => {
    clearTimeout(pinTimer.current);
    useStore.getState().setSelection([card.id]);
    useStore.getState().openEditor();
    setTimeout(() => (document.querySelector(`[data-field="${field}"] input, [data-field="${field}"] textarea`) as HTMLElement | null)?.focus(), 60);
  };
  const pinClick = (field: "condition" | "action", port?: "yes" | "no") => {
    clearTimeout(pinTimer.current);
    pinTimer.current = window.setTimeout(() => {
      if (field === "condition") openLogic(field);
      else data.onPin(card.id, field, port);
    }, 240);
  };

  return (
    <div className={`card card-${card.type} ${player ? "player" : ""} ${selected ? "selected" : ""} ${fixedHeight ? "fixed-h" : ""}`} style={{ ["--speaker" as string]: color }} onMouseEnter={() => setHovered(true)} onMouseLeave={() => setHovered(false)}>
      <NodeResizer
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
      />
      <Handle type="target" position={Position.Left} style={{ top: "50%" }} className={`pin pin-in ${gate ? "has-logic cond" : ""}`} title={gate ? `Условие: ${gate}` : "Вход. Двойной щелчок — условие"} onClick={card.type !== "condition" ? () => pinClick("condition") : undefined} onDoubleClick={card.type !== "condition" ? () => openLogic("condition") : undefined} />
      {problem && <span className={`problem-badge ${problem}`} title={problemText}>!{problemCount && problemCount > 1 ? problemCount : ""}</span>}
      <div className="card-head" title={`id: ${card.id}`}>
        {isStart && <span className="chip" title="Начало файла"><Flag size={11} /></span>}
        <span className="card-type">{card.type === "line" ? speaker?.name ?? "без спикера" : TYPE_LABEL[card.type]}</span>
        {card.flow && card.type !== "flow" && <span className="chip nested-chip" title="Двойной щелчок — открыть вложенный поток"><Layers size={11} /></span>}
        {card.entry && <span className="chip mono" title={`Точка входа: ${card.entry}`}>▶ {card.entry}</span>}
        {player && card.repeat === "sticky" && <span className="chip" title="Повторяемый вариант (+)"><Repeat size={11} /></span>}
        {player && card.repeat === "fallback" && <span className="chip" title="Запасной вариант">запасной</span>}
        {card.status && card.status !== "draft" && <span className={`status-dot ${card.status}`} title={card.status === "final" ? "Финал" : "На вычитке"} />}
        {card.note && <span className="chip" title={card.note}><StickyNote size={11} /></span>}
        <Icon size={14} className="card-icon" />
      </div>
      {card.type === "line" ? <div className={`card-body line-body ${multi ? "" : "nodrag"}`}>
        <div className="card-top"><Avatar speaker={speaker} /><div className={`card-cell ${player ? "" : "unused"}`} title={player ? undefined : "У реплик NPC текст на кнопке не используется"}><InlineText card={card} field="menuText" locked={multi} autoEdit={player} placeholder={player ? (card.text ? "в выборе будет реплика" : "текст на кнопке…") : "не используется"} /></div></div>
        <div className="card-cell"><InlineText card={card} field="stageDirection" locked={multi} placeholder="ремарка…" /></div>
        <div className={`card-cell grow ${card.text ? "has-text" : ""}`}><InlineText card={card} field="text" locked={multi} autoEdit={!player} placeholder={player ? "(реплика не звучит)" : "текст реплики…"} /></div>
      </div> : <div className={`card-body ${multi ? "" : "nodrag"}`}>
        {card.type === "hub" && <InlineText card={card} field="text" locked={multi} autoEdit placeholder="название хаба…" />}
        {card.type === "condition" && <InlineText card={card} field="condition" locked={multi} autoEdit placeholder="условие?" />}
        {card.type === "jump" && <div className="card-text mono">→ {card.target || "цель?"}</div>}
        {card.type === "flow" && <InlineText card={card} field="text" locked={multi} autoEdit placeholder="название вложенности…" />}
        {card.type === "ink" && <InlineText card={card} field="text" mono locked={multi} autoEdit placeholder="чистый ink" />}
        {!outPin && action.map((l, i) => <div key={i} className="card-action mono">{l}</div>)}
      </div>}
      {card.type === "condition" ? <>
        <Handle type="source" id="yes" position={Position.Right} style={{ top: "40%" }} className="pin pin-out pin-yes" title="Выход «да»: щелчок — связи, двойной — действие" onClick={() => pinClick("action", "yes")} onDoubleClick={() => openLogic("action")} />
        <Handle type="source" id="no" position={Position.Right} style={{ top: "75%" }} className="pin pin-out pin-no" title="Выход «нет»: щелчок — связи, двойной — действие" onClick={() => pinClick("action", "no")} onDoubleClick={() => openLogic("action")} />
        <span className="port-label" style={{ top: "calc(40% - 20px)" }}>да</span><span className="port-label" style={{ top: "calc(75% - 20px)" }}>нет</span>
      </> : outPin ? <Handle type="source" position={Position.Right} style={{ top: "50%" }} className={`pin pin-out ${action.length ? "has-logic act" : ""}`} title={action.length ? `Действие:\n${action.join("\n")}` : "Выход: тяните стрелку; щелчок — 1–4 связи, двойной — действие"} onClick={() => pinClick("action")} onDoubleClick={() => openLogic("action")} /> : null}
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
  const action = actionLinesOf(data?.action);
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
type MenuState = { x: number; y: number; at: { x: number; y: number }; from?: string; port?: "yes" | "no" };

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

function Flow() {
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
  const { screenToFlowPosition, setCenter, fitView, getViewport, setViewport, getNodes } = useReactFlow();
  const wrapper = useRef<HTMLDivElement>(null);
  const [drafts, setDrafts] = useState<DraftLink[]>([]);
  const [pinPicker, setPinPicker] = useState<{ id: string; port?: "yes" | "no" } | null>(null);
  const [menu, setMenu] = useState<MenuState | null>(null);

  const root = project && key ? project.canvases[key] : null;
  const canvas = root ? canvasAtPath(root, flowPath) ?? null : null;
  const flowKey = `${key ?? ""}:${flowPath.join("/")}`;
  const viewports = useRef(new Map<string, { x: number; y: number; zoom: number }>());
  const previousFlowKey = useRef(flowKey);
  useEffect(() => { setDrafts([]); setPinPicker(null); setMenu(null); }, [flowKey]);

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

  const onPin = useCallback((id: string, _field: "condition" | "action", port?: "yes" | "no") => {
    setDrafts([]);
    setPinPicker({ id, ...(port ? { port } : {}) });
  }, []);

  const activeDrafts = useMemo<DraftLink[]>(() => menu?.from ? [...drafts, { id: "draft:menu", from: menu.from, ...(menu.port ? { port: menu.port } : {}), x: menu.at.x, y: menu.at.y }] : drafts, [drafts, menu]);

  // Выделением владеет React Flow: узлы пересобираются только при правке проекта,
  // а выделение и размеры переносятся со старых узлов.
  const derivedNodes = useMemo<Node[]>(() => {
    if (!canvas || !project) return [];
    const cards: Node<CardData>[] = canvas.cards.map((card) => {
      const pr = problems.get(card.id);
      return {
        id: card.id,
        type: "card",
        position: { x: canvas.layout[card.id]?.x ?? 0, y: canvas.layout[card.id]?.y ?? 0 },
        width: canvas.layout[card.id]?.w ?? CARD_W,
        ...(canvas.layout[card.id]?.h != null ? { height: canvas.layout[card.id]!.h } : {}),
        data: {
          card,
          speaker: project.entities.find((e) => e.id === card.speaker),
          player: isPlayerCard(project, card),
          isStart: canvas.start === card.id,
          fixedHeight: canvas.layout[card.id]?.h != null,
          problem: pr?.severity,
          problemText: pr?.text.join("\n"),
          problemCount: pr?.text.length,
          onPin,
        },
      };
    });
    const notes: Node<NoteData>[] = canvas.notes.map((n) => ({ id: n.id, type: "note", position: { x: n.x, y: n.y }, data: { id: n.id, text: n.text } }));
    const placeholders: Node[] = activeDrafts.map((draft) => ({ id: draft.id, type: "draft", position: { x: draft.x, y: draft.y }, selectable: false, deletable: false, data: {} }));
    return [...notes, ...cards, ...placeholders];
  }, [canvas, project, problems, activeDrafts, onPin]);

  const [nodes, setNodes, onNodesChange] = useNodesState<Node>([]);
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
    for (const d of check?.diagnostics ?? []) if (d.canvas === key && d.link) out.add(`${d.link.from}>${d.link.to}>${d.link.port ?? ""}`);
    return out;
  }, [check, key]);

  const derivedEdges = useMemo<Edge<EdgeData>[]>(() => {
    if (!canvas) return [];
    const real = canvas.links.map((l): Edge<EdgeData> => {
      const id = `${l.from}>${l.to}>${l.port ?? ""}`;
      const error = badLinks.has(id);
      return { id, type: "logic", source: l.from, target: l.to, sourceHandle: l.port ?? null, markerEnd: { type: MarkerType.ArrowClosed }, className: [l.port ? `edge-${l.port}` : "", error ? "edge-error" : ""].join(" ").trim() || undefined, data: { condition: l.condition, action: l.action, error } };
    });
    const temporary = activeDrafts.map((d): Edge<EdgeData> => ({ id: `draft-edge:${d.id}`, type: "logic", source: d.from, target: d.id, sourceHandle: d.port ?? null, markerEnd: { type: MarkerType.ArrowClosed }, className: "edge-draft", selectable: false, deletable: false, data: { draft: true } }));
    return [...real, ...temporary];
  }, [canvas, badLinks, activeDrafts]);

  const [edges, setEdges, onEdgesChange] = useEdgesState<Edge<EdgeData>>([]);
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
    const previous = previousFlowKey.current;
    if (previous !== flowKey) viewports.current.set(previous, getViewport());
    previousFlowKey.current = flowKey;
    const saved = viewports.current.get(flowKey);
    const t = setTimeout(() => {
      if (saved) void setViewport(saved);
      else void fitView({ padding: 0.2, maxZoom: 1 });
    }, 50);
    return () => clearTimeout(t);
  }, [flowKey, fitView, getViewport, setViewport]);

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

  const onEdgeClick = useCallback((event: React.MouseEvent, edge: Edge) => {
    if (edge.id.startsWith("draft-edge:")) return;
    const additive = event.shiftKey || event.metaKey || event.ctrlKey;
    const previous = additive ? useStore.getState().selectedLinks : [];
    const links = (previous.includes(edge.id) ? previous.filter((id) => id !== edge.id) : [...previous, edge.id]).sort();
    const pickedNodes = additive ? getNodes().filter((n) => n.selected && n.type !== "draft").map((n) => n.id).sort() : [];
    if (!additive) setNodes((ns) => ns.map((n) => n.selected ? { ...n, selected: false } : n));
    setEdges((es) => es.map((e) => !!e.selected !== links.includes(e.id) ? { ...e, selected: links.includes(e.id) } : e));
    setSelection(pickedNodes, !pickedNodes.length && links.length === 1 ? links[0] : null, links);
  }, [getNodes, setEdges, setNodes, setSelection]);

  const onConnect = useCallback(
    (c: Connection) => {
      if (c.target.startsWith("draft:")) return;
      editCanvas((canvas) => connect(canvas, c.source, c.target, (c.sourceHandle as "yes" | "no") || undefined));
    },
    [editCanvas],
  );

  const openMenu = useCallback(
    (clientX: number, clientY: number, from?: string, port?: "yes" | "no") => {
      const rect = wrapper.current?.getBoundingClientRect();
      const at = screenToFlowPosition({ x: clientX, y: clientY - 30 });
      setMenu({
        x: Math.min(clientX - (rect?.left ?? 0), (rect?.width ?? 1e4) - 230),
        y: Math.min(clientY - (rect?.top ?? 0), (rect?.height ?? 1e4) - 300),
        at: snapPoint(at, usePrefs.getState().snap ? GRID : 1),
        from,
        port,
      });
    },
    [screenToFlowPosition],
  );

  // Стрелка в пустоту — меню: что поставить там, где отпустили. Щелчок по пину без протяжки — не стрелка.
  const connectFrom = useRef<{ x: number; y: number } | null>(null);
  const onConnectStart: OnConnectStart = useCallback((event) => {
    const point = "changedTouches" in event ? event.changedTouches[0] : event;
    connectFrom.current = { x: point.clientX, y: point.clientY };
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
      if (item.run) return item.run();
      let newId = "";
      editCanvas((canvas) => {
        if (item.type === "note") {
          newId = addNote(canvas, menu.at, root ?? canvas).id;
          return;
        }
        const card = addCard(canvas, item.type ?? "line", menu.at, item.init, root ?? canvas);
        if (menu.from) connect(canvas, menu.from, card.id, menu.port);
        newId = card.id;
      });
      if (newId) {
        setSelection([newId]);
        requestEdit(newId);
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

  const onNodesDelete = useCallback((deleted: Node[]) => editCanvas((c) => deleteCards(c, deleted.filter((n) => n.type !== "draft").map((n) => n.id))), [editCanvas]);
  const onEdgesDelete = useCallback(
    (deleted: Edge[]) => editCanvas((c) => deleted.filter((e) => !(e.data as EdgeData | undefined)?.draft).forEach((e) => deleteLink(c, e.source, e.target, e.sourceHandle ?? undefined))),
    [editCanvas],
  );

  const onNodeClick = useCallback(
    (e: React.MouseEvent, node: Node) => {
      if (node.type !== "card") return;
      if (drafts.length && !(e.ctrlKey || e.metaKey)) {
        const draft = drafts[0];
        editCanvas((c) => connect(c, draft.from, node.id, draft.port));
        setDrafts((old) => old.slice(1));
        if (drafts.length === 1) setPinPicker(null);
        return;
      }
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
    [project, focusCard, drafts, editCanvas],
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
        requestEdit(newId);
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
      if (e.key === "Escape" && (drafts.length || pinPicker)) {
        e.preventDefault();
        setDrafts([]);
        setPinPicker(null);
        return;
      }
      if (pinPicker && !e.ctrlKey && !e.metaKey && /^[1-4]$/.test(e.key) && canvas) {
        e.preventDefault();
        const count = Number(e.key);
        const at = canvas.layout[pinPicker.id] ?? { x: 0, y: 0 };
        const stamp = Date.now();
        setDrafts(Array.from({ length: count }, (_, i) => ({ id: `draft:${pinPicker.id}:${stamp}:${i}`, from: pinPicker.id, ...(pinPicker.port ? { port: pinPicker.port } : {}), x: at.x + (at.w ?? CARD_W) + 150, y: at.y + 45 + (i - (count - 1) / 2) * 80 })));
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
  }, [editCanvas, setSelection, setCenter, requestEdit, fitView, pinPicker, drafts.length, canvas]);

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
        nodeTypes={nodeTypes}
        edgeTypes={edgeTypes}
        onNodesChange={onNodesChange}
        onEdgesChange={onEdgesChange}
        connectionRadius={60}
        connectOnClick={false}
        selectionMode={SelectionMode.Partial}
        onNodeContextMenu={onNodeContextMenu}
        onSelectionChange={onSelectionChange}
        onEdgeClick={onEdgeClick}
        onConnect={onConnect}
        onConnectStart={onConnectStart}
        onConnectEnd={onConnectEnd}
        onNodeDragStop={onNodeDragStop}
        onNodesDelete={onNodesDelete}
        onEdgesDelete={onEdgesDelete}
        onNodeClick={onNodeClick}
        onNodeDoubleClick={(_, node) => {
          if (node.type !== "card" || !key) return;
          const card = (node.data as CardData).card;
          setSelection([card.id]);
          if (card.flow) useStore.getState().setActiveCanvas(key, [...flowPath, card.id]);
          else useStore.getState().openEditor();
        }}
        onPaneContextMenu={onPaneContextMenu}
        onPaneClick={() => {
          setMenu(null);
          setCardMenu(null);
          setDrafts([]);
          setPinPicker(null);
          useStore.getState().clearInspector();
        }}
        proOptions={{ hideAttribution: true }}
        zoomOnDoubleClick={false}
        snapToGrid={snap}
        snapGrid={[GRID, GRID]}
        deleteKeyCode={["Delete", "Backspace"]}
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
        {pinPicker && <Panel position="top-right" className="pin-picker">
          <span>Связи из пина:</span>{[1, 2, 3, 4].map((count) => <button key={count} onClick={() => {
            if (!canvas) return;
            const at = canvas.layout[pinPicker.id] ?? { x: 0, y: 0 };
            const stamp = Date.now();
            setDrafts(Array.from({ length: count }, (_, i) => ({ id: `draft:${pinPicker.id}:${stamp}:${i}`, from: pinPicker.id, ...(pinPicker.port ? { port: pinPicker.port } : {}), x: at.x + (at.w ?? CARD_W) + 150, y: at.y + 45 + (i - (count - 1) / 2) * 80 })));
          }}>{count}</button>)}
          <IconButton icon={X} label="Отмена" onClick={() => { setDrafts([]); setPinPicker(null); }} />
          {drafts.length > 0 && <span className="muted">Щёлкните по цели · осталось: {drafts.length}</span>}
        </Panel>}
      </ReactFlow>
      {cardMenu && canvas && <CreateMenu key={`card:${cardMenu.id}`} menu={{ x: cardMenu.x, y: cardMenu.y, at: { x: 0, y: 0 } }} items={[
        { label: "Настройки карточки", icon: GitBranch, run: () => { setSelection([cardMenu.id]); useStore.getState().openEditor(); } },
        ...(canvas.cards.find((c) => c.id === cardMenu.id)?.flow ? [{ label: "Открыть вложенность", icon: Layers, run: () => {
          if (key) useStore.getState().setActiveCanvas(key, [...flowPath, cardMenu.id]);
        } }] : []),
        { label: canvas.start === cardMenu.id ? "Уже начало файла" : "Сделать началом файла", icon: Flag, run: () => editCanvas((c) => (c.start = cardMenu.id)) },
        ...(canvas.layout[cardMenu.id]?.w != null ? [{ label: "Вернуть автоматический размер", icon: Maximize, run: () => editCanvas((c) => { const { x, y } = c.layout[cardMenu.id]; c.layout[cardMenu.id] = { x, y }; }) }] : []),
        { label: "Удалить карточку", icon: Trash2, run: () => { editCanvas((c) => deleteCards(c, [cardMenu.id])); setSelection([]); } },
      ]} onPick={(item) => { setCardMenu(null); item.run?.(); }} onClose={() => setCardMenu(null)} />}
      {menu && <CreateMenu key={`${menu.x}:${menu.y}`} menu={menu} items={menuItems} onPick={pickMenu} onClose={() => setMenu(null)} />}
    </div>
  );
}

export function CanvasView() {
  return (
    <ReactFlowProvider>
      <Flow />
    </ReactFlowProvider>
  );
}
