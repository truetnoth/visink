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
import { ArrowRightFromLine, Code, Flag, GitBranch, Maximize, MessageSquare, Repeat, StickyNote, Trash2, User } from "lucide-react";
import type { Card, CardType, Entity } from "@visink/core";
import { isPlayerCard } from "@visink/core";
import { rootCard } from "@visink/compiler";
import { useStore } from "./store";
import { CARD_W, addCard, addNextLine, addNote, addPlayerOption, connect, defaultNpc, deleteCards, deleteLink, nextSpeaker, reorderLinks } from "./ops";
import { usePortrait } from "./portraits";
import { useTheme } from "./theme";
import { IconButton } from "./ui";

type CardData = { card: Card; speaker?: Entity; player: boolean; isStart: boolean; fixedHeight: boolean; problem?: "error" | "warning"; problemText?: string; problemCount?: number };
type NoteData = { id: string; text: string };
type EdgeData = { condition?: string; action?: string; error?: boolean };

export const TYPE_LABEL: Record<CardType, string> = {
  line: "Реплика",
  hub: "Хаб",
  condition: "Условие",
  jump: "Переход",
  ink: "ink",
};

export const TYPE_ICON: Record<CardType, LucideIcon> = {
  line: MessageSquare,
  hub: Repeat,
  condition: GitBranch,
  jump: ArrowRightFromLine,
  ink: Code,
};

/** Цвет шапки служебных карточек; у реплик — цвет спикера. */
const TYPE_COLOR: Record<CardType, string> = {
  line: "var(--service)",
  hub: "var(--service)",
  condition: "#c98a1c",
  jump: "#2a8d96",
  ink: "#56707a",
};

export function isTyping() {
  const el = document.activeElement as HTMLElement | null;
  return !!el && (el.tagName === "INPUT" || el.tagName === "TEXTAREA" || el.tagName === "SELECT" || el.isContentEditable);
}

const FIELD_CLASS = { text: "", menuText: "menu-text", stageDirection: "stage-dir" } as const;

/**
 * Текст на карточке: правится прямо на месте (тот же элемент становится редактируемым),
 * поэтому шрифт, переносы и размер карточки не скачут. Enter — сохранить, Shift+Enter — перенос, Esc — отмена.
 */
