import { HavocEndpoint, Field, AgentResult, Bug } from "../types/index.js";
import { HavocTransport } from "../transport/rest.js";
import { Seed } from "../core/seed.js";
import { Baseline } from "../core/baseline.js";
import { checkSchema } from "../oracles/schema.js";
import { checkResponseSchema } from "../oracles/response-schema.js";

// Type Shapeshifter: sends correct structure but wrong types.
// "2" instead of 2, float instead of int, object instead of array, etc.

export class TypeShapeshifter {
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
    console.log("  [Type Shapeshifter] Starting type confusion attacks...");

    for (const seedData of this.seeds) {
      const { endpoint, payload, pathParams } = seedData;

      for (const field of endpoint.input.fields) {
        if (endpoint.path.includes(`{${field.name}}`)) continue;

        const shapeshifts = this.getShapeshifts(field, payload[field.name]);
        for (const { value, label } of shapeshifts) {
          const mutated = { ...payload, [field.name]: value };
          await this.test(endpoint, mutated, pathParams, `${field.name}:${label}`);
        }
      }
    }

    const duration = performance.now() - start;
    console.log(
      `  [Type Shapeshifter] Done — ${this.requestCount} requests, ${this.bugs.length} bugs found`
    );

    return {
      agent: "type_shapeshifter",
      bugs: this.bugs,
      requests_sent: this.requestCount,
      duration,
    };
  }

  private getShapeshifts(
    field: Field,
    originalValue: any
  ): { value: any; label: string }[] {
    const shifts: { value: any; label: string }[] = [];

    switch (field.type) {
      case "int":
        shifts.push(
          { value: String(originalValue ?? 2), label: "string_of_int" },
          { value: 2.7, label: "float_instead" },
          { value: true, label: "bool_instead" },
          { value: [originalValue ?? 2], label: "array_instead" },
          { value: { value: originalValue ?? 2 }, label: "object_instead" },
          { value: "two", label: "word_string" },
          { value: "", label: "empty_string" },
          { value: "0x10", label: "hex_string" },
          { value: "1e5", label: "scientific_string" },
          { value: Number.MAX_SAFE_INTEGER + 1, label: "beyond_safe_int" }
        );
        break;

      case "float":
        shifts.push(
          { value: String(originalValue ?? 2.5), label: "string_of_float" },
          { value: Math.round(originalValue ?? 3), label: "int_instead" },
          { value: true, label: "bool_instead" },
          { value: "NaN", label: "string_nan" },
          { value: "Infinity", label: "string_infinity" },
          { value: [originalValue ?? 2.5], label: "array_instead" },
          { value: { value: originalValue ?? 2.5 }, label: "object_instead" }
        );
        break;

      case "string":
        shifts.push(
          { value: 12345, label: "int_instead" },
          { value: 3.14, label: "float_instead" },
          { value: true, label: "bool_instead" },
          { value: ["string"], label: "array_instead" },
          { value: { value: "string" }, label: "object_instead" },
          { value: "\0", label: "null_byte" },
          { value: "\u0000hidden\u0000", label: "embedded_null_bytes" },
          { value: "a".repeat(1_000_000), label: "1MB_string" }
        );
        break;

      case "bool":
        shifts.push(
          { value: "true", label: "string_true" },
          { value: "false", label: "string_false" },
          { value: 1, label: "int_1" },
          { value: 0, label: "int_0" },
          { value: "yes", label: "string_yes" },
          { value: null, label: "null_instead" },
          { value: [], label: "empty_array" }
        );
        break;

      case "enum":
        shifts.push(
          { value: 0, label: "int_instead" },
          { value: true, label: "bool_instead" },
          { value: [originalValue], label: "array_instead" },
          { value: null, label: "null_instead" }
        );
        break;

      case "array":
        shifts.push(
          { value: "not_an_array", label: "string_instead" },
          { value: { "0": "item" }, label: "object_instead" },
          { value: 42, label: "int_instead" },
          { value: true, label: "bool_instead" },
          { value: this.buildDeepNesting(50), label: "50_levels_deep" }
        );
        break;

      case "object":
        shifts.push(
          { value: "not_an_object", label: "string_instead" },
          { value: [originalValue], label: "array_instead" },
          { value: 42, label: "int_instead" },
          { value: true, label: "bool_instead" },
          { value: this.buildDeepNesting(50), label: "50_levels_deep" }
        );
        break;
    }

    return shifts;
  }

  private buildDeepNesting(depth: number): any {
    let obj: any = { value: "deep" };
    for (let i = 0; i < depth; i++) {
      obj = { nested: obj };
    }
    return obj;
  }

  private async test(
    endpoint: HavocEndpoint,
    payload: any,
    pathParams: Record<string, string>,
    mutation: string
  ): Promise<void> {
    const response = await this.transport.send(endpoint, payload, pathParams);
    this.requestCount++;

    // Check with Oracle Layer 1
    const bug = checkSchema(
      endpoint, payload, response, this.transport,
      "type_shapeshifter", 1, true
    );
    if (bug) {
      bug.description += ` (type_shift: ${mutation})`;
      this.addBug(bug);
    }

    // Check with Oracle Layer 3 — response schema
    if (response.status >= 200 && response.status < 300) {
      const schemaBugs = checkResponseSchema(
        endpoint, payload, response, this.transport,
        "type_shapeshifter", 1
      );
      for (const sb of schemaBugs) {
        sb.description += ` (type_shift: ${mutation})`;
        this.addBug(sb);
      }
    }
  }

  private addBug(bug: Bug): void {
    if (!this.bugs.some((b) => b.fingerprint === bug.fingerprint)) {
      this.bugs.push(bug);
    }
  }
}
