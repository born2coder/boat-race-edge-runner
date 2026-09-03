import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

test("keeps the established BOAT RACE EDGE visual language", async () => {
  const css = await readFile(new URL("../app/globals.css", import.meta.url), "utf8");
  assert.match(css, /--lab-blue:/);
  assert.match(css, /--lab-teal:/);
  assert.match(css, /\.prediction-card/);
  assert.match(css, /@media \(max-width:/);
});
