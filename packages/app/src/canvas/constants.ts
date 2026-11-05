// общие константы и типы для холста: подписи/иконки/цвета типов карточек, компактность, хелперы
import type { LucideIcon } from "lucide-react";
import { ArrowRightFromLine, Code, GitBranch, Layers, MessageSquare, Repeat } from "lucide-react";
import type { Card, CardType, Entity } from "@visink/core";

export type PinPoint = { x: number; y: number };
export type CardData = { card: Card; speaker?: Entity; player: boolean; isStart: boolean; fixedHeight: boolean; problem?: "error" | "warning"; problemText?: string; problemCount?: number; onPin: (id: string, field: "condition" | "action", point: PinPoint) => void; onBranch: (id: string, port: "yes" | "no" | undefined, point: PinPoint) => void };
export type NoteData = { id: string; text: string };
export type EdgeData = { condition?: string; action?: string; error?: boolean; draft?: boolean };
export type DraftLink = { id: string; from: string; port?: "yes" | "no"; x: number; y: number };

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
export const TYPE_COLOR: Record<CardType, string> = {
  line: "var(--service)",
  hub: "var(--service)",
  condition: "#c98a1c",
  jump: "#2a8d96",
  flow: "#7464a8",
  ink: "#56707a",
};
export const COMPACT_W: Partial<Record<CardType, number>> = { hub: 180, jump: 220 };
/** Компактные карточки (хаб, переход): без тела и без запроса на ввод при создании. */
export const isCompact = (type?: string) => type === "hub" || type === "jump";
/** Порог «щелчок, а не протяжка» для выходного пина. */
export const CLICK_MS = 240;

export function isTyping() {
  const el = document.activeElement as HTMLElement | null;
  return !!el && (el.tagName === "INPUT" || el.tagName === "TEXTAREA" || el.tagName === "SELECT" || el.isContentEditable);
}
