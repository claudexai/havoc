import { HavocEndpoint, HavocResponse, Bug, Field } from "../types/index.js";
import { HavocTransport } from "../transport/rest.js";
import { hashFingerprint } from "../core/fingerprint.js";

// Oracle Layer 1: Schema Validation
// Checks response structure, status codes, required fields, and types

export function checkSchema(
  endpoint: HavocEndpoint,
  payload: any,
  response: HavocResponse,
  transport: HavocTransport,
  agent: string,
  generation: number,
  wasInvalidInput: boolean
): Bug | null {
  // Connection failure — not a schema bug
  if (response.status === 0) return null;

  // Check: valid input should not get 400/422
  if (!wasInvalidInput && response.status >= 400 && response.status < 500) {
    return makeBug(
      endpoint,
      payload,
      response,
      transport,
      agent,
      generation,
      "medium",
      "Valid input rejected",
      `Valid request to ${endpoint.id} returned ${response.status}`
    );
  }

  // Check: invalid input should not get 200
  if (wasInvalidInput && response.status >= 200 && response.status < 300) {
    return makeBug(
      endpoint,
      payload,
      response,
      transport,
      agent,
      generation,
      "high",
      "Invalid input accepted",
      `Invalid request to ${endpoint.id} returned ${response.status} instead of 4xx`
    );
  }

  // Check: 500+ is always a bug
  if (response.status >= 500) {
    return makeBug(
      endpoint,
      payload,
      response,
      transport,
      agent,
      generation,
      "critical",
      "Server error",
      `${endpoint.id} returned ${response.status}`
    );
  }

  // Check: response body matches output schema (if 2xx)
  if (response.status >= 200 && response.status < 300 && endpoint.output.fields.length > 0) {
    const body = response.body;
    if (body && typeof body === "object") {
      for (const field of endpoint.output.fields) {
        if (field.name in body) {
          const typeError = checkFieldType(field, body[field.name]);
          if (typeError) {
            return makeBug(
              endpoint,
              payload,
              response,
              transport,
              agent,
              generation,
              "medium",
              "Response type mismatch",
              `${endpoint.id}: field "${field.name}" ${typeError}`
            );
          }
        }
      }
    }
  }

  return null;
}

function checkFieldType(field: Field, value: any): string | null {
  if (value === null) {
    return field.constraints.nullable ? null : "is null but not declared nullable";
  }
  switch (field.type) {
    case "int":
      if (typeof value !== "number" || !Number.isInteger(value))
        return `expected int, got ${typeof value}`;
      break;
    case "float":
      if (typeof value !== "number") return `expected float, got ${typeof value}`;
      break;
    case "string":
      if (typeof value !== "string") return `expected string, got ${typeof value}`;
      break;
    case "bool":
      if (typeof value !== "boolean") return `expected bool, got ${typeof value}`;
      break;
    case "array":
      if (!Array.isArray(value)) return `expected array, got ${typeof value}`;
      break;
    case "object":
      if (typeof value !== "object" || Array.isArray(value))
        return `expected object, got ${typeof value}`;
      break;
  }
  return null;
}

function makeBug(
  endpoint: HavocEndpoint,
  payload: any,
  response: HavocResponse,
  transport: HavocTransport,
  agent: string,
  generation: number,
  severity: Bug["severity"],
  title: string,
  description: string
): Bug {
  const fingerprint = hashFingerprint(endpoint.id, title, response.status);
  return {
    id: fingerprint,
    fingerprint,
    endpoint,
    agent,
    generation,
    oracle_layer: 1,
    severity,
    title,
    description,
    request: {
      method: endpoint.method,
      path: endpoint.path,
      headers: { "Content-Type": "application/json" },
      body: payload,
    },
    response,
    curl: transport.buildCurl(endpoint, payload),
  };
}

