import { flowCards, isValidInkName, syncEntries, type Project } from '@visink/core';

/** Keep project-local jumps valid when an additional entry is renamed or cleared. */
export function setCardEntry(project: Project, key: string, id: string, value: string) {
  const root = project.canvases[key];
  const found = root && flowCards(root).find(({ card }) => card.id === id);
  if (!found) throw new Error('Карточка не найдена');
  value = value.trim();
  if (value && !isValidInkName(value)) throw new Error('Используйте латиницу, цифры и подчёркивание; начните с буквы или подчёркивания');
  const all = flowCards(root);
  if (value && all.some(({ card }) => card.id !== id && card.entry === value || card.id === `entry_${value}`)) throw new Error('Это имя точки входа уже занято');
  const old = found.card.entry;
  if (old === value || !old && !value) return;
  if (old) {
    const addresses = new Set([`${root.id}.entry_${old}`, `${root.id}.${old}`]);
    const next = value ? `${root.id}.entry_${value}` : `${root.id}.${id}`;
    for (const canvas of Object.values(project.canvases)) for (const { card } of flowCards(canvas)) {
      if (card.target && addresses.has(card.target)) card.target = next;
    }
    if (project.settings.start && addresses.has(project.settings.start)) project.settings.start = next;
  }
  if (value) found.card.entry = value; else delete found.card.entry;
  found.canvas.entries = syncEntries(found.canvas).entries;
}
