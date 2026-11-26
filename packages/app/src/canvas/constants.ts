// общие константы и типы для холста: подписи/иконки/цвета типов карточек, компактность, хелперы
import type { LucideIcon } from "lucide-react";
import { ArrowRightFromLine, Code, GitBranch, Layers, LogIn, LogOut, MessageSquare, Repeat } from "lucide-react";
import type { Card, CardType, Entity, TextSpan } from "@visink/core";

export type PinPoint = { x: number; y: number };
export type CardData = { card: Card; targetLabel?: string; speaker?: Entity; player: boolean; fixedHeight: boolean; problem?: "error" | "warning"; problemText?: string; problemCount?: number; onPin: (id: string, field: "condition" | "action", point: PinPoint) => void; onBranch: (id: string, port: "yes" | "no" | undefined, point: PinPoint) => void; onNavigate: (target?: string) => boolean };
export type NoteData = { id: string; text: string; color?: string; formatting?: TextSpan[] };
export type EdgeData = { condition?: string; action?: string; error?: boolean; draft?: boolean };
export type DraftLink = { id: string; from: string; port?: "yes" | "no"; x: number; y: number };

export const TYPE_LABEL: Record<CardType, string> = {
  line: "Реплика",
  hub: "Хаб",
  condition: "Условие",
  jump: "Переход",
  flow: "Вложенность",
  entry: "Вход",
  exit: "Выход",
  ink: "ink",
};

export const TYPE_ICON: Record<CardType, LucideIcon> = {
  line: MessageSquare,
  hub: Repeat,
  condition: GitBranch,
  jump: ArrowRightFromLine,
  flow: Layers,
  entry: LogIn,
  exit: LogOut,
  ink: Code,
};

/** Цвет шапки служебных карточек; у реплик — цвет спикера. */
export const TYPE_COLOR: Record<CardType, string> = {
  line: "var(--service)",
  hub: "var(--service)",
  condition: "#c98a1c",
  jump: "#2a8d96",
  flow: "#7464a8",
  entry: "#2e9e5b",
  exit: "#7b8494",
  ink: "#56707a",
};
export const COMPACT_W: Partial<Record<CardType, number>> = { hub: 180, entry: 150, exit: 150 };
/** Компактные карточки: без тела и без запроса на ввод при создании. */
export const isCompact = (type?: string) => type === "hub" || type === "entry" || type === "exit";
/** Порог «щелчок, а не протяжка» для выходного пина. */
export const CLICK_MS = 240;

export function isTyping() {
  const el = document.activeElement as HTMLElement | null;
  return !!el && (el.tagName === "INPUT" || el.tagName === "TEXTAREA" || el.tagName === "SELECT" || el.isContentEditable);
}
