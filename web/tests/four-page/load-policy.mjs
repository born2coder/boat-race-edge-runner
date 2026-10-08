import ts from "typescript";
import { readFile } from "node:fs/promises";
const source = await readFile(
  new URL("../../lib/four-page.ts", import.meta.url),
  "utf8",
);
const js = ts.transpileModule(source, {
  compilerOptions: {
    module: ts.ModuleKind.ESNext,
    target: ts.ScriptTarget.ES2022,
  },
}).outputText;
export const policy = await import(
  "data:text/javascript;base64," + Buffer.from(js).toString("base64")
);
