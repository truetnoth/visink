// основной компонент холста: react-flow интеграция, меню, drag&drop, копипаст, хоткеи
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { Connection, Edge, Node, OnConnectEnd, OnConnectStart, OnSelectionChangeParams } from "@xyflow/react";
import {
  Background,
  BackgroundVariant,
  MarkerType,
  Panel,
  ReactFlow,
  ReactFlowProvider,
  SelectionMode,
  useEdgesState,
  useNodesState,
  useReactFlow,
} from "@xyflow/react";
import { ArrowRightFromLine, ChevronRight, Code, Flag, GitBranch, Layers, LayoutGrid, Magnet, Maximize, MessageSquare, Repeat, StickyNote, Trash2, User } from "lucide-react";
import type { Card, CardType } from "@visink/core";
import { canvasAtPath, flowCards, isPlayerCard, linkId } from "@visink/core";
import { rootCard } from "@visink/compiler";
import { useStore } from "../store";
import { mergeEdges, mergeNodes } from "../canvasNodes";
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
} from "../ops";
import { GRID, usePrefs } from "../prefs";
import { useTheme } from "../theme";
import { IconButton } from "../ui";
import { COMPACT_W, isTyping, isCompact } from "./constants";
import type { CardData, DraftLink, EdgeData, NoteData, PinPoint } from "./constants";
import { CardNode } from "./CardNode";
import { NoteNode } from "./NoteNode";
import { DraftNode, LogicEdge } from "./LogicEdge";
import { CreateMenu, PinEditor } from "./menus";
import type { MenuItem, MenuState, PinEditorState } from "./menus";

const nodeTypes = { card: CardNode, note: NoteNode, draft: DraftNode };
const edgeTypes = { logic: LogicEdge };

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
  /** Положение поповера от пина: ограничено рамками холста. */
  const popoverAt = (p: PinPoint, w: number, h: number, dx = 12, dy = 0) => {
    const rect = wrapper.current?.getBoundingClientRect();
    return {
      left: Math.max(8, Math.min(p.x - (rect?.left ?? 0) + dx, (rect?.width ?? 400) - w)),
      top: Math.max(8, Math.min(p.y - (rect?.top ?? 0) + dy, (rect?.height ?? 400) - h)),
    };
  };
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
  // неизменённые карточки остаются теми же объектами (см. mergeNodes) — memo не сбрасывается.
  const derivedNodes = useMemo<Node[]>(() => {
    if (!canvas || !project) return [];
    const entities = new Map(project.entities.map((e) => [e.id, e]));
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
          speaker: card.speaker ? entities.get(card.speaker) : undefined,
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
    setNodes((prev) => mergeNodes(prev, derivedNodes, new Set(useStore.getState().selection)));
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
    setEdges((prev) => mergeEdges(prev, derivedEdges, new Set(useStore.getState().selectedLinks)));
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
      {pinPicker && <div className="create-menu pin-count-menu" style={popoverAt(pinPicker, 70, 170)} onContextMenu={(e) => e.preventDefault()}>
        <div className="pin-count-title">Новых связей</div>
        {[1, 2, 3, 4].map((count) => {
          const open = (e: React.MouseEvent<HTMLButtonElement>) => {
            const r = e.currentTarget.getBoundingClientRect();
            openMenu(r.right + 4, r.top, pinPicker.id, pinPicker.port, count, true);
          };
          return <button key={count} className={menu?.from === pinPicker.id && menu.count === count ? "on" : ""} onMouseDown={(e) => e.preventDefault()} onMouseEnter={open} onClick={open}>{count}<ChevronRight size={14} className="submenu-arrow" /></button>;
        })}
      </div>}
      {pinEditor && project && canvas.cards.some((card) => card.id === pinEditor.id) && <div className="pin-editor-wrap" style={popoverAt(pinEditor, 308, 190, 12, 12)} onMouseDown={(e) => e.stopPropagation()}><PinEditor card={canvas.cards.find((card) => card.id === pinEditor.id)!} field={pinEditor.field} project={project} onClose={() => setPinEditor(null)} onCommit={(value) => {
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
