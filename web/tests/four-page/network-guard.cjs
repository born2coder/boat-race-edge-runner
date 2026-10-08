// Test-only egress guard, inherited by Next workers. No production credentials.
/* eslint-disable @typescript-eslint/no-require-imports -- Node --require preloader must use CommonJS. */
const { appendFileSync } = require("node:fs");
function allow(input) {
  const url = new URL(
    typeof input === "string"
      ? input
      : input instanceof URL
        ? input.href
        : input.url,
  );
  if (["localhost", "127.0.0.1", "[::1]"].includes(url.hostname)) return;
  const msg = "Blocked isolated-test external request: " + url.hostname;
  if (process.env.FOUR_PAGE_NETWORK_LOG)
    appendFileSync(process.env.FOUR_PAGE_NETWORK_LOG, msg + "\n");
  throw new Error(msg);
}
const originalFetch = globalThis.fetch;
globalThis.fetch = (input, ...args) => {
  allow(input);
  return originalFetch(input, ...args);
};
for (const name of ["node:http", "node:https"]) {
  const mod = require(name),
    request = mod.request,
    get = mod.get;
  const inspect = (args) => {
    const first = args[0];
    if (typeof first === "string" || first instanceof URL) allow(first);
    else {
      const host = first.hostname || first.host || "localhost";
      if (!["localhost", "127.0.0.1", "::1"].includes(host))
        throw new Error("Blocked isolated-test external HTTP request");
    }
  };
  mod.request = function (...args) {
    inspect(args);
    return request.apply(this, args);
  };
  mod.get = function (...args) {
    inspect(args);
    return get.apply(this, args);
  };
}
