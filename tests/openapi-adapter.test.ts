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

  it("resolves allOf schemas into merged objects", async () => {
    // Create a temp spec with allOf pattern (common in Strapi, etc.)
    const { discover: discoverSpec } = await import("../src/adapters/openapi.js");
    const fs = await import("fs");
    const tmpSpec = {
      openapi: "3.0.0",
      info: { title: "allOf test", version: "1.0.0" },
      paths: {
        "/roles": {
          get: {
            responses: {
              "200": {
                description: "OK",
                content: {
                  "application/json": {
                    schema: {
                      type: "object",
                      properties: {
                        roles: {
                          type: "array",
                          items: {
                            allOf: [
                              {
                                type: "object",
                                properties: {
                                  id: { type: "integer" },
                                  name: { type: "string" },
                                },
                              },
                              {
                                type: "object",
                                properties: {
                                  nb_users: { type: "number" },
                                },
                              },
                            ],
                          },
                        },
                      },
                    },
                  },
                },
              },
            },
          },
        },
      },
    };
    const tmpPath = "/tmp/havoc-allof-test.json";
    fs.writeFileSync(tmpPath, JSON.stringify(tmpSpec));
    const endpoints = await discoverSpec(tmpPath);
    const getRoles = endpoints.find((e) => e.id === "GET /roles")!;
    const rolesField = getRoles.output.fields.find((f) => f.name === "roles")!;
    expect(rolesField.type).toBe("array");
    // The items should be resolved as object (from merged allOf), not string
    expect(rolesField.constraints.items).toBeDefined();
    expect(rolesField.constraints.items!.type).toBe("object");
    expect(rolesField.constraints.items!.constraints.fields).toBeDefined();
    const fieldNames = rolesField.constraints.items!.constraints.fields!.map((f) => f.name);
    expect(fieldNames).toContain("id");
    expect(fieldNames).toContain("name");
    expect(fieldNames).toContain("nb_users");
    fs.unlinkSync(tmpPath);
  });

  it("resolves oneOf/anyOf by picking the first variant", async () => {
    const fs = await import("fs");
    const tmpSpec = {
      openapi: "3.0.0",
      info: { title: "oneOf test", version: "1.0.0" },
      paths: {
        "/payments": {
          post: {
            requestBody: {
              content: {
                "application/json": {
                  schema: {
                    type: "object",
                    properties: {
                      method: {
                        oneOf: [
                          { type: "object", properties: { card_number: { type: "string" }, cvv: { type: "string" } } },
                          { type: "object", properties: { iban: { type: "string" } } },
                        ],
                      },
                      amount: {
                        anyOf: [
                          { type: "number" },
                          { type: "string" },
                        ],
                      },
                    },
                  },
                },
              },
            },
            responses: { "200": { description: "OK" } },
          },
        },
      },
    };
    const tmpPath = "/tmp/havoc-oneof-test.json";
    fs.writeFileSync(tmpPath, JSON.stringify(tmpSpec));
    const endpoints = await discover(tmpPath);
    const post = endpoints.find((e) => e.id === "POST /payments")!;

    // oneOf: should pick first variant (card payment)
    const methodField = post.input.fields.find((f) => f.name === "method")!;
    expect(methodField.type).toBe("object");
    expect(methodField.constraints.fields).toBeDefined();
    const childNames = methodField.constraints.fields!.map((f) => f.name);
    expect(childNames).toContain("card_number");
    expect(childNames).toContain("cvv");

    // anyOf: should pick first variant (number)
    const amountField = post.input.fields.find((f) => f.name === "amount")!;
    expect(amountField.type).toBe("float");

    fs.unlinkSync(tmpPath);
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
