// Портреты персонажей: картинка из папки проекта → object URL, по одному разу на файл.
import { useEffect, useState } from "react";
import type { ProjectFs } from "@visink/core";
import { useStore } from "./store";

const MIME: Record<string, string> = { png: "image/png", jpg: "image/jpeg", jpeg: "image/jpeg", webp: "image/webp", gif: "image/gif", svg: "image/svg+xml" };

/** Кэш на открытую папку: новая папка — новый кэш. */
const cache = new WeakMap<ProjectFs, Map<string, Promise<string | null>>>();

function load(fs: ProjectFs, path: string): Promise<string | null> {
  let files = cache.get(fs);
  if (!files) cache.set(fs, (files = new Map()));
  let url = files.get(path);
  if (!url) {
    const type = MIME[path.split(".").pop()?.toLowerCase() ?? ""];
    url = (fs.readBytes?.(path) ?? Promise.resolve(null))
      .then((bytes) => (bytes && type ? URL.createObjectURL(new Blob([bytes], { type })) : null))
      .catch(() => null);
    files.set(path, url);
  }
  return url;
}

/** URL картинки или null, пока не загрузилась, нет файла или формат не картинка. */
export function usePortrait(path: string | undefined): string | null {
  const fs = useStore((s) => s.fs);
  const [url, setUrl] = useState<string | null>(null);
  useEffect(() => {
    setUrl(null);
    if (!fs || !path?.trim()) return;
    let live = true;
    load(fs, path.trim()).then((u) => live && setUrl(u));
    return () => {
      live = false;
    };
  }, [fs, path]);
  return url;
}
