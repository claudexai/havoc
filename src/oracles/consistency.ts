import { HavocEndpoint, HavocResponse, Bug } from "../types/index.js";
import { HavocTransport } from "../transport/rest.js";
import { Seed } from "../core/seed.js";
import { hashFingerprint } from "../core/fingerprint.js";

// Oracle Layer 2: Self-Consistency Checks
// POST creates resource → GET it back → compare data matches
// DELETE → GET → should be 404
// List → should contain created item

export class ConsistencyChecker {
  private bugs: Bug[] = [];
  private requestCount = 0;

  constructor(
    private transport: HavocTransport,
    private endpoints: HavocEndpoint[],
    private seeds: Seed[]
  ) {}

  async run(agent: string, generation: number): Promise<{ bugs: Bug[]; requests: number }> {
    // Find endpoint pairs: POST + GET, POST + DELETE + GET
    const postEndpoints = this.endpoints.filter((e) => e.method === "POST" && e.creates_resource);
    const getEndpoints = this.endpoints.filter((e) => e.method === "GET");
    const deleteEndpoints = this.endpoints.filter((e) => e.method === "DELETE");
    const listEndpoints = this.endpoints.filter(
      (e) => e.method === "GET" && !e.path.includes("{")
    );

    for (const postEp of postEndpoints) {
      const postSeed = this.seeds.find((s) => s.endpoint.id === postEp.id);
      if (!postSeed) continue;

      // 1. Create resource
      const createRes = await this.transport.send(postEp, postSeed.payload, postSeed.pathParams);
      this.requestCount++;
      if (createRes.status < 200 || createRes.status >= 300) continue;

      const createdId = this.extractId(createRes.body, postEp.resource_id_field);
      if (!createdId) continue;

      // 2. Find matching GET endpoint (same resource path pattern)
      const getEp = this.findGetEndpoint(postEp, getEndpoints);
      if (getEp) {
        // Create → Read consistency
        const getRes = await this.transport.send(getEp, undefined, { id: createdId });
        this.requestCount++;

        if (getRes.status >= 200 && getRes.status < 300) {
          const mismatches = this.compareFields(postSeed.payload, getRes.body, postEp);
          for (const mismatch of mismatches) {
            this.bugs.push(this.makeBug(
              postEp, postSeed.payload, getRes, agent, generation,
              "high",
              "Create-Read inconsistency",
              `${postEp.id}: created with ${mismatch.field}=${JSON.stringify(mismatch.sent)} but read back ${JSON.stringify(mismatch.received)}`
            ));
          }
        } else if (getRes.status === 404) {
          this.bugs.push(this.makeBug(
            postEp, postSeed.payload, getRes, agent, generation,
            "high",
            "Created resource not found",
            `${postEp.id}: created resource with id=${createdId} but GET returned 404`
          ));
        }
      }

      // 3. Check list endpoint contains created item
      const listEp = this.findListEndpoint(postEp, listEndpoints);
      if (listEp) {
        const listRes = await this.transport.send(listEp, undefined);
        this.requestCount++;

        if (listRes.status >= 200 && listRes.status < 300) {
          const found = this.findInList(listRes.body, createdId);
          if (!found) {
            this.bugs.push(this.makeBug(
              listEp, undefined, listRes, agent, generation,
              "medium",
              "Created item missing from list",
              `${postEp.id}: created resource id=${createdId} not found in ${listEp.id} response`
            ));
          }

          // Check count field consistency
          this.checkCountConsistency(listEp, listRes, agent, generation);
        }
      }

      // 4. Delete → GET should be 404
      const deleteEp = this.findDeleteEndpoint(postEp, deleteEndpoints);
      if (deleteEp && getEp) {
        const deleteRes = await this.transport.send(deleteEp, undefined, { id: createdId });
        this.requestCount++;

        if (deleteRes.status >= 200 && deleteRes.status < 300) {
          const getAfterDelete = await this.transport.send(getEp, undefined, { id: createdId });
          this.requestCount++;

          if (getAfterDelete.status !== 404) {
            this.bugs.push(this.makeBug(
              deleteEp, undefined, getAfterDelete, agent, generation,
              "high",
              "Delete did not remove resource",
              `Deleted resource id=${createdId} but GET returned ${getAfterDelete.status} instead of 404`
            ));
          }
        }
      }
    }

    // 5. Idempotent GET check — same GET twice should return same result
    for (const getEp of getEndpoints.filter((e) => !e.path.includes("{"))) {
      const res1 = await this.transport.send(getEp, undefined);
      const res2 = await this.transport.send(getEp, undefined);
      this.requestCount += 2;

      if (
        res1.status === res2.status &&
        res1.status >= 200 &&
        res1.status < 300 &&
        JSON.stringify(res1.body) !== JSON.stringify(res2.body)
      ) {
        this.bugs.push(this.makeBug(
          getEp, undefined, res2, agent, generation,
          "medium",
          "Non-idempotent GET",
          `${getEp.id}: two identical GETs returned different responses`
        ));
      }
    }

    return { bugs: this.bugs, requests: this.requestCount };
  }

