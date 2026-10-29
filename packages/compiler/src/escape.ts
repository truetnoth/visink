/**
 * Экранирование обычного текста под ink. Сценарист пишет как есть,
 * а служебные символы ink получают обратную косую черту.
 */
export function escapeInkText(raw: string): string {
  let s = raw.replace(/\r?\n+/g, " ").trim();
  s = s.replace(/\\/g, "\\\\");
  s = s.replace(/[#{}[\]|]/g, (ch) => "\\" + ch);
  s = s.replace(/\/\//g, "/\\/").replace(/\/\*/g, "/\\*");
  s = s.replace(/->/g, "\\->").replace(/<-/g, "\\<-").replace(/<>/g, "\\<>");
  // служебные знаки и TODO: в начале строки
  if (/^[*+\-=~(]/.test(s) || /^TODO:/.test(s)) s = "\\" + s;
  return s;
}

/** Значение тега: одна строка, без символов, которые ink воспримет как разметку. */
export function escapeTagValue(raw: string): string {
  return escapeInkText(raw.replace(/#/g, ""));
}
