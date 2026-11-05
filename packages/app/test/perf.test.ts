// Нагрузочный тест: 2000 карточек на одном холсте — compile-time, правка, merge.
import { describe, expect, it } from "vitest";
import { checkProject } from "@visink/checker";
import type { Project } from "@visink/core";
import { createCanvas, createCard, createProject } from "@visink/core";
import { mergeNodes } from "../src/canvasNodes";
import type { Node } from "@xyflow/react";
import { useStore } from "../src/store";

const N = 2000;
/** длина цепочки реплик между развилками условия */
const CHAIN = 10;
const COLS = 40;

/** Проект с одним холстом «big»: n реплик персонажа из проекта по умолчанию, цепочки по CHAIN с развилками, раскладка сеткой. */
function bigProject(n = N): Project {
  const p = createProject("Нагрузочный проект");
  const speaker = p.entities.find((e) => e.kind === "character" && !e.isPlayer)?.id ?? p.entities[0].id;
  const canvas = createCanvas("big", "Большой холст");
  const cards = [];
  for (let i = 0; i < n; i++) {
    // каждая CHAIN-я карточка — условие-развилка, остальные — реплики
    const type = i % CHAIN === CHAIN - 1 ? "condition" : "line";
    const card = createCard(
      `card_${i}`,
      type,
      type === "line" ? { speaker, text: `Реплика №${i}` } : { condition: `card_counter >= ${i}` },
    );
    cards.push(card);
    canvas.layout[card.id] = { x: (i % COLS) * 300, y: Math.floor(i / COLS) * 180 };
  }
  canvas.cards = cards;
  canvas.start = cards[0].id;
  const links = [];
  for (let i = 0; i < n - 1; i++) {
    if (i % CHAIN === CHAIN - 1) {
      // развилка: условие ведёт на следующую карточку (да) и на карточку через одну (нет), если есть
      links.push({ from: cards[i].id, to: cards[i + 1].id, order: 0, kind: "divert" as const, port: "yes" as const });
      const altIndex = Math.min(i + 2, n - 1);
      if (altIndex !== i + 1) links.push({ from: cards[i].id, to: cards[altIndex].id, order: 1, kind: "divert" as const, port: "no" as const });
    } else {
      links.push({ from: cards[i].id, to: cards[i + 1].id, order: 0, kind: "divert" as const });
    }
  }
  canvas.links = links;
  p.variables.vars.push({ name: "card_counter", type: "int", default: 0 });
  p.canvases.big = canvas;
  return p;
}

describe("производительность на 2000 карточек", () => {
  it("checkProject укладывается в 15 с и без ошибок", () => {
    const p = bigProject();
    const start = performance.now();
    const result = checkProject(p);
    const elapsed = performance.now() - start;
    console.log(`checkProject(${N} карточек): ${elapsed.toFixed(0)} мс`);
    expect(result.diagnostics.filter((d) => d.severity === "error")).toEqual([]);
    expect(elapsed).toBeLessThan(15000);
  }, 30000);

  it("правка одной карточки быстрее 50 мс, остальные карточки — те же объекты", () => {
    useStore.getState().openInMemory(bigProject());
    useStore.getState().setActiveCanvas("big");
    const before = useStore.getState().project!;
    const beforeCards = before.canvases.big.cards;

    const start = performance.now();
    useStore.getState().editCanvas((c) => { c.cards[0].text = "Правка"; });
    const elapsed = performance.now() - start;
    console.log(`editCanvas на ${N} карточек: ${elapsed.toFixed(2)} мс`);

    const after = useStore.getState().project!;
    const afterCards = after.canvases.big.cards;
    expect(afterCards[0].text).toBe("Правка");
    for (let i = 1; i < beforeCards.length; i++) expect(afterCards[i]).toBe(beforeCards[i]);
    expect(elapsed).toBeLessThan(50);
  }, 30000);

  it("mergeNodes для 2000 узлов с одним изменённым: новый массив, 1999 элементов те же, быстрее 50 мс", () => {
    const p = bigProject();
    const canvas = p.canvases.big;
    const prev: Node[] = canvas.cards.map((card) => ({
      id: card.id,
      type: "card",
      position: { x: canvas.layout[card.id]?.x ?? 0, y: canvas.layout[card.id]?.y ?? 0 },
      data: { card },
    }));
    const next: Node[] = prev.map((n, i) => (i === 0 ? { ...n, data: { card: { ...canvas.cards[0], text: "Другое" } } } : n));

    const start = performance.now();
    const merged = mergeNodes(prev, next, new Set());
    const elapsed = performance.now() - start;
    console.log(`mergeNodes(${N} узлов): ${elapsed.toFixed(2)} мс`);

    expect(merged).not.toBe(prev);
    expect(merged).toHaveLength(N);
    let same = 0;
    for (let i = 1; i < N; i++) if (merged[i] === prev[i]) same++;
    expect(same).toBe(N - 1);
    expect(elapsed).toBeLessThan(50);
  }, 30000);
});
