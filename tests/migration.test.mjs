import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { apply, AntigravityAdapter } from "../lib/index.js";
import { LlmAdapter } from "@deepseek-ai/dsh-llm";

// Native import catches removed named exports that --check misses.
test("host entry uses target adapter identity", () => {
  assert.ok(new AntigravityAdapter() instanceof LlmAdapter);
});

test("manifest declares split session owner and target peers", async () => {
  const pkg = JSON.parse(await readFile(new URL("../package.json", import.meta.url), "utf8"));
  assert.equal(pkg.peerDependencies["@deepseek-ai/cordis"], "^4.0.1");
  assert.ok(pkg.dsh.client.inject.includes("@deepseek-ai/dsh-api-session-controller"));
  assert.ok(!JSON.stringify(pkg).includes(["@deepseek-ai/dsh-client", "runtime"].join("-")));
  for (const name of pkg.dsh.client.inject) assert.equal(pkg.peerDependencies[name], "^0.1.5-rc.2");
});

// Route wiring regression only; not a real host/browser authentication test.
for (const rejection of [401, 403, undefined]) {
  test("route trust delegation: " + (rejection ?? "accepted"), async () => {
    let route;
    let checked = false;
    const ctx = {
      inject(names, callback) {
        if (names.includes("settings")) return;
        assert.deepEqual(names, ["webServer", "connection"]);
        callback({
          effect: (factory) => factory(),
          webServer: { register(value) { route = value; return () => {}; } },
          connection: { requestRejection(request) { checked = true; assert.equal(request.method, "GET"); return rejection; } },
        });
      },
      llm: { registerAdapter() {} },
    };
    apply(ctx);
    const response = {
      writeHead(status) { this.status = status; },
      end(body) { this.body = JSON.parse(body); },
    };
    await route.handler({ method: "GET", url: "/antigravity/api/not-found", headers: {} }, response);
    assert.equal(checked, true);
    assert.equal(response.status, rejection ?? 404);
    assert.equal(response.body.error, rejection === 401 ? "unauthorized" : rejection === 403 ? "forbidden" : "not-found");
  });
}
