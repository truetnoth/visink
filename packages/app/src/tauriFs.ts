// Папка проекта в настольном приложении: файловые команды Rust (packages/desktop/src-tauri/src/lib.rs).
import { invoke, isTauri } from "@tauri-apps/api/core";
import { ask, open } from "@tauri-apps/plugin-dialog";
import type { ProjectFs } from "@visink/core";

export const inTauri = isTauri();

export class TauriFs implements ProjectFs {
  /** абсолютный путь к папке */
  constructor(readonly root: string) {}

  get name() {
    return this.root.split(/[\\/]/).filter(Boolean).pop() ?? this.root;
  }

  readText(path: string) {
    return invoke<string | null>("read_text", { root: this.root, path });
  }

  async readBytes(path: string) {
    const buf = await invoke<ArrayBuffer>("read_bytes", { root: this.root, path });
    return buf.byteLength ? new Uint8Array(buf) : null;
  }

  writeText(path: string, content: string) {
    return invoke<void>("write_text", { root: this.root, path, content });
  }

  remove(path: string) {
    return invoke<void>("remove_file", { root: this.root, path });
  }

  listFiles(dir: string, shallow = false) {
    return invoke<string[]>("list_files", { root: this.root, dir, shallow });
  }
}

export async function pickTauriDirectory(title: string): Promise<string | null> {
  const picked = await open({ directory: true, multiple: false, title });
  return typeof picked === "string" ? picked : null;
}

/** Вопрос да/нет: в приложении — системный диалог, в браузере — confirm. */
export async function askUser(message: string): Promise<boolean> {
  if (inTauri) return ask(message, { title: "Visink", kind: "warning" });
  return confirm(message);
}
