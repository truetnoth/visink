import type { CheckResult } from "@visink/checker";
import { checkProject } from "@visink/checker";
import type { Project } from "@visink/core";

type Reply = { seq: number; result?: CheckResult; error?: string };
let worker: Worker | null = null;
let broken = false;
let seq = 0;
const waiting = new Map<number, { project: Project; resolve: (r: CheckResult) => void; reject: (e: Error) => void }>();

function getWorker(): Worker | null {
  if (broken || typeof Worker === "undefined") return null;
  if (!worker) {
    try {
      worker = new Worker(new URL("./check.worker.ts", import.meta.url), { type: "module" });
    } catch {
      broken = true;
      return null;
    }
    worker.onmessage = (e: MessageEvent<Reply>) => {
      const job = waiting.get(e.data.seq);
      waiting.delete(e.data.seq);
      if (!job) return;
      if (e.data.result) job.resolve(e.data.result);
      else job.reject(new Error(e.data.error ?? "Проверка не удалась"));
    };
    // воркер не поднялся (старый WebView и т. п.) — дальше проверяем в основном потоке
    worker.onerror = () => {
      broken = true;
      worker?.terminate();
      worker = null;
      for (const [id, job] of waiting) {
        waiting.delete(id);
        try {
          job.resolve(checkProject(job.project));
        } catch (err) {
          job.reject(err as Error);
        }
      }
    };
  }
  return worker;
}

/** Проверка проекта: в браузере — в Worker, без Worker (тесты) — синхронно. */
export function checkInBackground(project: Project): Promise<CheckResult> {
  const w = getWorker();
  if (!w) {
    try {
      return Promise.resolve(checkProject(project));
    } catch (err) {
      return Promise.reject(err);
    }
  }
  const id = ++seq;
  return new Promise((resolve, reject) => {
    waiting.set(id, { project, resolve, reject });
    w.postMessage({ seq: id, project });
  });
}
