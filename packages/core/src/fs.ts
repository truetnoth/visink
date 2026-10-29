/**
 * Доступ к папке проекта. Пути относительные, через «/».
 * Реализации: браузер (File System Access API), Node (CLI, тесты), позже Tauri.
 */
export interface ProjectFs {
  readText(path: string): Promise<string | null>;
  /** Двоичный файл (портреты); нет файла — null. Не во всех реализациях. */
  readBytes?(path: string): Promise<Uint8Array | null>;
  /** Создаёт недостающие папки. */
  writeText(path: string, content: string): Promise<void>;
  remove(path: string): Promise<void>;
  /** Все файлы под папкой рекурсивно, пути относительно корня. */
  /** Файлы под папкой (пути от корня); shallow — без вложенных папок. */
  listFiles(dir: string, shallow?: boolean): Promise<string[]>;
}

/** ФС в памяти — для тестов и как буфер сборки. */
export class MemoryFs implements ProjectFs {
  files = new Map<string, string>();

  async readText(path: string) {
    return this.files.get(path) ?? null;
  }
  async writeText(path: string, content: string) {
    this.files.set(path, content);
  }
  async remove(path: string) {
    this.files.delete(path);
  }
  async listFiles(dir: string, shallow = false) {
    const prefix = dir ? dir.replace(/\/$/, "") + "/" : "";
    return [...this.files.keys()].filter((p) => p.startsWith(prefix) && !(shallow && p.slice(prefix.length).includes("/"))).sort();
  }
}
