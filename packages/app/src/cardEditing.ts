import { flowCards, isValidInkName, rebaseSpans, syncEntries, withTextSpans, type Card, type Project } from '@visink/core';
import { mapStoryText } from '@visink/compiler';

export function rewriteCardExpression(
  project: Project,
  card: Card,
  field: 'text' | 'menuText',
  transform: (expression: string) => string,
) {
  const text = card[field];
  if (!text) return;
  let current = text;
  let spans = card.formatting?.[field];
  const updated = mapStoryText(project, text, transform, {
    localNames: card.inputs?.map((input) => input.name),
    onReplace: spans?.length ? ({ start, end }, replacement) => {
      const offset = current.length - text.length;
      const next = current.slice(0, start + offset) + replacement + current.slice(end + offset);
      spans = rebaseSpans(spans, current, next);
      current = next;
    } : undefined,
  });
  if (updated === text) return;
  card[field] = updated;
  if (spans) card.formatting = withTextSpans(card.formatting, field, spans);
}

/** Keep project-local jumps valid when an additional entry is renamed or cleared. */
export function setCardEntry(project: Project, key: string, id: string, value: string) {
  const root = project.canvases[key];
  const found = root && flowCards(root).find(({ card }) => card.id === id);
  if (!found) throw new Error('Карточка не найдена');
  value = value.trim();
  if (value && !isValidInkName(value)) throw new Error('Используйте латиницу, цифры и подчёркивание; начните с буквы или подчёркивания');
  const all = flowCards(root).filter((item) => item.canvas.legacyId === found.canvas.legacyId);
  if (value && all.some(({ card }) => card.id !== id && card.entry === value || card.id === `entry_${value}`)) throw new Error('Это имя точки входа уже занято');
  const old = found.card.entry;
  if (old === value || !old && !value) return;
  if (old) {
    const address = found.canvas.legacyId ?? found.canvas.id;
    const addresses = new Set([`${address}.entry_${old}`, `${address}.${old}`]);
    const next = value ? `${address}.entry_${value}` : `${address}.${id}`;
    for (const canvas of Object.values(project.canvases)) for (const { card } of flowCards(canvas)) {
      if (card.target && addresses.has(card.target)) card.target = next;
    }
    if (project.settings.start && addresses.has(project.settings.start)) project.settings.start = next;
  }
  if (value) found.card.entry = value; else delete found.card.entry;
  found.canvas.entries = syncEntries(found.canvas).entries;
}
