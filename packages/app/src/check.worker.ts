// Проверка проекта (полная компиляция inkjs) вне основного потока.
import { checkProject } from "@visink/checker";
import type { Project } from "@visink/core";

const ctx = self as unknown as Worker;
ctx.onmessage = (e: MessageEvent<{ seq: number; project: Project }>) => {
  const { seq, project } = e.data;
  try {
    ctx.postMessage({ seq, result: checkProject(project) });
  } catch (err) {
    ctx.postMessage({ seq, error: (err as Error).message });
  }
};
