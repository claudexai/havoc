import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { discover } from "../src/adapters/openapi.js";
import { generateSeeds } from "../src/core/seed.js";
import { HavocTransport } from "../src/transport/rest.js";
import { runBaseline } from "../src/core/baseline.js";
import { BoundaryWalker } from "../src/agents/boundary-walker.js";
import { MutantBreeder } from "../src/agents/mutant-breeder.js";
import { TypeShapeshifter } from "../src/agents/type-shapeshifter.js";
import { ConsistencyChecker } from "../src/oracles/consistency.js";
import { ChildProcess, fork } from "child_process";
import path from "path";

const SPEC_PATH = path.resolve("test-server/openapi.yaml");
const SERVER_URL = "http://localhost:3999"; // use a different port to avoid conflicts

let serverProcess: ChildProcess;

beforeAll(async () => {
  // Start the test server
  serverProcess = fork(path.resolve("test-server/server.js"), [], {
    env: { ...process.env, PORT: "3999" },
    stdio: "pipe",
  });

  // Wait for server to start
  await new Promise<void>((resolve, reject) => {
    const timeout = setTimeout(() => reject(new Error("Server start timeout")), 5000);
    serverProcess.stdout?.on("data", (data) => {
      if (data.toString().includes("running")) {
        clearTimeout(timeout);
        resolve();
      }
    });
    serverProcess.on("error", (err) => {
      clearTimeout(timeout);
      reject(err);
    });
  });
});

afterAll(() => {
  serverProcess?.kill();
});

describe("Transport", () => {
  it("sends a GET request and parses JSON response", async () => {
    const endpoints = await discover(SPEC_PATH);
    const transport = new HavocTransport(SERVER_URL, {});
    const listProducts = endpoints.find((e) => e.id === "GET /products")!;

    const response = await transport.send(listProducts, undefined);
    expect(response.status).toBe(200);
    expect(response.body).toHaveProperty("items");
    expect(response.timing).toBeGreaterThan(0);
  });

  it("sends a POST request with body", async () => {
    const endpoints = await discover(SPEC_PATH);
    const transport = new HavocTransport(SERVER_URL, {});
    const createProduct = endpoints.find((e) => e.id === "POST /products")!;

    const response = await transport.send(createProduct, {
      name: "Test Widget",
      price: 12.99,
      category: "tools",
      stock: 10,
    });
    expect(response.status).toBe(201);
    expect(response.body.name).toBe("Test Widget");
  });

  it("builds curl commands", async () => {
    const endpoints = await discover(SPEC_PATH);
    const transport = new HavocTransport(SERVER_URL, { Authorization: "Bearer test" });
    const createProduct = endpoints.find((e) => e.id === "POST /products")!;

    const curl = transport.buildCurl(createProduct, { name: "Test" });
    expect(curl).toContain("curl -X POST");
    expect(curl).toContain(SERVER_URL);
    expect(curl).toContain("Authorization: Bearer test");
    expect(curl).toContain('"name":"Test"');
  });
});

describe("Baseline", () => {
  it("records baseline responses for seeds", async () => {
    const endpoints = await discover(SPEC_PATH);
    const transport = new HavocTransport(SERVER_URL, {});
    // Only baseline GET endpoints to avoid creating data
    const getEndpoints = endpoints.filter((e) => e.method === "GET" && !e.path.includes("{"));
    const seeds = generateSeeds(getEndpoints, 42);

    const baselines = await runBaseline(transport, seeds);
    expect(baselines.length).toBe(seeds.length);

    for (const b of baselines) {
      expect(b.responses.length).toBe(5);
      expect(b.avgTiming).toBeGreaterThan(0);
      expect(b.expectedStatus).toBeGreaterThan(0);
    }
  });
});

describe("Boundary Walker (integration)", () => {
  it("finds bugs in the buggy test server", async () => {
    const endpoints = await discover(SPEC_PATH);
    // Only test POST /products for speed
    const target = endpoints.filter((e) => e.id === "POST /products");
    const transport = new HavocTransport(SERVER_URL, {});
    const seeds = generateSeeds(target, 42);
    const baselines = await runBaseline(transport, seeds);

    const agent = new BoundaryWalker(transport, target, seeds, baselines, 42);
    const result = await agent.run();

    expect(result.agent).toBe("boundary_walker");
    expect(result.requests_sent).toBeGreaterThan(0);
    // The buggy server should accept invalid inputs → bugs found
    expect(result.bugs.length).toBeGreaterThan(0);
  });
});

describe("Mutant Breeder (integration)", () => {
  it("finds bugs in the buggy test server", async () => {
    const endpoints = await discover(SPEC_PATH);
    const target = endpoints.filter((e) => e.id === "POST /products");
    const transport = new HavocTransport(SERVER_URL, {});
    const seeds = generateSeeds(target, 42);
    const baselines = await runBaseline(transport, seeds);

    const agent = new MutantBreeder(transport, target, seeds, baselines, 42);
    const result = await agent.run();

    expect(result.agent).toBe("mutant_breeder");
    expect(result.requests_sent).toBeGreaterThan(0);
    // Injection of price_override, is_admin, etc. should trigger bugs
    expect(result.bugs.length).toBeGreaterThan(0);
  });
});

describe("Type Shapeshifter (integration)", () => {
  it("finds bugs by sending wrong types", async () => {
    const endpoints = await discover(SPEC_PATH);
    const target = endpoints.filter((e) => e.id === "POST /products");
    const transport = new HavocTransport(SERVER_URL, {});
    const seeds = generateSeeds(target, 42);
    const baselines = await runBaseline(transport, seeds);

    const agent = new TypeShapeshifter(transport, target, seeds, baselines, 42);
    const result = await agent.run();

    expect(result.agent).toBe("type_shapeshifter");
    expect(result.requests_sent).toBeGreaterThan(0);
    // Sending "2" instead of 2, float instead of int, etc. should find bugs
    expect(result.bugs.length).toBeGreaterThan(0);
  });
});

describe("Consistency Checker (integration)", () => {
  it("finds create-read inconsistencies", async () => {
    const endpoints = await discover(SPEC_PATH);
    const transport = new HavocTransport(SERVER_URL, {});
    const seeds = generateSeeds(endpoints, 42);

    const checker = new ConsistencyChecker(transport, endpoints, seeds);
    const result = await checker.run("consistency_checker", 1);

    expect(result.requests).toBeGreaterThan(0);
    // The buggy server has count mismatches, delete-without-404, etc.
    expect(result.bugs.length).toBeGreaterThan(0);
  });
});
