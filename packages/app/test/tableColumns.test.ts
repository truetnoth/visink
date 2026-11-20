import { describe, expect, it } from "vitest";
import { INITIAL_COLUMNS, normalizeColumns, resizeColumns } from "../src/tableColumns";

const total = (widths: number[]) => widths.reduce((sum, width) => sum + width, 0);

describe("ширины таблицы переменных", () => {
  it("использует пропорции референса и нормализует старые/некорректные значения", () => {
    expect(total(INITIAL_COLUMNS)).toBeCloseTo(1);
    expect(INITIAL_COLUMNS[3]).toBe(Math.max(...INITIAL_COLUMNS));
    const restored = normalizeColumns([800, -5, Number.NaN, 2000, 20, 10, 1]);
    expect(total(restored)).toBeCloseTo(1);
    expect(restored.every((width) => width > 0)).toBe(true);
  });

  it("перераспределяет место между соседями и ограничивает экстремальный resize", () => {
    const shrunk = resizeColumns(INITIAL_COLUMNS, 1, -100);
    expect(shrunk[1]).toBeCloseTo(0.08);
    expect(shrunk[2]).toBeCloseTo(0.23);
    expect(total(shrunk)).toBeCloseTo(1);

    const grown = resizeColumns(INITIAL_COLUMNS, 3, 100);
    expect(grown[3]).toBeCloseTo(0.4);
    expect(grown[4]).toBeCloseTo(0.07);
    expect(total(grown)).toBeCloseTo(1);
  });

  it("сохраняет сумму 100% и порядок пропорций на очень узком контейнере", () => {
    const resized = resizeColumns(INITIAL_COLUMNS, 2, 0.29);
    expect(total(resized)).toBeCloseTo(1);
    expect(total(resized) * 280).toBeCloseTo(280);
    expect(resized[2]).toBeCloseTo(0.29);
    expect(resized[3]).toBeCloseTo(0.225);
  });
});