const InlineText = memo(function InlineText({
  card,
  field,
  placeholder,
}: {
  card: Card;
  field: "text" | "menuText" | "stageDirection";
  placeholder: string;
}) {
  const [editing, setEditing] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  const clickAt = useRef<{ x: number; y: number } | null>(null);
  const cancelled = useRef(false);
  const editCanvas = useStore((s) => s.editCanvas);
  const value = card[field] ?? "";

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

  const cls = `card-text ${FIELD_CLASS[field]}`;
  if (editing) {
    return (
      <div
        key="edit"
        ref={ref}
        className={`${cls} editing nodrag nowheel`}
        contentEditable="plaintext-only"
        suppressContentEditableWarning
        spellCheck
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
      onDoubleClick={(e) => {
        e.stopPropagation();
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

/** Щелчок по пину — выделить карточку и перейти к логике пина в свойствах. */
function editPin(id: string, field: "condition" | "action") {
  useStore.getState().setSelection([id]);
  setTimeout(() => (document.querySelector(`[data-field="${field}"] input, [data-field="${field}"] textarea`) as HTMLElement | null)?.focus(), 60);
}

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
  const color = card.type === "line" ? speaker?.color ?? "var(--service)" : TYPE_COLOR[card.type];
  const Icon = player ? User : TYPE_ICON[card.type];
  const action = actionLinesOf(card.action);
  // у карточки-условия condition — её вопрос, а не вход
  const gate = card.type !== "condition" ? card.condition?.trim() : "";
  // действие на выходном пине; у условия (два выхода) и перехода (выхода нет) — в теле карточки
  const outPin = card.type === "line" || card.type === "hub" || card.type === "ink";

  // пины считаются от размеров узла: после ресайза и смены полей — пересчитать
  useLayoutEffect(() => updateNodeInternals(id), [id, width, height, fixedHeight, card.type, player, updateNodeInternals]);

  return (
    <div
      className={`card card-${card.type} ${player ? "player" : ""} ${selected ? "selected" : ""} ${fixedHeight ? "fixed-h" : ""}`}
      style={{ ["--speaker" as string]: color }}
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
    >
      {/* края тянутся без выделения: ресайзер появляется при наведении */}
      <NodeResizer
        isVisible={selected || hovered || resizing}
        minWidth={card.type === "line" ? 200 : 160}
        minHeight={card.type === "line" ? 120 : 60}
        lineClassName="card-resize-line"
        handleClassName="card-resize-handle"
        onResizeStart={() => setResizing(true)}
        onResizeEnd={(_, p) => {
          setResizing(false);
          editCanvas((c) => {
            c.layout[card.id] = { x: Math.round(p.x), y: Math.round(p.y), w: Math.round(p.width), h: Math.round(p.height) };
          });
        }}
      />
      <Handle
        type="target"
        position={Position.Left}
        className={`pin ${gate ? "has-logic cond" : ""}`}
        title={gate ? `Условие на входе: ${gate}` : "Вход. Щелчок — условие на входе"}
        onClick={card.type !== "condition" ? () => editPin(card.id, "condition") : undefined}
      />
      {gate && <span className="pin-label in mono">{`{${gate}}`}</span>}
      {problem && (
        <span className={`problem-badge ${problem}`} title={problemText}>
          !{problemCount && problemCount > 1 ? problemCount : ""}
        </span>
      )}
      {/* шапка — вся служебная информация; тело — только литературный текст */}
      <div className="card-head" title={`id: ${card.id}`}>
        {isStart && (
          <span className="chip" title="Начало файла">
            <Flag size={11} />
          </span>
        )}
        <span className="card-type">{card.type === "line" ? speaker?.name ?? "без спикера" : TYPE_LABEL[card.type]}</span>
        {card.entry && <span className="chip mono" title={`Точка входа: ${card.entry}`}>▶ {card.entry}</span>}
        {player && card.repeat === "sticky" && (
          <span className="chip" title="Повторяемый вариант (+)">
            <Repeat size={11} />
          </span>
        )}
        {player && card.repeat === "fallback" && <span className="chip" title="Запасной вариант: срабатывает, когда других нет">запасной</span>}
        {card.status && card.status !== "draft" && <span className={`status-dot ${card.status}`} title={card.status === "final" ? "Финал" : "На вычитке"} />}
        {card.note && (
          <span className="chip" title={card.note}>
            <StickyNote size={11} />
          </span>
        )}
        <Icon size={14} className="card-icon" />
      </div>
      {card.type === "line" ? (
        // как в articy: аватарка и текст на кнопке, ремарка, реплика
        <div className="card-body line-body">
          <div className="card-top">
            <Avatar speaker={speaker} />
            <div className={`card-cell ${player ? "" : "unused"}`} title={player ? undefined : "У реплик NPC текст на кнопке не используется"}>
              <InlineText card={card} field="menuText" placeholder={player ? (card.text ? "в выборе будет реплика" : "текст на кнопке…") : "не используется"} />
            </div>
          </div>
          <div className="card-cell">
            <InlineText card={card} field="stageDirection" placeholder="ремарка…" />
          </div>
          <div className="card-cell grow">
            <InlineText card={card} field="text" placeholder={player ? "(реплика не звучит)" : "двойной щелчок — текст"} />
          </div>
        </div>
      ) : (
        <div className="card-body">
          {card.type === "hub" && <div className="card-text empty">цикл вариантов</div>}
          {card.type === "condition" && <div className="card-text mono">{card.condition || "условие?"}</div>}
          {card.type === "jump" && <div className="card-text mono">→ {card.target || "цель?"}</div>}
          {card.type === "ink" && <pre className="card-text mono">{card.text || "чистый ink"}</pre>}
          {!outPin &&
            action.map((l, i) => (
              <div key={i} className="card-action mono">{l}</div>
            ))}
        </div>
      )}
      {card.type === "condition" ? (
        <>
          <Handle type="source" id="yes" position={Position.Right} style={{ top: "40%" }} className="pin pin-yes" />
          <Handle type="source" id="no" position={Position.Right} style={{ top: "75%" }} className="pin pin-no" />
          <span className="port-label" style={{ top: "calc(40% - 18px)" }}>да</span>
          <span className="port-label" style={{ top: "calc(75% - 18px)" }}>нет</span>
        </>
      ) : outPin ? (
        <>
          <Handle
            type="source"
            position={Position.Right}
            className={`pin ${action.length ? "has-logic act" : ""}`}
            title={action.length ? `Действие на выходе:\n${action.join("\n")}` : "Выход: тяните стрелку. Щелчок — действие"}
            onClick={() => editPin(card.id, "action")}
          />
          {action.length > 0 && <span className="pin-label out mono">{action.length > 1 ? `${action[0]} …` : action[0]}</span>}
        </>
      ) : null}
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

/** Стрелка с логикой: условие и действие подписаны посередине. */
const LogicEdge = memo(function LogicEdge(props: EdgeProps<Edge<EdgeData>>) {
  const { id, data, selected, markerEnd, style } = props;
  const [path, x, y] = getBezierPath(props);
  const { setNodes, setEdges } = useReactFlow();
  const select = () => {
    setNodes((ns) => ns.map((n) => (n.selected ? { ...n, selected: false } : n)));
    setEdges((es) => es.map((e) => (!!e.selected !== (e.id === id) ? { ...e, selected: e.id === id } : e)));
  };
  const cond = data?.condition?.trim();
  const action = actionLinesOf(data?.action);
  return (
    <>
      <BaseEdge id={id} path={path} markerEnd={markerEnd} style={style} interactionWidth={24} />
      {(cond || action.length > 0) && (
        <EdgeLabelRenderer>
          <div
            className={`edge-logic nodrag nopan ${selected ? "selected" : ""} ${data?.error ? "error" : ""}`}
            style={{ transform: `translate(-50%, -50%) translate(${x}px, ${y}px)` }}
            onClick={select}
            onDoubleClick={() => {
              select();
              setTimeout(() => (document.querySelector(".link-props input, .link-props textarea") as HTMLElement | null)?.focus(), 50);
            }}
          >
            {cond && <div className="edge-cond mono">{`{${cond}}`}</div>}
            {action.map((l, i) => (
              <div key={i} className="edge-action mono">{l}</div>
            ))}
          </div>
        </EdgeLabelRenderer>
      )}
    </>
  );
});

const nodeTypes = { card: CardNode, note: NoteNode };
const edgeTypes = { logic: LogicEdge };

/** Пункт меню: создать карточку (type) или выполнить действие (run). */
type MenuItem = { label: string; color?: string; icon: LucideIcon; type?: CardType | "note"; init?: Partial<Card>; run?: () => void };
/** Меню «что вставить»: где открыто (экран, относительно холста), куда ставить карточку и откуда тянется стрелка. */
type MenuState = { x: number; y: number; at: { x: number; y: number }; from?: string; port?: "yes" | "no" };

function CreateMenu({ menu, items, onPick, onClose }: { menu: MenuState; items: MenuItem[]; onPick: (item: MenuItem) => void; onClose: () => void }) {
  const [active, setActive] = useState(0);
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => ref.current?.focus(), []);
  return (
    <div
      ref={ref}
      className="create-menu"
      style={{ left: menu.x, top: menu.y }}
      tabIndex={-1}
      onBlur={(e) => {
        if (!e.currentTarget.contains(e.relatedTarget as globalThis.Node | null)) onClose();
      }}
      onKeyDown={(e) => {
        e.stopPropagation();
        if (e.key === "Escape") onClose();
        else if (e.key === "ArrowDown") setActive((i) => (i + 1) % items.length);
        else if (e.key === "ArrowUp") setActive((i) => (i - 1 + items.length) % items.length);
        else if (e.key === "Enter") onPick(items[active]);
        else if (/^[1-9]$/.test(e.key) && items[Number(e.key) - 1]) onPick(items[Number(e.key) - 1]);
        else return;
        e.preventDefault();
      }}
      onContextMenu={(e) => e.preventDefault()}
    >
      {items.map((item, i) => (
        <button
          key={item.label}
          className={i === active ? "on" : ""}
          onMouseEnter={() => setActive(i)}
          onMouseDown={(e) => e.preventDefault()}
          onClick={() => onPick(item)}
        >
          <item.icon size={15} style={{ color: item.color ?? "var(--service)" }} />
          {item.label}
          {i < 9 && <span className="kbd mono muted">{i + 1}</span>}
        </button>
      ))}
    </div>
  );
}

function Flow() {
  const project = useStore((s) => s.project);
  const key = useStore((s) => s.activeCanvas);
  const selection = useStore((s) => s.selection);
  const check = useStore((s) => s.check);
  const focus = useStore((s) => s.focus);
  const colorMode = useTheme((s) => s.resolved);
  const { editCanvas, setSelection, focusCard } = useStore.getState();
  const { screenToFlowPosition, setCenter, fitView } = useReactFlow();
  const wrapper = useRef<HTMLDivElement>(null);

  const canvas = project && key ? project.canvases[key] : null;

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
        },
      };
    });
    const notes: Node<NoteData>[] = canvas.notes.map((n) => ({
      id: n.id,
      type: "note",
      position: { x: n.x, y: n.y },
      data: { id: n.id, text: n.text },
    }));
    return [...notes, ...cards];
  }, [canvas, project, problems]);

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
    return canvas.links.map((l) => {
      const id = `${l.from}>${l.to}>${l.port ?? ""}`;
      const error = badLinks.has(id);
      return {
        id,
        type: "logic",
        source: l.from,
        target: l.to,
        sourceHandle: l.port ?? null,
        markerEnd: { type: MarkerType.ArrowClosed },
        className: [l.port ? `edge-${l.port}` : "", error ? "edge-error" : ""].join(" ").trim() || undefined,
        data: { condition: l.condition, action: l.action, error },
      };
    });
  }, [canvas, badLinks]);

  const [edges, setEdges, onEdgesChange] = useEdgesState<Edge<EdgeData>>([]);
  useEffect(() => {
    const link = useStore.getState().selectedLink;
    setEdges((prev) => {
      const old = new Map(prev.map((e) => [e.id, e]));
      return derivedEdges.map((e) => ({ ...e, selected: old.has(e.id) ? !!old.get(e.id)!.selected : e.id === link }));
    });
  }, [derivedEdges, setEdges]);

  // стрелку выделили снаружи (поиск, «где используется», проблемы) — отразить на холсте
  const selectedLink = useStore((s) => s.selectedLink);
  useEffect(() => {
    setEdges((prev) =>
      prev.some((e) => !!e.selected !== (e.id === selectedLink)) ? prev.map((e) => (!!e.selected !== (e.id === selectedLink) ? { ...e, selected: e.id === selectedLink } : e)) : prev,
    );
  }, [selectedLink]); // eslint-disable-line react-hooks/exhaustive-deps

  // при смене холста — показать его целиком
  useEffect(() => {
    const t = setTimeout(() => fitView({ padding: 0.2, maxZoom: 1 }), 50);
    return () => clearTimeout(t);
  }, [key, fitView]);

  useEffect(() => {
    if (!focus || focus.canvas !== key) return;
    const t = setTimeout(() => {
      const at = useStore.getState().project?.canvases[focus.canvas]?.layout[focus.card];
      if (at) setCenter(at.x + CARD_W / 2, at.y + 60, { zoom: 1, duration: 300 });
    }, 80);
    return () => clearTimeout(t);
  }, [focus, key, setCenter]);

  const onSelectionChange = useCallback(
    ({ nodes, edges }: OnSelectionChangeParams) =>
      setSelection(
        nodes.map((n) => n.id).sort(),
        !nodes.length && edges.length === 1 ? edges[0].id : null,
      ),
    [setSelection],
  );

  const onConnect = useCallback(
    (c: Connection) => editCanvas((canvas) => connect(canvas, c.source, c.target, (c.sourceHandle as "yes" | "no") || undefined)),
    [editCanvas],
  );

  const [menu, setMenu] = useState<MenuState | null>(null);

  const openMenu = useCallback(
    (clientX: number, clientY: number, from?: string, port?: "yes" | "no") => {
      const rect = wrapper.current?.getBoundingClientRect();
      const at = screenToFlowPosition({ x: clientX, y: clientY - 30 });
      setMenu({
        x: Math.min(clientX - (rect?.left ?? 0), (rect?.width ?? 1e4) - 230),
        y: Math.min(clientY - (rect?.top ?? 0), (rect?.height ?? 1e4) - 300),
        at: { x: Math.round(at.x), y: Math.round(at.y) },
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
    const lines: MenuItem[] = npcs.map((e) => ({ label: `Реплика — ${e.name}`, color: e.color, icon: MessageSquare, type: "line", init: { speaker: e.id } }));
    const option: MenuItem[] = player ? [{ label: "Вариант игрока", color: player.color, icon: User, type: "line", init: { speaker: player.id } }] : [];
    // у карточки уже есть варианты игрока — скорее всего добавляют ещё один
    const hasOptions = !!from && canvas.links.some((l) => {
        const to = l.from === from.id && canvas.cards.find((c) => c.id === l.to);
        return !!to && isPlayerCard(project, to);
      });
    const items = player && (suggested === player.id || hasOptions) ? [...option, ...lines] : [...lines, ...option];
    items.push(
      { label: "Хаб", icon: Repeat, type: "hub" },
      { label: "Условие да/нет", icon: GitBranch, type: "condition" },
      { label: "Переход в другой файл", icon: ArrowRightFromLine, type: "jump" },
      { label: "Чистый ink", icon: Code, type: "ink" },
    );
    if (!menu.from) {
      items.push({ label: "Заметка", icon: StickyNote, type: "note" });
      items.push({ label: "Показать всё (Shift+1)", icon: Maximize, run: () => fitView({ padding: 0.2, maxZoom: 1, duration: 200 }) });
    }
    return items;
  }, [menu, project, canvas, fitView]);

  const pickMenu = useCallback(
    (item: MenuItem) => {
      if (!menu) return;
      setMenu(null);
      if (item.run) return item.run();
      let newId = "";
      editCanvas((canvas) => {
        if (item.type === "note") {
          newId = addNote(canvas, menu.at).id;
          return;
        }
        const card = addCard(canvas, item.type ?? "line", menu.at, item.init);
        if (menu.from) connect(canvas, menu.from, card.id, menu.port);
        newId = card.id;
      });
      if (newId) setSelection([newId]);
      wrapper.current?.focus();
    },
    [menu, editCanvas, setSelection],
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

  const onNodesDelete = useCallback((deleted: Node[]) => editCanvas((c) => deleteCards(c, deleted.map((n) => n.id))), [editCanvas]);
  const onEdgesDelete = useCallback(
    (deleted: Edge[]) => editCanvas((c) => deleted.forEach((e) => deleteLink(c, e.source, e.target, e.sourceHandle ?? undefined))),
    [editCanvas],
  );

  const onNodeClick = useCallback(
    (e: React.MouseEvent, node: Node) => {
      // Ctrl/Cmd + щелчок по переходу — открыть цель
      if (!(e.ctrlKey || e.metaKey) || node.type !== "card") return;
      const card = (node.data as CardData).card;
      if (card.type !== "jump" || !card.target || !project) return;
      const [canvasId, sub] = card.target.split(".");
      const entry = Object.entries(project.canvases).find(([, c]) => c.id === canvasId);
      if (!entry) return;
      const [targetKey, target] = entry;
      const targetCard =
        target.cards.find((c) => c.id === sub || (c.entry && (c.entry === sub || `entry_${c.entry}` === sub))) ?? rootCard(target);
      focusCard(targetKey, targetCard?.id);
    },
    [project, focusCard],
  );

  const createAt = useCallback(
    (type: CardType | "note" | "player", at?: { x: number; y: number }) => {
      const rect = wrapper.current?.getBoundingClientRect();
      const pos =
        at ??
        screenToFlowPosition({
          x: (rect?.left ?? 0) + (rect?.width ?? 800) / 2 - CARD_W / 2,
          y: (rect?.top ?? 0) + (rect?.height ?? 600) / 2 - 40,
        });
      let newId = "";
      editCanvas((canvas, p) => {
        if (type === "note") {
          newId = addNote(canvas, pos).id;
          return;
        }
        if (type === "player") {
          newId = addCard(canvas, "line", pos, { speaker: p.entities.find((e) => e.isPlayer)?.id }).id;
          return;
        }
        const init: Partial<Card> = type === "line" ? { speaker: defaultNpc(p, canvas) } : {};
        newId = addCard(canvas, type, pos, init).id;
      });
      if (newId) setSelection([newId]);
    },
    [editCanvas, screenToFlowPosition, setSelection],
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
      if (isTyping()) return;
      if (e.shiftKey && e.code === "Digit1") {
        e.preventDefault();
        fitView({ padding: 0.2, maxZoom: 1, duration: 200 });
        return;
      }
      const { selection, project, activeCanvas } = useStore.getState();
      if (!selection.length || !project || !activeCanvas) return;
      if ((e.key === "Enter" || e.key === "Tab") && selection.length === 1) {
        e.preventDefault();
        const id = selection[0];
        let newId = "";
        editCanvas((canvas, p) => {
          const card = e.key === "Enter" ? addNextLine(p, canvas, id) : addPlayerOption(p, canvas, id);
          newId = card?.id ?? "";
        });
        if (newId) {
          setSelection([newId]);
          const at = useStore.getState().project?.canvases[activeCanvas]?.layout[newId];
          if (at) setCenter(at.x + CARD_W / 2, at.y + 60, { zoom: 1, duration: 200 });
        }
      }
      if ((e.ctrlKey || e.metaKey) && /^[1-9]$/.test(e.key)) {
        e.preventDefault();
        const speaker = project.entities.filter((x) => x.kind === "character")[Number(e.key) - 1];
        if (speaker) {
          editCanvas((canvas) => {
            for (const c of canvas.cards) if (c.type === "line" && selection.includes(c.id)) c.speaker = speaker.id;
          });
        }
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [editCanvas, setSelection, setCenter]);

  if (!canvas) return <div className="empty-state">Выберите или создайте файл слева</div>;

  return (
    <div className="flow" ref={wrapper} onDoubleClick={onDoubleClick} tabIndex={-1}>
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
        onConnect={onConnect}
        onConnectStart={onConnectStart}
        onConnectEnd={onConnectEnd}
        onNodeDragStop={onNodeDragStop}
        onNodesDelete={onNodesDelete}
        onEdgesDelete={onEdgesDelete}
        onNodeClick={onNodeClick}
        onPaneContextMenu={onPaneContextMenu}
        onPaneClick={() => {
          setMenu(null);
          setCardMenu(null);
          useStore.getState().clearInspector();
        }}
        proOptions={{ hideAttribution: true }}
        zoomOnDoubleClick={false}
        snapToGrid
        snapGrid={[20, 20]}
        deleteKeyCode={["Delete", "Backspace"]}
        // протянуть по пустому месту — рамка выделения; холст двигают Cmd/Ctrl, средняя кнопка и два пальца
        selectionOnDrag
        panOnDrag={[1]}
        panActivationKeyCode={["Meta", "Control"]}
        panOnScroll
        zoomOnScroll={false}
        zoomOnPinch
        // Shift или Cmd/Ctrl + щелчок — добавить к выделению; Cmd/Ctrl + протянуть по пустому — двигать холст
        multiSelectionKeyCode={["Shift", "Meta", "Control"]}
        minZoom={0.1}
        colorMode={colorMode}
      >
        <Background variant={BackgroundVariant.Lines} gap={20} />
        <Panel position="top-left" className="palette">
          <IconButton icon={MessageSquare} label="Реплика (или двойной щелчок по пустому месту)" onClick={() => createAt("line")} />
          <IconButton icon={User} label="Вариант игрока" onClick={() => createAt("player")} />
          <IconButton icon={Repeat} label="Хаб — цикл вариантов" onClick={() => createAt("hub")} />
          <IconButton icon={GitBranch} label="Условие да/нет" onClick={() => createAt("condition")} />
          <IconButton icon={ArrowRightFromLine} label="Переход в другой файл" onClick={() => createAt("jump")} />
          <IconButton icon={Code} label="Чистый ink" onClick={() => createAt("ink")} />
          <IconButton icon={StickyNote} label="Заметка (не попадает в ink)" onClick={() => createAt("note")} />
        </Panel>
      </ReactFlow>
      {cardMenu && canvas && (
        <CreateMenu
          key={`card:${cardMenu.id}`}
          menu={{ x: cardMenu.x, y: cardMenu.y, at: { x: 0, y: 0 } }}
          items={[
            {
              label: canvas.start === cardMenu.id ? "Уже начало файла" : "Сделать началом файла",
              icon: Flag,
              run: () => editCanvas((c) => (c.start = cardMenu.id)),
            },
            ...(canvas.layout[cardMenu.id]?.w != null
              ? [
                  {
                    label: "Вернуть автоматический размер",
                    icon: Maximize,
                    run: () =>
                      editCanvas((c) => {
                        const { x, y } = c.layout[cardMenu.id];
                        c.layout[cardMenu.id] = { x, y };
                      }),
                  },
                ]
              : []),
            {
              label: "Удалить карточку",
              icon: Trash2,
              run: () => {
                editCanvas((c) => deleteCards(c, [cardMenu.id]));
                setSelection([]);
              },
            },
          ]}
          onPick={(item) => {
            setCardMenu(null);
            item.run?.();
          }}
          onClose={() => setCardMenu(null)}
        />
      )}
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
