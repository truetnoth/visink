import { create } from "zustand";

/** Настройки этого компьютера, не часть проекта: шрифт карточек, сетка, автосохранение. */
export const AUTOSAVE_OPTIONS = [0, 30, 60, 120, 300] as const;
export type AutosaveSec = (typeof AUTOSAVE_OPTIONS)[number];

export const AUTOSAVE_LABEL: Record<AutosaveSec, string> = { 0: "выключено", 30: "раз в 30 с", 60: "раз в минуту", 120: "раз в 2 мин", 300: "раз в 5 мин" };

export const GRID = 20;
export const FONT_MIN = 10;
export const FONT_MAX = 20;

interface Prefs {
  cardFontSize: number;
  snap: boolean;
  autosaveSec: AutosaveSec;
}

const KEY = "visink-prefs";
const DEFAULTS: Prefs = { cardFontSize: 12, snap: true, autosaveSec: 60 };

function read(): Prefs {
  try {
    const raw = JSON.parse(localStorage.getItem(KEY) ?? "{}");
    const font = Number(raw.cardFontSize);
    return {
      cardFontSize: font >= FONT_MIN && font <= FONT_MAX ? font : DEFAULTS.cardFontSize,
      snap: typeof raw.snap === "boolean" ? raw.snap : DEFAULTS.snap,
      autosaveSec: AUTOSAVE_OPTIONS.includes(raw.autosaveSec) ? raw.autosaveSec : DEFAULTS.autosaveSec,
    };
  } catch {
    return DEFAULTS;
  }
}

export const usePrefs = create<Prefs & { set: (patch: Partial<Prefs>) => void }>()((set, get) => ({
  ...read(),
  set(patch) {
    set(patch);
    const { cardFontSize, snap, autosaveSec } = get();
    try {
      localStorage.setItem(KEY, JSON.stringify({ cardFontSize, snap, autosaveSec }));
    } catch {
      // не запомним — не страшно
    }
  },
}));