  private extractId(body: any, idField: string): string | null {
    if (!body || typeof body !== "object") return null;
    const value = body[idField] || body.id || body._id;
    return value ? String(value) : null;
  }

  private findGetEndpoint(postEp: HavocEndpoint, getEndpoints: HavocEndpoint[]): HavocEndpoint | undefined {
    // POST /products → GET /products/{id}
    const basePath = postEp.path;
    return getEndpoints.find(
      (e) => e.path.startsWith(basePath + "/{") || e.path.startsWith(basePath + "/:")
    );
  }

  private findListEndpoint(postEp: HavocEndpoint, listEndpoints: HavocEndpoint[]): HavocEndpoint | undefined {
    return listEndpoints.find((e) => e.path === postEp.path);
  }

  private findDeleteEndpoint(postEp: HavocEndpoint, deleteEndpoints: HavocEndpoint[]): HavocEndpoint | undefined {
    const basePath = postEp.path;
    return deleteEndpoints.find(
      (e) => e.path.startsWith(basePath + "/{") || e.path.startsWith(basePath + "/:")
    );
  }

  private compareFields(
    sent: Record<string, any>,
    received: any,
    endpoint: HavocEndpoint
  ): { field: string; sent: any; received: any }[] {
    if (!received || typeof received !== "object") return [];
    const mismatches: { field: string; sent: any; received: any }[] = [];

    for (const [key, sentValue] of Object.entries(sent)) {
      if (key in received) {
        const receivedValue = received[key];
        // Loose comparison — allow string/number coercion for IDs
        if (typeof sentValue !== typeof receivedValue && key !== "id" && key !== "_id") {
          mismatches.push({ field: key, sent: sentValue, received: receivedValue });
        } else if (JSON.stringify(sentValue) !== JSON.stringify(receivedValue)) {
          mismatches.push({ field: key, sent: sentValue, received: receivedValue });
        }
      }
    }

    return mismatches;
  }

  private checkCountConsistency(
    endpoint: HavocEndpoint,
    response: HavocResponse,
    agent: string,
    generation: number
  ): void {
    const body = response.body;
    if (!body || typeof body !== "object") return;

    // Check if count/total field matches actual item count
    const items = body.items || body.data || body.results;
    if (!Array.isArray(items)) return;

    const countField = body.count ?? body.total_count;
    if (countField !== undefined && typeof countField === "number") {
      // count should be >= items.length (could be total count with pagination)
      // but if count < items.length, that's a bug
      if (countField < items.length) {
        this.bugs.push(this.makeBug(
          endpoint, undefined, response, agent, generation,
          "medium",
          "Count field mismatch",
          `${endpoint.id}: count=${countField} but response contains ${items.length} items`
        ));
      }
    }
  }

  private findInList(body: any, id: string): boolean {
    if (!body || typeof body !== "object") return false;
    const items = body.items || body.data || body.results || (Array.isArray(body) ? body : []);
    if (!Array.isArray(items)) return false;
    return items.some(
      (item: any) => item && (String(item.id) === id || String(item._id) === id)
    );
  }

  private makeBug(
    endpoint: HavocEndpoint,
    payload: any,
    response: HavocResponse,
    agent: string,
    generation: number,
    severity: Bug["severity"],
    title: string,
    description: string
  ): Bug {
    const fingerprint = hashFingerprint(endpoint.id, title, description);
    return {
      id: fingerprint,
      fingerprint,
      endpoint,
      agent,
      generation,
      oracle_layer: 2,
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
      curl: this.transport.buildCurl(endpoint, payload),
    };
  }

}
