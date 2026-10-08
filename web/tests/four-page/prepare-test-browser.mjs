// Provision the registry's bundled browser without chown inside a user namespace.
import { createRequire } from "node:module";
import { createReadStream, createWriteStream } from "node:fs";
import { chmod, mkdir, stat } from "node:fs/promises";
import { createBrotliDecompress } from "node:zlib";
import { pipeline } from "node:stream/promises";
import { dirname, join } from "node:path";
export async function prepareBrowser(modulePath) {
  const require = createRequire(modulePath),
    tar = require("tar-fs"),
    bin = join(dirname(modulePath), "../bin");
  for (const [file, output, archive] of [
    ["chromium.br", "/tmp/chromium", false],
    ["fonts.tar.br", "/tmp/fonts", true],
    ["swiftshader.tar.br", "/tmp", true],
  ]) {
    if (!archive) {
      try {
        if ((await stat(output)).size > 1000000) continue;
      } catch {}
    } else await mkdir(output, { recursive: true });
    await pipeline(
      createReadStream(join(bin, file)),
      createBrotliDecompress(),
      archive
        ? tar.extract(output, { chown: false })
        : createWriteStream(output, { mode: 0o700 }),
    );
  }
  await chmod("/tmp/chromium", 0o700);
  return "/tmp/chromium";
}
