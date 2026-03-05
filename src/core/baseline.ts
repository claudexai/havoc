import { HavocTransport } from "../transport/rest.js";
import { HavocResponse } from "../types/index.js";
import { Seed } from "./seed.js";

export interface Baseline {
  seed: Seed;
  responses: HavocResponse[];
  avgTiming: number;
  expectedStatus: number;
  responseSchema: string; // JSON stringified keys for quick comparison
}

const BASELINE_ITERATIONS = 5;

export async function runBaseline(
  transport: HavocTransport,
  seeds: Seed[]
): Promise<Baseline[]> {
  const baselines: Baseline[] = [];

  for (const seed of seeds) {
    const responses: HavocResponse[] = [];

    for (let i = 0; i < BASELINE_ITERATIONS; i++) {
      const res = await transport.send(seed.endpoint, seed.payload, seed.pathParams);
      responses.push(res);
    }

    const validResponses = responses.filter((r) => r.status > 0);
    const avgTiming =
      validResponses.length > 0
        ? validResponses.reduce((sum, r) => sum + r.timing, 0) / validResponses.length
        : 0;

    const expectedStatus = validResponses.length > 0 ? validResponses[0].status : 0;

    // Extract response shape for schema comparison
    const responseSchema =
      validResponses.length > 0 && typeof validResponses[0].body === "object"
        ? JSON.stringify(extractKeys(validResponses[0].body))
        : "";

    baselines.push({
      seed,
      responses,
      avgTiming,
      expectedStatus,
      responseSchema,
    });
  }

  return baselines;
}

function extractKeys(obj: any, prefix = ""): string[] {
  if (obj === null || typeof obj !== "object") return [];
  if (Array.isArray(obj)) {
    if (obj.length > 0) {
      return extractKeys(obj[0], `${prefix}[]`);
    }
    return [`${prefix}[]`];
  }
  const keys: string[] = [];
  for (const [key, value] of Object.entries(obj)) {
    const path = prefix ? `${prefix}.${key}` : key;
    keys.push(path);
    if (typeof value === "object" && value !== null) {
      keys.push(...extractKeys(value, path));
    }
  }
  return keys;
}
