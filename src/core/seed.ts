import { faker } from "@faker-js/faker";
import { HavocEndpoint, Field } from "../types/index.js";

export interface Seed {
  endpoint: HavocEndpoint;
  payload: Record<string, any>;
  pathParams: Record<string, string>;
}

export function generateSeeds(endpoints: HavocEndpoint[], seed: number): Seed[] {
  faker.seed(seed);
  const seeds: Seed[] = [];

  for (const endpoint of endpoints) {
    const payload: Record<string, any> = {};
    const pathParams: Record<string, string> = {};

    for (const field of endpoint.input.fields) {
      // Path/query parameters go to pathParams, body fields go to payload
      if (endpoint.path.includes(`{${field.name}}`)) {
        pathParams[field.name] = String(generateValue(field));
      } else {
        payload[field.name] = generateValue(field);
      }
    }

    seeds.push({ endpoint, payload, pathParams });
  }

  return seeds;
}

function generateValue(field: Field): any {
  const { constraints } = field;

  switch (field.type) {
    case "string":
      return generateString(constraints);
    case "int":
      return generateInt(constraints);
    case "float":
      return generateFloat(constraints);
    case "bool":
      return faker.datatype.boolean();
    case "enum":
      if (constraints.enum_values && constraints.enum_values.length > 0) {
        return faker.helpers.arrayElement(constraints.enum_values);
      }
      return "unknown";
    case "array":
      return generateArray(constraints);
    case "object":
      return generateObject(constraints);
    default:
      return faker.lorem.word();
  }
}

function generateString(c: Field["constraints"]): string {
  if (c.format) {
    switch (c.format) {
      case "email":
        return faker.internet.email();
      case "uuid":
        return faker.string.uuid();
      case "uri":
      case "url":
        return faker.internet.url();
      case "date-time":
        return faker.date.recent().toISOString();
      case "date":
        return faker.date.recent().toISOString().split("T")[0];
      case "ipv4":
        return faker.internet.ipv4();
      default:
        break;
    }
  }

  if (c.pattern) {
    // Can't reliably generate from regex — use a generic string
    return faker.lorem.word();
  }

  const maxLen = c.max_length ?? 50;
  return faker.lorem.words(Math.min(3, maxLen / 5)).slice(0, maxLen);
}

function generateInt(c: Field["constraints"]): number {
  const min = c.min ?? 0;
  const max = c.max ?? 1000;
  return faker.number.int({ min, max });
}

function generateFloat(c: Field["constraints"]): number {
  const min = c.min ?? 0;
  const max = c.max ?? 1000;
  return faker.number.float({ min, max, fractionDigits: 2 });
}

function generateArray(c: Field["constraints"]): any[] {
  const count = faker.number.int({
    min: c.min_items ?? 1,
    max: c.max_items ?? 3,
  });
  if (!c.items) return [];
  return Array.from({ length: count }, () => generateValue(c.items!));
}

function generateObject(c: Field["constraints"]): Record<string, any> {
  if (!c.fields) return {};
  const obj: Record<string, any> = {};
  for (const field of c.fields) {
    obj[field.name] = generateValue(field);
  }
  return obj;
}
