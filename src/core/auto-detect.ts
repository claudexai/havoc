const COMMON_SPEC_PATHS = [
  "/openapi.json",
  "/swagger.json",
  "/api-docs",
  "/docs/openapi.json",
  "/api/openapi.json",
  "/api/v1/openapi.json",
  "/api/swagger.json",
  "/v3/api-docs",
  "/v2/api-docs",
  "/api/documentation/v1.0.0",
  "/swagger/v1/swagger.json",
  "/documentation",
  "/documentation/json",
  "/api/docs",
];

const PROBE_TIMEOUT = 5000;

export async function autoDetectSpec(baseUrl: string): Promise<string | null> {
  // Normalize — strip trailing slash
  const base = baseUrl.replace(/\/+$/, "");

  for (const path of COMMON_SPEC_PATHS) {
    const url = `${base}${path}`;
    try {
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), PROBE_TIMEOUT);

      const res = await fetch(url, { signal: controller.signal });
      clearTimeout(timeout);

      if (res.status !== 200) continue;

      const text = await res.text();
      try {
        const json = JSON.parse(text);
        if (json.openapi || json.swagger) {
          return url;
        }
      } catch {
        // Not valid JSON — skip
      }
    } catch {
      // Connection error or timeout — skip
    }
  }

  return null;
}
