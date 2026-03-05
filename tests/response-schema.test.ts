import { describe, it, expect } from "vitest";
import { checkResponseSchema } from "../src/oracles/response-schema.js";
import { HavocEndpoint, HavocResponse, Field } from "../src/types/index.js";
import { HavocTransport } from "../src/transport/rest.js";

const transport = new HavocTransport("http://localhost:3000", {});

function makeEndpoint(outputFields: Field[]): HavocEndpoint {
  return {
    id: "GET /test",
    name: "test",
    method: "GET",
    path: "/test",
    protocol: "rest",
    input: { fields: [], required: [] },
    output: { fields: outputFields, errors: [] },
    dependencies: [],
    creates_resource: false,
    resource_id_field: "",
  };
}

function makeResponse(status: number, body: any): HavocResponse {
  return { status, body, errors: [], timing: 10, headers: {} };
}

describe("Oracle Layer 3: Response Schema Validation", () => {
  it("passes when response matches schema", () => {
    const endpoint = makeEndpoint([
      { name: "id", type: "string", constraints: {} },
      { name: "count", type: "int", constraints: {} },
    ]);
    const response = makeResponse(200, { id: "abc", count: 5 });
    const bugs = checkResponseSchema(endpoint, {}, response, transport, "test", 1);
    expect(bugs.length).toBe(0);
  });

  it("detects wrong type in response", () => {
    const endpoint = makeEndpoint([
      { name: "price", type: "float", constraints: {} },
    ]);
    const response = makeResponse(200, { price: "19.99" }); // string instead of number
    const bugs = checkResponseSchema(endpoint, {}, response, transport, "test", 1);
    expect(bugs.length).toBe(1);
    expect(bugs[0].description).toContain("expected number");
  });

  it("detects integer returned as float", () => {
    const endpoint = makeEndpoint([
      { name: "count", type: "int", constraints: {} },
    ]);
    const response = makeResponse(200, { count: 5.5 }); // float instead of int
    const bugs = checkResponseSchema(endpoint, {}, response, transport, "test", 1);
    expect(bugs.length).toBe(1);
    expect(bugs[0].description).toContain("expected integer");
  });

  it("detects null in non-nullable field", () => {
    const endpoint = makeEndpoint([
      { name: "name", type: "string", constraints: {} },
    ]);
    const response = makeResponse(200, { name: null });
    const bugs = checkResponseSchema(endpoint, {}, response, transport, "test", 1);
    expect(bugs.length).toBe(1);
    expect(bugs[0].description).toContain("not declared nullable");
  });

  it("allows null in nullable field", () => {
    const endpoint = makeEndpoint([
      { name: "name", type: "string", constraints: { nullable: true } },
    ]);
    const response = makeResponse(200, { name: null });
    const bugs = checkResponseSchema(endpoint, {}, response, transport, "test", 1);
    expect(bugs.length).toBe(0);
  });

  it("detects enum violation in response", () => {
    const endpoint = makeEndpoint([
      { name: "status", type: "enum", constraints: { enum_values: ["active", "inactive"] } },
    ]);
    const response = makeResponse(200, { status: "deleted" });
    const bugs = checkResponseSchema(endpoint, {}, response, transport, "test", 1);
    expect(bugs.length).toBe(1);
    expect(bugs[0].description).toContain("not in enum");
  });

  it("validates nested object fields", () => {
    const endpoint = makeEndpoint([
      {
        name: "user",
        type: "object",
        constraints: {
          fields: [
            { name: "age", type: "int", constraints: {} },
          ],
        },
      },
    ]);
    const response = makeResponse(200, { user: { age: "twenty" } });
    const bugs = checkResponseSchema(endpoint, {}, response, transport, "test", 1);
    expect(bugs.length).toBe(1);
    expect(bugs[0].description).toContain("user.age");
  });

  it("validates array items", () => {
    const endpoint = makeEndpoint([
      {
        name: "items",
        type: "array",
        constraints: {
          items: { name: "_item", type: "int", constraints: {} },
        },
      },
    ]);
    const response = makeResponse(200, { items: [1, 2, "three"] });
    const bugs = checkResponseSchema(endpoint, {}, response, transport, "test", 1);
    expect(bugs.length).toBe(1);
    expect(bugs[0].description).toContain("items[2]");
  });

  it("skips validation for non-2xx responses", () => {
    const endpoint = makeEndpoint([
      { name: "id", type: "string", constraints: {} },
    ]);
    const response = makeResponse(404, { error: "not found" });
    const bugs = checkResponseSchema(endpoint, {}, response, transport, "test", 1);
    expect(bugs.length).toBe(0);
  });

  it("detects numeric constraint violations", () => {
    const endpoint = makeEndpoint([
      { name: "price", type: "float", constraints: { min: 0, max: 1000 } },
    ]);
    const response = makeResponse(200, { price: -5 });
    const bugs = checkResponseSchema(endpoint, {}, response, transport, "test", 1);
    expect(bugs.length).toBe(1);
    expect(bugs[0].description).toContain("below minimum");
  });
});
