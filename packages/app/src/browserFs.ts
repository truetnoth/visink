import type { ProjectFs } from "@visink/core";

declare global {
  interface Window {
    showDirectoryPicker?: (options?: { mode?: "read" | "readwrite"; id?: string }) => Promise<FileSystemDirectoryHandle>;
  }
}

export const fsAccessSupported = typeof window !== "undefined" && "showDirectoryPicker" in window;

export async function pickDirectory(id: string): Promise<FileSystemDirectoryHandle | null> {
  if (!window.showDirectoryPicker) throw new Error("Браузер не умеет открывать папки — нужен Chrome или Edge");
  try {
    return await window.showDirectoryPicker({ mode: "readwrite", id });
  } catch (e) {
    if ((e as DOMException).name === "AbortError") return null;
    throw e;
  }
}

/** Папка проекта через File System Access API. Завтра рядом появится реализация для Tauri. */
export class BrowserFs implements ProjectFs {
  constructor(readonly root: FileSystemDirectoryHandle) {}

  get name() {
    return this.root.name;
  }

  private async dir(parts: string[], create: boolean): Promise<FileSystemDirectoryHandle> {
    let d = this.root;
    for (const p of parts) if (p) d = await d.getDirectoryHandle(p, { create });
    return d;
  }

  private split(path: string): [string[], string] {
    const parts = path.split("/").filter(Boolean);
    const name = parts.pop() ?? "";
    return [parts, name];
  }

  async readText(path: string) {
    try {
      const [parts, name] = this.split(path);
      const file = await (await this.dir(parts, false)).getFileHandle(name);
      return await (await file.getFile()).text();
    } catch {
      return null;
    }
  }

  async readBytes(path: string) {
    try {
      const [parts, name] = this.split(path);
      const file = await (await this.dir(parts, false)).getFileHandle(name);
      return new Uint8Array(await (await file.getFile()).arrayBuffer());
    } catch {
      return null;
    }
  }

  async writeText(path: string, content: string) {
    const [parts, name] = this.split(path);
    const file = await (await this.dir(parts, true)).getFileHandle(name, { create: true });
    const w = await file.createWritable();
    await w.write(content);
    await w.close();
  }

  async remove(path: string) {
    try {
      const [parts, name] = this.split(path);
      await (await this.dir(parts, false)).removeEntry(name);
    } catch {
      // уже нет
    }
  }

  async listFiles(dir: string, shallow = false) {
    const out: string[] = [];
    const walk = async (handle: FileSystemDirectoryHandle, prefix: string) => {
      for await (const [name, entry] of handle.entries()) {
        const path = prefix ? `${prefix}/${name}` : name;
        if (entry.kind === "directory") {
          if (!shallow) await walk(entry as FileSystemDirectoryHandle, path);
        } else out.push(path);
      }
    };
    try {
      const parts = dir.split("/").filter(Boolean);
      await walk(await this.dir(parts, false), parts.join("/"));
    } catch {
      // папки нет
    }
    return out.sort();
  }
}
