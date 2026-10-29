import { create } from "zustand";

export type ThemeMode = "system" | "light" | "dark";

const KEY = "visink-theme";
const media = window.matchMedia("(prefers-color-scheme: dark)");

function readMode(): ThemeMode {
  try {
    const v = localStorage.getItem(KEY);
    if (v === "light" || v === "dark") return v;
  } catch {
    // хранилище недоступно — тема как в системе
  }
  return "system";
}

function resolve(mode: ThemeMode): "light" | "dark" {
  return mode === "system" ? (media.matches ? "dark" : "light") : mode;
}

function apply(mode: ThemeMode) {
  const root = document.documentElement;
  if (mode === "system") root.removeAttribute("data-theme");
  else root.dataset.theme = mode;
}

interface ThemeState {
  mode: ThemeMode;
  /** фактическая тема — для React Flow */
  resolved: "light" | "dark";
  setMode: (mode: ThemeMode) => void;
}

export const useTheme = create<ThemeState>()((set) => ({
  mode: readMode(),
  resolved: resolve(readMode()),
  setMode(mode) {
    try {
      if (mode === "system") localStorage.removeItem(KEY);
      else localStorage.setItem(KEY, mode);
    } catch {
      // не запомним — не страшно
    }
    apply(mode);
    set({ mode, resolved: resolve(mode) });
  },
}));

apply(useTheme.getState().mode);
media.addEventListener("change", () => {
  const { mode } = useTheme.getState();
  useTheme.setState({ resolved: resolve(mode) });
});
