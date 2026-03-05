import { describe, it, expect } from "vitest";
import { checkFailOn } from "../src/core/runner.js";
import { Bug, HavocEndpoint, HavocResponse } from "../src/types/index.js";

function makeBug(severity: Bug["severity"] = "high"): Bug {
  const endpoint: HavocEndpoint = {
    id: "POST /test",
    name: "test",
    method: "POST",
    path: "/test",
    protocol: "rest",
    input: { fields: [], required: [] },
    output: { fields: [], errors: [] },
    dependencies: [],
    creates_resource: false,
    resource_id_field: "",
  };
  const response: HavocResponse = {
    status: 500,
    body: {},
    errors: [],
    timing: 10,
    headers: {},
  };
  return {
    id: "fp_001",
    fingerprint: "fp_001",
    endpoint,
    agent: "test",
    generation: 1,
    oracle_layer: 1,
    severity,
    title: "Test bug",
    description: "A test bug",
    request: { method: "POST", path: "/test", headers: {}, body: {} },
    response,
    curl: "curl http://localhost/test",
  };
}

describe("--fail-on", () => {
  describe("any_bugs", () => {
    it("fails when there are bugs", () => {
      expect(checkFailOn("any_bugs", [makeBug()], [], [])).toBe(true);
    });

    it("passes when there are no bugs", () => {
      expect(checkFailOn("any_bugs", [], [], [])).toBe(false);
    });
  });

  describe("new_bugs", () => {
    it("fails when there are new bugs", () => {
      const bug = makeBug();
      expect(checkFailOn("new_bugs", [bug], [bug], [])).toBe(true);
    });

    it("passes when all bugs are known (not new)", () => {
      expect(checkFailOn("new_bugs", [makeBug()], [], [])).toBe(false);
    });

    it("passes when there are no bugs at all", () => {
      expect(checkFailOn("new_bugs", [], [], [])).toBe(false);
    });
  });

  describe("regressions", () => {
    it("fails when there are regressions", () => {
      const bug = makeBug();
      expect(checkFailOn("regressions", [bug], [], [bug])).toBe(true);
    });

    it("passes when there are no regressions", () => {
      expect(checkFailOn("regressions", [makeBug()], [], [])).toBe(false);
    });
  });

  describe("critical", () => {
    it("fails when there are critical bugs", () => {
      expect(checkFailOn("critical", [makeBug("critical")], [], [])).toBe(true);
    });

    it("passes when bugs exist but none are critical", () => {
      expect(checkFailOn("critical", [makeBug("high"), makeBug("medium")], [], [])).toBe(false);
    });

    it("passes when there are no bugs", () => {
      expect(checkFailOn("critical", [], [], [])).toBe(false);
    });
  });

  describe("unknown condition", () => {
    it("passes for unknown condition", () => {
      expect(checkFailOn("unknown_thing", [makeBug()], [], [])).toBe(false);
    });
  });
});
