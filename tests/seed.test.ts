import { describe, it, expect } from "vitest";
import { discover } from "../src/adapters/openapi.js";
import { generateSeeds } from "../src/core/seed.js";
import path from "path";

const SPEC_PATH = path.resolve("test-server/openapi.yaml");

describe("Seed Generator", () => {
  it("generates a seed for each endpoint", async () => {
    const endpoints = await discover(SPEC_PATH);
    const seeds = generateSeeds(endpoints, 42);

    expect(seeds.length).toBe(endpoints.length);
  });

  it("generates valid payloads matching field types", async () => {
    const endpoints = await discover(SPEC_PATH);
    const seeds = generateSeeds(endpoints, 42);

    const createProduct = seeds.find((s) => s.endpoint.id === "POST /products")!;
    expect(createProduct).toBeDefined();

    const { payload } = createProduct;
    expect(typeof payload.name).toBe("string");
    expect(typeof payload.price).toBe("number");
    expect(payload.price).toBeGreaterThanOrEqual(0.01);
    expect(payload.price).toBeLessThanOrEqual(999999.99);
    expect(["tools", "electronics", "clothing", "food"]).toContain(payload.category);
    expect(typeof payload.stock).toBe("number");
    expect(Number.isInteger(payload.stock)).toBe(true);
  });

  it("is deterministic with the same seed", async () => {
    const endpoints = await discover(SPEC_PATH);
    const seeds1 = generateSeeds(endpoints, 42);
    const seeds2 = generateSeeds(endpoints, 42);

    for (let i = 0; i < seeds1.length; i++) {
      expect(seeds1[i].payload).toEqual(seeds2[i].payload);
      expect(seeds1[i].pathParams).toEqual(seeds2[i].pathParams);
    }
  });

  it("produces different results with different seeds", async () => {
    const endpoints = await discover(SPEC_PATH);
    const seeds1 = generateSeeds(endpoints, 42);
    const seeds2 = generateSeeds(endpoints, 99);

    // At least one payload should differ
    const hasDifference = seeds1.some(
      (s, i) => JSON.stringify(s.payload) !== JSON.stringify(seeds2[i].payload)
    );
    expect(hasDifference).toBe(true);
  });

  it("extracts path params from path template", async () => {
    const endpoints = await discover(SPEC_PATH);
    const seeds = generateSeeds(endpoints, 42);

    const getProduct = seeds.find((s) => s.endpoint.id === "GET /products/{id}")!;
    expect(getProduct.pathParams).toHaveProperty("id");
    expect(typeof getProduct.pathParams.id).toBe("string");
    // Path param should NOT be in payload
    expect(getProduct.payload).not.toHaveProperty("id");
  });

  it("generates array seeds for order items", async () => {
    const endpoints = await discover(SPEC_PATH);
    const seeds = generateSeeds(endpoints, 42);

    const createOrder = seeds.find((s) => s.endpoint.id === "POST /orders")!;
    expect(Array.isArray(createOrder.payload.items)).toBe(true);
    expect(createOrder.payload.items.length).toBeGreaterThanOrEqual(1);
  });
});
