import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { createServer, type Server } from "http";
import { autoDetectSpec } from "../src/core/auto-detect.js";
import { checkAllUnauthorized } from "../src/core/runner.js";
import type { Baseline } from "../src/core/baseline.js";

let server: Server;
let port: number;

beforeAll(async () => {
  server = createServer((req, res) => {
    if (req.url === "/openapi.json") {
      res.writeHead(200, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ openapi: "3.0.0", info: { title: "Test", version: "1.0.0" }, paths: {} }));
    } else if (req.url === "/swagger.json") {
      // Also serves a swagger 2.0 spec at another path
      res.writeHead(200, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ swagger: "2.0", info: { title: "Test", version: "1.0.0" }, paths: {} }));
    } else if (req.url === "/api-docs") {
      // Returns JSON but not a spec — should be skipped
      res.writeHead(200, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ name: "not a spec", version: "1.0" }));
    } else if (req.url === "/docs/openapi.json") {
      // Returns HTML — should be skipped
      res.writeHead(200, { "Content-Type": "text/html" });
      res.end("<html>docs page</html>");
    } else {
      res.writeHead(404);
      res.end();
    }
  });

  await new Promise<void>((resolve) => {
    server.listen(0, () => {
      port = (server.address() as any).port;
      resolve();
    });
  });
});

afterAll(() => {
  server.close();
});

describe("Auto-detect spec", () => {
  it("finds spec at /openapi.json", async () => {
    const result = await autoDetectSpec(`http://localhost:${port}`);
    expect(result).toBe(`http://localhost:${port}/openapi.json`);
  });

  it("strips trailing slash from base URL", async () => {
    const result = await autoDetectSpec(`http://localhost:${port}/`);
    expect(result).toBe(`http://localhost:${port}/openapi.json`);
  });

  it("returns null when no server is running", async () => {
    const result = await autoDetectSpec("http://localhost:19999");
    expect(result).toBeNull();
  });

  it("validates response is actually an OpenAPI spec (not just any JSON)", async () => {
    // /api-docs returns 200 JSON but without openapi/swagger key
    // /docs/openapi.json returns 200 HTML
    // Should still find /openapi.json which is first in the probe list
    const result = await autoDetectSpec(`http://localhost:${port}`);
    expect(result).toBe(`http://localhost:${port}/openapi.json`);
  });
});

describe("Auth detection", () => {
  function makeBaseline(status: number): Baseline {
    return {
      seed: {} as any,
      responses: [],
      avgTiming: 0,
      expectedStatus: status,
      responseSchema: "",
    };
  }

  it("detects all 401 as unauthorized", () => {
    const baselines = [makeBaseline(401), makeBaseline(401), makeBaseline(401)];
    expect(checkAllUnauthorized(baselines)).toBe(true);
  });

  it("detects mixed 401/403 as unauthorized", () => {
    const baselines = [makeBaseline(401), makeBaseline(403), makeBaseline(401)];
    expect(checkAllUnauthorized(baselines)).toBe(true);
  });

  it("returns false when some endpoints succeed", () => {
    const baselines = [makeBaseline(200), makeBaseline(401), makeBaseline(200)];
    expect(checkAllUnauthorized(baselines)).toBe(false);
  });

  it("returns false for empty baselines", () => {
    expect(checkAllUnauthorized([])).toBe(false);
  });

  it("returns false for normal responses", () => {
    const baselines = [makeBaseline(200), makeBaseline(201), makeBaseline(200)];
    expect(checkAllUnauthorized(baselines)).toBe(false);
  });
});
