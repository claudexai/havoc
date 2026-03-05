import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { BugTracker } from "../src/core/bug-tracker.js";
import { Bug, HavocEndpoint, HavocResponse } from "../src/types/index.js";
import fs from "fs";
import path from "path";
import os from "os";

const DB_PATH = path.join(os.homedir(), ".havoc", "history.db");

function makeBug(fingerprint: string, severity: Bug["severity"] = "high"): Bug {
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
    id: fingerprint,
    fingerprint,
    endpoint,
    agent: "test_agent",
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

describe("Bug Tracker", () => {
  let tracker: BugTracker;

  beforeEach(() => {
    // Remove existing DB + WAL/SHM for clean tests
    for (const suffix of ["", "-wal", "-shm"]) {
      const p = DB_PATH + suffix;
      if (fs.existsSync(p)) fs.unlinkSync(p);
    }
    tracker = new BugTracker();
  });

  afterEach(() => {
    tracker.close();
  });

  it("tracks new bugs", () => {
    const bugs = [makeBug("fp_001"), makeBug("fp_002")];
    const result = tracker.trackBugs(bugs, "http://localhost:3000", 5, 1000);

    expect(result.newBugs.length).toBe(2);
    expect(result.regressions.length).toBe(0);
    expect(result.knownBugs.length).toBe(0);
  });

  it("recognizes known bugs on second run", () => {
    const bugs = [makeBug("fp_001")];
    tracker.trackBugs(bugs, "http://localhost:3000", 5, 1000);

    // Second run with same bug
    const result = tracker.trackBugs(bugs, "http://localhost:3000", 5, 1000);
    expect(result.newBugs.length).toBe(0);
    expect(result.knownBugs.length).toBe(1);
  });

  it("detects regressions", () => {
    const bugs = [makeBug("fp_001")];

    // Run 1: bug found
    tracker.trackBugs(bugs, "http://localhost:3000", 5, 1000);

    // Run 2: bug gone (fixed)
    tracker.trackBugs([], "http://localhost:3000", 5, 1000);

    // Run 3: bug is back (regression)
    const result = tracker.trackBugs(bugs, "http://localhost:3000", 5, 1000);
    expect(result.regressions.length).toBe(1);
    expect(result.newBugs.length).toBe(0);
  });

  it("records run history", () => {
    tracker.trackBugs([makeBug("fp_001")], "http://localhost:3000", 5, 1000);
    tracker.trackBugs([makeBug("fp_001"), makeBug("fp_002")], "http://localhost:3000", 5, 2000);

    const history = tracker.getHistory();
    expect(history.length).toBe(2);
    expect(history[0].bug_count).toBe(2); // most recent first
    expect(history[1].bug_count).toBe(1);
  });

  it("lists open bugs", () => {
    tracker.trackBugs(
      [makeBug("fp_001", "critical"), makeBug("fp_002", "low")],
      "http://localhost:3000", 5, 1000
    );

    const open = tracker.getOpenBugs();
    expect(open.length).toBe(2);
    expect(open[0].fingerprint).toBe("fp_001");
  });

  it("marks bugs as fixed when they disappear", () => {
    tracker.trackBugs([makeBug("fp_001")], "http://localhost:3000", 5, 1000);
    tracker.trackBugs([], "http://localhost:3000", 5, 1000);

    const open = tracker.getOpenBugs();
    expect(open.length).toBe(0);
  });
});
