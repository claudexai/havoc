import { describe, it, expect } from "vitest";
import { discover } from "../src/adapters/openapi.js";
import path from "path";

const SPEC_PATH = path.resolve("test-server/openapi.yaml");

describe("OpenAPI Adapter", () => {
  it("discovers all endpoints from spec", async () => {
    const endpoints = await discover(SPEC_PATH);
    expect(endpoints.length).toBeGreaterThan(0);

    const ids = endpoints.map((e) => e.id);
    expect(ids).toContain("GET /products");
    expect(ids).toContain("POST /products");
    expect(ids).toContain("GET /products/{id}");
    expect(ids).toContain("PUT /products/{id}");
    expect(ids).toContain("DELETE /products/{id}");
    expect(ids).toContain("POST /orders");
    expect(ids).toContain("GET /orders/{id}");
    expect(ids).toContain("POST /orders/{id}/ship");
  });

  it("parses request body fields for POST /products", async () => {
    const endpoints = await discover(SPEC_PATH);
    const createProduct = endpoints.find((e) => e.id === "POST /products")!;

    expect(createProduct).toBeDefined();
    expect(createProduct.protocol).toBe("rest");
    expect(createProduct.method).toBe("POST");

    const fieldNames = createProduct.input.fields.map((f) => f.name);
    expect(fieldNames).toContain("name");
    expect(fieldNames).toContain("price");
    expect(fieldNames).toContain("category");
    expect(fieldNames).toContain("stock");

    expect(createProduct.input.required).toContain("name");
    expect(createProduct.input.required).toContain("price");
    expect(createProduct.input.required).toContain("category");
  });

  it("parses field constraints correctly", async () => {
    const endpoints = await discover(SPEC_PATH);
    const createProduct = endpoints.find((e) => e.id === "POST /products")!;

    const priceField = createProduct.input.fields.find((f) => f.name === "price")!;
    expect(priceField.type).toBe("float");
    expect(priceField.constraints.min).toBe(0.01);
    expect(priceField.constraints.max).toBe(999999.99);

    const categoryField = createProduct.input.fields.find((f) => f.name === "category")!;
    expect(categoryField.type).toBe("enum");
    expect(categoryField.constraints.enum_values).toEqual(["tools", "electronics", "clothing", "food"]);

    const nameField = createProduct.input.fields.find((f) => f.name === "name")!;
    expect(nameField.type).toBe("string");
    expect(nameField.constraints.max_length).toBe(200);
  });

  it("parses path parameters", async () => {
    const endpoints = await discover(SPEC_PATH);
    const getProduct = endpoints.find((e) => e.id === "GET /products/{id}")!;

    const idParam = getProduct.input.fields.find((f) => f.name === "id")!;
    expect(idParam).toBeDefined();
    expect(idParam.type).toBe("string");
  });

  it("detects resource creation endpoints", async () => {
    const endpoints = await discover(SPEC_PATH);
    const createProduct = endpoints.find((e) => e.id === "POST /products")!;
    expect(createProduct.creates_resource).toBe(true);

    const getProduct = endpoints.find((e) => e.id === "GET /products/{id}")!;
    expect(getProduct.creates_resource).toBe(false);
  });

  it("parses output schema fields", async () => {
    const endpoints = await discover(SPEC_PATH);
    const listProducts = endpoints.find((e) => e.id === "GET /products")!;

    const outputFieldNames = listProducts.output.fields.map((f) => f.name);
    expect(outputFieldNames).toContain("items");
    expect(outputFieldNames).toContain("count");
    expect(outputFieldNames).toContain("total");
  });

  it("parses nested array items (orders)", async () => {
    const endpoints = await discover(SPEC_PATH);
    const createOrder = endpoints.find((e) => e.id === "POST /orders")!;

    const itemsField = createOrder.input.fields.find((f) => f.name === "items")!;
    expect(itemsField.type).toBe("array");
    expect(itemsField.constraints.min_items).toBe(1);
    expect(itemsField.constraints.max_items).toBe(50);
    expect(itemsField.constraints.items).toBeDefined();
  });
});
