// Пересоздаёт examples/demo.visink из фикстуры тестов и собирает его в build/narrative.
// Запуск: npm run demo
import { mkdir, readFile, readdir, rm, writeFile } from "node:fs/promises";
import { dirname, join, relative } from "node:path";
import type { ProjectFs } from "@visink/core";
import { saveProject, writeBuild } from "@visink/core";
import { checkProject } from "@visink/checker";
import { demoProject } from "../packages/checker/test/fixtures";

class NodeFs implements ProjectFs {
  constructor(readonly root: string) {}
  async readText(path: string) {
    try {
      return await readFile(join(this.root, path), "utf8");
    } catch {
      return null;
    }
  }
  async writeText(path: string, content: string) {
    await mkdir(dirname(join(this.root, path)), { recursive: true });
    await writeFile(join(this.root, path), content);
  }
  async remove(path: string) {
    await rm(join(this.root, path), { force: true });
  }
  async listFiles(dir: string, shallow = false) {
    const out: string[] = [];
    const walk = async (abs: string) => {
      for (const e of await readdir(abs, { withFileTypes: true }).catch(() => [])) {
        const p = join(abs, e.name);
        if (e.isDirectory()) {
          if (!shallow) await walk(p);
        }
        else out.push(relative(this.root, p));
      }
    };
    await walk(join(this.root, dir));
    return out.sort();
  }
}

const root = join(import.meta.dirname, "..", "examples", "demo.visink");
const fs = new NodeFs(root);
const project = demoProject();
await saveProject(fs, project);
const check = checkProject(project);
const errors = check.diagnostics.filter((d) => d.severity === "error");
if (errors.length) {
  console.error(errors);
  process.exit(1);
}
await writeBuild(fs, project.settings.buildDir, check.build.files);
console.log(`Демо: ${root}`);
for (const d of check.diagnostics) console.log(`  ${d.severity}: ${d.canvas ?? ""} ${d.card ?? ""} ${d.message}`);
