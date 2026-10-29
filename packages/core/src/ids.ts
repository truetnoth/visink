const ALPHABET = "0123456789abcdefghijklmnopqrstuvwxyz";

function randomSuffix(len: number): string {
  const bytes = new Uint8Array(len);
  crypto.getRandomValues(bytes);
  let out = "";
  for (const b of bytes) out += ALPHABET[b % ALPHABET.length];
  return out;
}

/** Короткий постоянный id карточки, он же имя стежка в ink. */
export function newCardId(taken: Iterable<string>): string {
  const used = new Set(taken);
  for (;;) {
    const id = "c" + randomSuffix(5);
    if (!used.has(id)) return id;
  }
}

export function newNoteId(taken: Iterable<string>): string {
  const used = new Set(taken);
  for (;;) {
    const id = "n" + randomSuffix(5);
    if (!used.has(id)) return id;
  }
}

const INK_NAME = /^[A-Za-z_][A-Za-z0-9_]*$/;

/** Имя, допустимое для узла, стежка или переменной ink. */
export function isValidInkName(name: string): boolean {
  return INK_NAME.test(name);
}

/** Превращает произвольный заголовок в имя для ink: «Декан Левенгаупт» → dekan_levengaupt. */
export function toInkName(title: string): string {
  const map: Record<string, string> = {
    а: "a", б: "b", в: "v", г: "g", д: "d", е: "e", ё: "e", ж: "zh", з: "z", и: "i", й: "y",
    к: "k", л: "l", м: "m", н: "n", о: "o", п: "p", р: "r", с: "s", т: "t", у: "u", ф: "f",
    х: "h", ц: "ts", ч: "ch", ш: "sh", щ: "sch", ъ: "", ы: "y", ь: "", э: "e", ю: "yu", я: "ya",
  };
  let s = "";
  for (const ch of title.toLowerCase()) s += map[ch] ?? ch;
  s = s.replace(/[^a-z0-9_]+/g, "_").replace(/^_+|_+$/g, "").replace(/_+/g, "_");
  if (!s) s = "canvas";
  if (/^[0-9]/.test(s)) s = "_" + s;
  return s;
}
