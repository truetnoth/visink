import { expect, it } from "vitest";
import { checkInBackground } from "../src/checkClient";
import { demoProject } from "../../checker/test/fixtures";

it("без Worker (node) проверяет синхронно и отдаёт результат сборки", async () => {
  const r = await checkInBackground(demoProject());
  expect(r.storyJson).toBeTruthy();
  expect(r.build.files.has("advisor.ink")).toBe(true);
});
