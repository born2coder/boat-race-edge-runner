// Exercise built pages in the package scope used by Vercel's CommonJS launcher.
import assert from "node:assert/strict";
import { cp, mkdtemp, readFile, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { spawnSync } from "node:child_process";

const root = fileURLToPath(new URL("../../", import.meta.url));
const temp = await mkdtemp(join(tmpdir(), "boat-vercel-launcher-"));
const pkg = JSON.parse(await readFile(join(root, "package.json"), "utf8"));
const env = { ...process.env, NEXT_TELEMETRY_DISABLED: "1" };
for (const key of Object.keys(env)) {
  if (/^(SUPABASE|VERCEL|RESEARCH|INGEST|NEXT_PUBLIC|FOUR_PAGE_FIXTURE|FOUR_PAGE_ISOLATED)/.test(key)) delete env[key];
}
env.NODE_OPTIONS = "--require " + join(root, "tests/four-page/network-guard.cjs");
try {
  // Vercel loads traced server bundles without Next's intermediate package.json.
  await cp(join(root, ".next/server"), join(temp, ".next/server"), { recursive: true });
  await symlink(join(root, "node_modules"), join(temp, "node_modules"), "dir");
  const load = (route) => spawnSync(process.execPath,
    ["--no-experimental-require-module", "--conditions=react-server", "-e", `require('./.next/server/app/${route}/page.js');`],
    { cwd: temp, env, encoding: "utf8" });
  await writeFile(join(temp, "package.json"), JSON.stringify({ ...pkg, type: "module" }));
  const negative = load("performance");
  assert.notEqual(negative.status, 0);
  assert.match(negative.stderr, /ERR_REQUIRE_ESM/);
  console.log("PASS: previous module scope reproduces Vercel ERR_REQUIRE_ESM");
  await writeFile(join(temp, "package.json"), JSON.stringify(pkg));
  for (const route of ["today", "signal-log", "performance", "settings", "research-archive/performance"]) {
    const result = load(route);
    assert.equal(result.status, 0, result.stderr);
    console.log("PASS: CommonJS launcher loads built /" + route);
  }
} finally {
  await rm(temp, { recursive: true, force: true });
}
