// всплывающие меню холста: создание карточки (1–9), редактор условия/действия на пине
import { useEffect, useRef, useState } from "react";
import type { LucideIcon } from "lucide-react";
import { ChevronRight } from "lucide-react";
import type { Card, CardType, Project } from "@visink/core";
import { CodeInput } from "../ui";

export type MenuItem = { label: string; color?: string; icon: LucideIcon; type?: CardType | "note"; init?: Partial<Card>; run?: () => void; children?: MenuItem[] };
export type MenuState = { x: number; y: number; at: { x: number; y: number }; from?: string; port?: "yes" | "no"; count?: number };
export type PinEditorState = { id: string; field: "condition" | "action"; x: number; y: number };

export function CreateMenu({ menu, items, onPick, onClose }: { menu: MenuState; items: MenuItem[]; onPick: (item: MenuItem) => void; onClose: () => void }) {
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

export function PinEditor({ card, field, project, onCommit, onClose }: { card: Card; field: "condition" | "action"; project: Project; onCommit: (value: string) => void; onClose: () => void }) {
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
