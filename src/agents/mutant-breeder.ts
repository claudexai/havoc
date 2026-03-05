import { HavocEndpoint, AgentResult, Bug } from "../types/index.js";
import { HavocTransport } from "../transport/rest.js";
import { Seed } from "../core/seed.js";
import { Baseline } from "../core/baseline.js";
import { checkSchema } from "../oracles/schema.js";
import { checkResponseSchema } from "../oracles/response-schema.js";

export class MutantBreeder {
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
    console.log("  [Mutant Breeder] Starting mutation attacks...");

    for (const seedData of this.seeds) {
      const { endpoint, payload, pathParams } = seedData;
      const fieldNames = Object.keys(payload);

      // Strategy 1: Remove one field at a time
      for (const field of fieldNames) {
        const mutated = { ...payload };
        delete mutated[field];
        await this.test(endpoint, mutated, pathParams, `remove_field:${field}`);
      }

      // Strategy 2: Duplicate fields with different cases
      for (const field of fieldNames) {
        const mutated = { ...payload, [field.toUpperCase()]: payload[field] };
        await this.test(endpoint, mutated, pathParams, `duplicate_case:${field}`);
      }

      // Strategy 3: Swap field values between fields
      if (fieldNames.length >= 2) {
        for (let i = 0; i < fieldNames.length - 1; i++) {
          const mutated = { ...payload };
          const temp = mutated[fieldNames[i]];
          mutated[fieldNames[i]] = mutated[fieldNames[i + 1]];
          mutated[fieldNames[i + 1]] = temp;
          await this.test(endpoint, mutated, pathParams, `swap:${fieldNames[i]}↔${fieldNames[i + 1]}`);
        }
      }

      // Strategy 4: Inject unexpected extra fields
      const injections: Record<string, any> = {
        is_admin: true,
        role: "admin",
        price_override: 0.01,
        discount: 100,
        __proto__: { admin: true },
        constructor: { prototype: { admin: true } },
      };
      for (const [key, value] of Object.entries(injections)) {
        const mutated = { ...payload, [key]: value };
        await this.test(endpoint, mutated, pathParams, `inject:${key}`);
      }

      // Strategy 5: Change valid values slightly
      for (const field of fieldNames) {
        const val = payload[field];
        if (typeof val === "number") {
          await this.test(endpoint, { ...payload, [field]: -val }, pathParams, `negate:${field}`);
          await this.test(endpoint, { ...payload, [field]: val * 1000 }, pathParams, `multiply:${field}`);
        }
        if (typeof val === "string") {
          await this.test(endpoint, { ...payload, [field]: val + "'" }, pathParams, `sql_probe:${field}`);
          await this.test(endpoint, { ...payload, [field]: val + "<script>" }, pathParams, `xss_probe:${field}`);
          await this.test(endpoint, { ...payload, [field]: "../../../etc/passwd" }, pathParams, `traversal:${field}`);
        }
      }

      // Strategy 6: Content type mutations — send form-encoded
      // (tested via raw body manipulation)
      const formBody = fieldNames
        .map((f) => `${encodeURIComponent(f)}=${encodeURIComponent(String(payload[f]))}`)
        .join("&");
      await this.test(endpoint, formBody, pathParams, "form_encoded_body");

      // Strategy 7: Trailing comma / malformed JSON edge cases
      await this.test(endpoint, undefined, pathParams, "undefined_body");
      await this.test(endpoint, "", pathParams, "empty_string_body");
      await this.test(endpoint, [], pathParams, "array_body");
      await this.test(endpoint, "null", pathParams, "string_null_body");
    }

    const duration = performance.now() - start;
    console.log(`  [Mutant Breeder] Done — ${this.requestCount} requests, ${this.bugs.length} bugs found`);

    return {
      agent: "mutant_breeder",
      bugs: this.bugs,
      requests_sent: this.requestCount,
      duration,
    };
  }

  private async test(
    endpoint: HavocEndpoint,
    payload: any,
    pathParams: Record<string, string>,
    mutation: string
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
      "mutant_breeder", 1, wasInvalidInput, pathParams
    );
    if (bug) {
      bug.description += ` (mutation: ${mutation})`;
      if (!this.bugs.some((b) => b.fingerprint === bug.fingerprint)) {
        this.bugs.push(bug);
      }
    }

    // Oracle Layer 3: response schema validation
    if (response.status >= 200 && response.status < 300) {
      const schemaBugs = checkResponseSchema(
        endpoint, payload, response, this.transport,
        "mutant_breeder", 1, pathParams
      );
      for (const sb of schemaBugs) {
        sb.description += ` (mutation: ${mutation})`;
        if (!this.bugs.some((b) => b.fingerprint === sb.fingerprint)) {
          this.bugs.push(sb);
        }
      }
    }
  }
}
