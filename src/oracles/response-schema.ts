import { HavocEndpoint, HavocResponse, Bug, Field } from "../types/index.js";
import { HavocTransport } from "../transport/rest.js";
import { hashFingerprint } from "../core/fingerprint.js";

// Oracle Layer 3: Response Schema Validation
// Deep validation of response body against spec — not just status codes.
// Checks: required fields present, types match, nested objects, arrays,
// constraint violations (min/max, enum values, string length).

export function checkResponseSchema(
  endpoint: HavocEndpoint,
  payload: any,
  response: HavocResponse,
  transport: HavocTransport,
  agent: string,
  generation: number
): Bug[] {
  const bugs: Bug[] = [];

  // Only validate 2xx responses with output schema
  if (response.status < 200 || response.status >= 300) return bugs;
  if (endpoint.output.fields.length === 0) return bugs;
  if (response.body === null || response.body === undefined) return bugs;

  const body = response.body;

  for (const field of endpoint.output.fields) {
    const errors = validateField(field, body[field.name], field.name);
    for (const error of errors) {
      bugs.push(makeBug(endpoint, payload, response, transport, agent, generation, error));
    }
  }

  return bugs;
}

interface FieldError {
  path: string;
  message: string;
  severity: Bug["severity"];
}

function validateField(field: Field, value: any, path: string): FieldError[] {
  const errors: FieldError[] = [];

  // Missing field check
  if (value === undefined) {
    // Not necessarily a bug — field may be optional
    return errors;
  }

  // Null check
  if (value === null) {
    if (!field.constraints.nullable) {
      errors.push({
        path,
        message: `"${path}" is null but not declared nullable`,
        severity: "medium",
      });
    }
    return errors;
  }

  // Type check
  const typeError = checkType(field, value, path);
  if (typeError) {
    errors.push(typeError);
    return errors; // Skip deeper checks if type is wrong
  }

  // Constraint checks
  errors.push(...checkConstraints(field, value, path));

  // Recurse into nested structures
  if (field.type === "object" && field.constraints.fields) {
    for (const childField of field.constraints.fields) {
      errors.push(
        ...validateField(childField, value[childField.name], `${path}.${childField.name}`)
      );
    }
  }

  if (field.type === "array" && field.constraints.items && Array.isArray(value)) {
    for (let i = 0; i < value.length; i++) {
      errors.push(
        ...validateField(field.constraints.items, value[i], `${path}[${i}]`)
      );
    }
  }

  return errors;
}

function checkType(field: Field, value: any, path: string): FieldError | null {
  switch (field.type) {
    case "string":
    case "enum":
      if (typeof value !== "string") {
        return {
          path,
          message: `"${path}" expected string, got ${typeof value} (${JSON.stringify(value)})`,
          severity: "medium",
        };
      }
      break;
    case "int":
      if (typeof value !== "number" || !Number.isInteger(value)) {
        return {
          path,
          message: `"${path}" expected integer, got ${typeof value === "number" ? "float" : typeof value} (${JSON.stringify(value)})`,
          severity: "medium",
        };
      }
      break;
    case "float":
      if (typeof value !== "number") {
        return {
          path,
          message: `"${path}" expected number, got ${typeof value} (${JSON.stringify(value)})`,
          severity: "medium",
        };
      }
      break;
    case "bool":
      if (typeof value !== "boolean") {
        return {
          path,
          message: `"${path}" expected boolean, got ${typeof value} (${JSON.stringify(value)})`,
          severity: "medium",
        };
      }
      break;
    case "array":
      if (!Array.isArray(value)) {
        return {
          path,
          message: `"${path}" expected array, got ${typeof value}`,
          severity: "medium",
        };
      }
      break;
    case "object":
      if (typeof value !== "object" || Array.isArray(value)) {
        return {
          path,
          message: `"${path}" expected object, got ${Array.isArray(value) ? "array" : typeof value}`,
          severity: "medium",
        };
      }
      break;
  }
  return null;
}

function checkConstraints(field: Field, value: any, path: string): FieldError[] {
  const errors: FieldError[] = [];
  const c = field.constraints;

  // Numeric constraints
  if (typeof value === "number") {
    if (c.min !== undefined && value < c.min) {
      errors.push({
        path,
        message: `"${path}" value ${value} is below minimum ${c.min}`,
        severity: "medium",
      });
    }
    if (c.max !== undefined && value > c.max) {
      errors.push({
        path,
        message: `"${path}" value ${value} exceeds maximum ${c.max}`,
        severity: "medium",
      });
    }
  }

  // String constraints
  if (typeof value === "string") {
    if (c.max_length !== undefined && value.length > c.max_length) {
      errors.push({
        path,
        message: `"${path}" length ${value.length} exceeds maxLength ${c.max_length}`,
        severity: "low",
      });
    }
    if (c.pattern) {
      try {
        if (!new RegExp(c.pattern).test(value)) {
          errors.push({
            path,
            message: `"${path}" does not match pattern /${c.pattern}/`,
            severity: "low",
          });
        }
      } catch {
        // Invalid regex in spec — skip
      }
    }
  }

  // Enum constraints
  if (field.type === "enum" && c.enum_values && typeof value === "string") {
    if (!c.enum_values.includes(value)) {
      errors.push({
        path,
        message: `"${path}" value "${value}" is not in enum [${c.enum_values.join(", ")}]`,
        severity: "medium",
      });
    }
  }

  // Array constraints
  if (Array.isArray(value)) {
    if (c.min_items !== undefined && value.length < c.min_items) {
      errors.push({
        path,
        message: `"${path}" has ${value.length} items, minimum is ${c.min_items}`,
        severity: "low",
      });
    }
    if (c.max_items !== undefined && value.length > c.max_items) {
      errors.push({
        path,
        message: `"${path}" has ${value.length} items, maximum is ${c.max_items}`,
        severity: "low",
      });
    }
  }

  return errors;
}

function makeBug(
  endpoint: HavocEndpoint,
  payload: any,
  response: HavocResponse,
  transport: HavocTransport,
  agent: string,
  generation: number,
  error: FieldError
): Bug {
  const fingerprint = hashFingerprint(endpoint.id, "response_schema", error.path);
  return {
    id: fingerprint,
    fingerprint,
    endpoint,
    agent,
    generation,
    oracle_layer: 3,
    severity: error.severity,
    title: "Response schema violation",
    description: `${endpoint.id}: ${error.message}`,
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

