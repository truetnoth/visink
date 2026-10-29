function sortDeep(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(sortDeep);
  if (value && typeof value === "object") {
    const out: Record<string, unknown> = {};
    for (const key of Object.keys(value).sort()) {
      const v = (value as Record<string, unknown>)[key];
      if (v !== undefined) out[key] = sortDeep(v);
    }
    return out;
  }
  return value;
}

/** JSON с отсортированными ключами: одинаковые данные — одинаковый файл, читаемые диффы в git. */
export function stableStringify(value: unknown): string {
  return JSON.stringify(sortDeep(value), null, 2) + "\n";
}
