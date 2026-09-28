import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { apply, AntigravityAdapter, resolveRequestImageTarget, requestImageDimensions } from "../lib/index.js";
import { LlmAdapter } from "@deepseek-ai/dsh-llm";

// Native import catches removed named exports that --check misses.
test("host entry uses target adapter identity", () => {
  assert.ok(new AntigravityAdapter() instanceof LlmAdapter);
});

test("client module uses configForms, drops settingsScope, and registers settings.plugins.tab", async () => {
  const clientCode = await readFile(new URL("../lib/client.js", import.meta.url), "utf8");
  assert.ok(clientCode.includes('"configForms"'));
  assert.ok(!clientCode.includes('"settingsScope"'));
  assert.ok(clientCode.includes('"settings.plugins.tab"'));
  assert.ok(!clientCode.includes('"settings.plugin.item"'));
});

test("resolveRequestImageTarget derives valid integer dimensions and maxBytes", () => {
  const target1 = resolveRequestImageTarget({ width: 1175, height: 568 });
  assert.equal(target1.width, 1175);
  assert.equal(target1.height, 568);
  assert.equal(Number.isSafeInteger(target1.width), true);
  assert.equal(Number.isSafeInteger(target1.height), true);
  assert.equal(Number.isSafeInteger(target1.maxBytes), true);
  assert.ok(target1.maxBytes > 0);

  // Large image scaling down
  const target2 = resolveRequestImageTarget({ width: 4000, height: 3000 }, 2048 * 2048, 1024 * 1024);
  assert.ok(target2.width <= 4000);
  assert.ok(target2.height <= 3000);
  assert.ok(target2.width * target2.height <= 2048 * 2048);
  assert.equal(Number.isSafeInteger(target2.width), true);
  assert.equal(Number.isSafeInteger(target2.height), true);
  assert.equal(target2.maxBytes, 1024 * 1024);

  // Missing or invalid dimensions fallback safely to positive integers
  const target3 = resolveRequestImageTarget({});
  assert.equal(Number.isSafeInteger(target3.width), true);
  assert.equal(Number.isSafeInteger(target3.height), true);
  assert.ok(target3.width > 0);
  assert.ok(target3.height > 0);
});

test("all dsh peerDependencies are pinned to ^0.1.7-rc.2", async () => {
  const pkg = JSON.parse(await readFile(new URL("../package.json", import.meta.url), "utf8"));
  for (const [dep, version] of Object.entries(pkg.peerDependencies)) {
    if (dep.startsWith("@deepseek-ai/dsh-")) {
      assert.equal(version, "^0.1.7-rc.2", `Expected ${dep} to be ^0.1.7-rc.2, got ${version}`);
    }
  }
});


// Route wiring regression only; not a real host/browser authentication test.
for (const rejection of [401, 403, undefined]) {
  test("route trust delegation: " + (rejection ?? "accepted"), async () => {
    let route;
    let checked = false;
    const ctx = {
      inject(names, callback) {
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
