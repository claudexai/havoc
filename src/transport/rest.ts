import { HavocEndpoint, HavocResponse } from "../types/index.js";

export class HavocTransport {
  constructor(
    private baseUrl: string,
    private defaultHeaders: Record<string, string> = {}
  ) {}

  async send(
    endpoint: HavocEndpoint,
    payload: any,
    pathParams?: Record<string, string>
  ): Promise<HavocResponse> {
    let url = endpoint.path;
    // Replace path parameters
    if (pathParams) {
      for (const [key, value] of Object.entries(pathParams)) {
        url = url.replace(`{${key}}`, encodeURIComponent(value));
      }
    }

    const fullUrl = `${this.baseUrl}${url}`;
    const headers: Record<string, string> = {
      "Content-Type": "application/json",
      ...this.defaultHeaders,
    };

    const hasBody = ["POST", "PUT", "PATCH"].includes(endpoint.method);

    const start = performance.now();
    try {
      const res = await fetch(fullUrl, {
        method: endpoint.method,
        headers,
        body: hasBody ? JSON.stringify(payload) : undefined,
      });
      const timing = performance.now() - start;

      let body: any;
      const contentType = res.headers.get("content-type") || "";
      if (contentType.includes("application/json")) {
        body = await res.json();
      } else {
        body = await res.text();
      }

      const responseHeaders: Record<string, string> = {};
      res.headers.forEach((value, key) => {
        responseHeaders[key] = value;
      });

      return {
        status: res.status,
        body,
        errors: [],
        timing,
        headers: responseHeaders,
      };
    } catch (err: any) {
      const timing = performance.now() - start;
      return {
        status: 0,
        body: null,
        errors: [{ message: err.message }],
        timing,
        headers: {},
      };
    }
  }

  buildCurl(
    endpoint: HavocEndpoint,
    payload: any,
    pathParams?: Record<string, string>
  ): string {
    let url = endpoint.path;
    if (pathParams) {
      for (const [key, value] of Object.entries(pathParams)) {
        url = url.replace(`{${key}}`, encodeURIComponent(value));
      }
    }
    const fullUrl = `${this.baseUrl}${url}`;

    const parts = [`curl -X ${endpoint.method}`];
    parts.push(`'${fullUrl}'`);

    const headers = { "Content-Type": "application/json", ...this.defaultHeaders };
    for (const [key, value] of Object.entries(headers)) {
      parts.push(`-H '${key}: ${value}'`);
    }

    if (["POST", "PUT", "PATCH"].includes(endpoint.method) && payload !== undefined) {
      parts.push(`-d '${JSON.stringify(payload)}'`);
    }

    return parts.join(" \\\n  ");
  }
}
