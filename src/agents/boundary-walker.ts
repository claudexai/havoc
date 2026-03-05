import { HavocEndpoint, Field, AgentResult, Bug } from "../types/index.js";
import { HavocTransport } from "../transport/rest.js";
import { Seed } from "../core/seed.js";
import { Baseline } from "../core/baseline.js";
import { checkSchema } from "../oracles/schema.js";
import { checkResponseSchema } from "../oracles/response-schema.js";

export class BoundaryWalker {
  private bugs: Bug[] = [];
  private requestCount = 0;

  constructor(
    private transport: HavocTransport,
    private endpoints: HavocEndpoint[],
    private seeds: Seed[],
    private baselines: Baseline[],
    private seed: number
  ) {}

  async run(): Promise<AgentResult> {
    const start = performance.now();
    console.log("  [Boundary Walker] Starting boundary exploration...");

    for (const seedData of this.seeds) {
      const { endpoint, payload, pathParams } = seedData;

      // Test each field at its boundaries
      for (const field of endpoint.input.fields) {
        if (endpoint.path.includes(`{${field.name}}`)) continue; // skip path params for now

        const boundaryValues = this.getBoundaryValues(field);
        for (const { value, label } of boundaryValues) {
          const mutated = { ...payload, [field.name]: value };
          await this.test(endpoint, mutated, pathParams, `boundary: ${field.name}=${label}`);
        }
      }

      // Test removing each required field
      for (const reqField of endpoint.input.required) {
        const mutated = { ...payload };
        delete mutated[reqField];
        await this.test(endpoint, mutated, pathParams, `missing required field: ${reqField}`);
      }

      // Test null for each field
      for (const field of endpoint.input.fields) {
        if (endpoint.path.includes(`{${field.name}}`)) continue;
        const mutated = { ...payload, [field.name]: null };
        await this.test(endpoint, mutated, pathParams, `null field: ${field.name}`);
      }

      // Test empty body
      await this.test(endpoint, {}, pathParams, "empty body");
    }

    const duration = performance.now() - start;
    console.log(`  [Boundary Walker] Done — ${this.requestCount} requests, ${this.bugs.length} bugs found`);

    return {
      agent: "boundary_walker",
      bugs: this.bugs,
      requests_sent: this.requestCount,
      duration,
    };
  }

  private getBoundaryValues(field: Field): { value: any; label: string }[] {
    const values: { value: any; label: string }[] = [];
    const c = field.constraints;

    switch (field.type) {
      case "int":
      case "float": {
        const min = c.min ?? 0;
        const max = c.max ?? 1000;
        values.push(
          { value: min, label: "min" },
          { value: max, label: "max" },
          { value: min - 1, label: "min-1" },
          { value: max + 1, label: "max+1" },
          { value: 0, label: "zero" },
          { value: -1, label: "negative" },
          { value: Number.MAX_SAFE_INTEGER, label: "MAX_INT" },
          { value: Number.MIN_SAFE_INTEGER, label: "MIN_INT" }
        );
        if (field.type === "float") {
          values.push({ value: Number.EPSILON, label: "epsilon" });
          values.push({ value: Infinity, label: "infinity" });
          values.push({ value: NaN, label: "NaN" });
        }
        break;
      }
      case "string": {
        values.push(
          { value: "", label: "empty_string" },
          { value: " ", label: "whitespace" },
          { value: "a".repeat(c.max_length ?? 255), label: "max_length" },
          { value: "a".repeat((c.max_length ?? 255) + 1), label: "max_length+1" }
        );
        break;
      }
      case "enum": {
        values.push(
          { value: "", label: "empty_string" },
          { value: "INVALID_ENUM_VALUE", label: "invalid_enum" }
        );
        if (c.enum_values && c.enum_values.length > 0) {
          values.push({
            value: c.enum_values[0].toLowerCase(),
            label: "lowercase_variant",
          });
        }
        break;
      }
      case "array": {
        values.push(
          { value: [], label: "empty_array" },
          { value: [null], label: "array_with_null" }
        );
        if (c.max_items !== undefined) {
          const overflow = Array.from({ length: c.max_items + 1 }, () => "x");
          values.push({ value: overflow, label: "max_items+1" });
        }
        break;
      }
      case "bool": {
        values.push(
          { value: "true", label: "string_true" },
          { value: 1, label: "int_1" },
          { value: 0, label: "int_0" }
        );
        break;
      }
    }

    return values;
  }

  private async test(
    endpoint: HavocEndpoint,
    payload: any,
    pathParams: Record<string, string>,
    label: string
  ): Promise<void> {
    const response = await this.transport.send(endpoint, payload, pathParams);
    this.requestCount++;

    // GET/DELETE with no required body fields — mutations don't make input "invalid"
    const hasBodyFields = endpoint.input.fields.some(
      (f) => !endpoint.path.includes(`{${f.name}}`)
    );
    const wasInvalidInput = hasBodyFields || endpoint.input.required.length > 0;

    const bug = checkSchema(
      endpoint, payload, response, this.transport,
      "boundary_walker", 1, wasInvalidInput, pathParams
    );
    if (bug) {
      bug.description += ` (${label})`;
      this.addBug(bug);
    }

    // Oracle Layer 3: response schema validation
    if (response.status >= 200 && response.status < 300) {
      const schemaBugs = checkResponseSchema(
        endpoint, payload, response, this.transport,
        "boundary_walker", 1, pathParams
      );
      for (const sb of schemaBugs) {
        sb.description += ` (${label})`;
        this.addBug(sb);
      }
    }
  }

  private addBug(bug: Bug): void {
    // Deduplicate by fingerprint
    if (!this.bugs.some((b) => b.fingerprint === bug.fingerprint)) {
      this.bugs.push(bug);
    }
  }
}
