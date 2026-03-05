import SwaggerParser from "@apidevtools/swagger-parser";
import { HavocEndpoint, Field, ErrorSchema } from "../types/index.js";

export async function discover(specPath: string): Promise<HavocEndpoint[]> {
  const api = (await SwaggerParser.dereference(specPath)) as any;
  const endpoints: HavocEndpoint[] = [];

  const paths = api.paths || {};
  for (const [path, methods] of Object.entries(paths) as [string, any][]) {
    for (const [method, operation] of Object.entries(methods) as [string, any][]) {
      if (["get", "post", "put", "patch", "delete"].indexOf(method) === -1) continue;

      const endpoint = parseOperation(path, method.toUpperCase(), operation);
      if (endpoint) endpoints.push(endpoint);
    }
  }

  return endpoints;
}

function parseOperation(path: string, method: string, op: any): HavocEndpoint | null {
  const id = `${method} ${path}`;
  const fields: Field[] = [];
  const required: string[] = [];

  // Parse request body (POST/PUT/PATCH)
  // Skip endpoints that only accept multipart/form-data (file uploads)
  if (op.requestBody) {
    const contentTypes = Object.keys(op.requestBody.content || {});
    const isMultipartOnly = contentTypes.length > 0 &&
      contentTypes.every((ct) => ct.includes("multipart") || ct.includes("octet-stream"));
    if (isMultipartOnly) return null;

    const content = op.requestBody.content?.["application/json"];
    if (content?.schema) {
      const bodyFields = schemaToFields(content.schema);
      fields.push(...bodyFields);
      if (content.schema.required) {
        required.push(...content.schema.required);
      }
    }
  }

  // Parse path parameters
  if (op.parameters) {
    for (const param of op.parameters) {
      const field = paramToField(param);
      fields.push(field);
      if (param.required) {
        required.push(param.name);
      }
    }
  }

  // Parse responses for output schema
  const outputFields: Field[] = [];
  const errors: ErrorSchema[] = [];
  if (op.responses) {
    for (const [statusStr, resp] of Object.entries(op.responses) as [string, any][]) {
      const status = parseInt(statusStr, 10);
      if (isNaN(status)) continue;

      if (status >= 200 && status < 300) {
        const content = resp.content?.["application/json"];
        if (content?.schema) {
          outputFields.push(...schemaToFields(content.schema));
        }
      } else {
        errors.push({ status, description: resp.description });
      }
    }
  }

  // Detect if this endpoint creates a resource
  const creates_resource = method === "POST";
  let resource_id_field = "";
  if (creates_resource) {
    const idField = outputFields.find(
      (f) => f.name === "id" || f.name.endsWith("_id")
    );
    if (idField) resource_id_field = idField.name;
  }

  return {
    id,
    name: op.summary || op.operationId || id,
    method,
    path,
    protocol: "rest",
    input: { fields, required },
    output: { fields: outputFields, errors },
    dependencies: [],
    creates_resource,
    resource_id_field,
  };
}

function schemaToFields(schema: any): Field[] {
  if (!schema) return [];

  // Resolve allOf at the top level too
  schema = resolveComposedSchema(schema);

  // If the schema itself is an object with properties, return those fields
  if (schema.type === "object" || schema.properties) {
    const fields: Field[] = [];
    for (const [name, prop] of Object.entries(schema.properties || {}) as [string, any][]) {
      fields.push(propToField(name, prop));
    }
    return fields;
  }

  // If it's an array, wrap as a single array field
  if (schema.type === "array") {
    return [
      {
        name: "_root",
        type: "array",
        constraints: {
          min_items: schema.minItems,
          max_items: schema.maxItems,
          items: schema.items ? propToField("_item", schema.items) : undefined,
        },
      },
    ];
  }

  return [];
}

function resolveComposedSchema(prop: any): any {
  if (!prop) return prop;

  // allOf: merge all entries into a single schema
  if (prop.allOf) {
    let merged: any = {};
    for (const part of prop.allOf) {
      const resolved = resolveComposedSchema(part);
      merged = {
        ...merged,
        ...resolved,
        properties: { ...merged.properties, ...resolved.properties },
        required: [...(merged.required || []), ...(resolved.required || [])],
      };
    }
    const { allOf, ...siblings } = prop;
    return { ...merged, ...siblings, properties: { ...merged.properties, ...siblings.properties } };
  }

  // oneOf / anyOf: pick the first variant (best-effort — generates tests for the primary schema)
  if (prop.oneOf && prop.oneOf.length > 0) {
    const { oneOf, ...siblings } = prop;
    return { ...resolveComposedSchema(oneOf[0]), ...siblings };
  }
  if (prop.anyOf && prop.anyOf.length > 0) {
    const { anyOf, ...siblings } = prop;
    return { ...resolveComposedSchema(anyOf[0]), ...siblings };
  }

  return prop;
}

function propToField(name: string, prop: any): Field {
  prop = resolveComposedSchema(prop);
  const type = mapType(prop);
  const constraints: Field["constraints"] = {};

  if (prop.minimum !== undefined) constraints.min = prop.minimum;
  if (prop.maximum !== undefined) constraints.max = prop.maximum;
  if (prop.exclusiveMinimum !== undefined) constraints.min = prop.exclusiveMinimum + 1;
  if (prop.exclusiveMaximum !== undefined) constraints.max = prop.exclusiveMaximum - 1;
  if (prop.pattern) constraints.pattern = prop.pattern;
  if (prop.enum) constraints.enum_values = prop.enum;
  if (prop.nullable) constraints.nullable = true;
  if (prop.minItems !== undefined) constraints.min_items = prop.minItems;
  if (prop.maxItems !== undefined) constraints.max_items = prop.maxItems;
  if (prop.minLength !== undefined) constraints.min = prop.minLength;
  if (prop.maxLength !== undefined) constraints.max_length = prop.maxLength;
  if (prop.format) constraints.format = prop.format;

  if (type === "array" && prop.items) {
    constraints.items = propToField("_item", prop.items);
  }

  if (type === "object" && prop.properties) {
    constraints.fields = [];
    for (const [childName, childProp] of Object.entries(prop.properties) as [string, any][]) {
      constraints.fields.push(propToField(childName, childProp));
    }
  }

  return { name, type, constraints };
}

function paramToField(param: any): Field {
  const schema = param.schema || {};
  return propToField(param.name, schema);
}

function mapType(prop: any): Field["type"] {
  if (prop.enum) return "enum";
  switch (prop.type) {
    case "integer":
      return "int";
    case "number":
      return "float";
    case "boolean":
      return "bool";
    case "array":
      return "array";
    case "object":
      return "object";
    default:
      return "string";
  }
}
