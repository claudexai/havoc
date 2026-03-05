import Database from "better-sqlite3";
import path from "path";
import fs from "fs";
import os from "os";
import { Bug } from "../types/index.js";

const HAVOC_DIR = path.join(os.homedir(), ".havoc");
const DB_PATH = path.join(HAVOC_DIR, "history.db");

export interface TrackedBug {
  fingerprint: string;
  first_seen: string;
  last_seen: string;
  status: "open" | "fixed" | "regression";
  severity: string;
  title: string;
  endpoint_id: string;
  agent: string;
  occurrences: number;
}

export interface RunRecord {
  id: number;
  timestamp: string;
  url: string;
  endpoint_count: number;
  bug_count: number;
  new_bug_count: number;
  regression_count: number;
  duration_ms: number;
}

export class BugTracker {
  private db: Database.Database;

  constructor() {
    fs.mkdirSync(HAVOC_DIR, { recursive: true });
    this.db = new Database(DB_PATH);
    this.db.pragma("journal_mode = WAL");
    this.migrate();
  }

  private migrate(): void {
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS bugs (
        fingerprint TEXT PRIMARY KEY,
        first_seen TEXT NOT NULL,
        last_seen TEXT NOT NULL,
        status TEXT NOT NULL DEFAULT 'open',
        severity TEXT NOT NULL,
        title TEXT NOT NULL,
        endpoint_id TEXT NOT NULL,
        agent TEXT NOT NULL,
        occurrences INTEGER NOT NULL DEFAULT 1
      );

      CREATE TABLE IF NOT EXISTS runs (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        timestamp TEXT NOT NULL,
        url TEXT NOT NULL,
        endpoint_count INTEGER NOT NULL,
        bug_count INTEGER NOT NULL,
        new_bug_count INTEGER NOT NULL DEFAULT 0,
        regression_count INTEGER NOT NULL DEFAULT 0,
        duration_ms INTEGER NOT NULL
      );
    `);
  }

  trackBugs(bugs: Bug[], url: string, endpointCount: number, durationMs: number): {
    newBugs: Bug[];
    regressions: Bug[];
    knownBugs: Bug[];
  } {
    const now = new Date().toISOString();
    const newBugs: Bug[] = [];
    const regressions: Bug[] = [];
    const knownBugs: Bug[] = [];

    const getStmt = this.db.prepare("SELECT * FROM bugs WHERE fingerprint = ?");
    const insertStmt = this.db.prepare(`
      INSERT INTO bugs (fingerprint, first_seen, last_seen, status, severity, title, endpoint_id, agent, occurrences)
      VALUES (?, ?, ?, 'open', ?, ?, ?, ?, 1)
    `);
    const updateStmt = this.db.prepare(`
      UPDATE bugs SET last_seen = ?, status = ?, severity = ?, occurrences = occurrences + 1
      WHERE fingerprint = ?
    `);

    const trackAll = this.db.transaction(() => {
      // Mark all currently open bugs as potentially fixed
      const openFingerprints = new Set(
        (this.db.prepare("SELECT fingerprint FROM bugs WHERE status = 'open'").all() as any[])
          .map((r) => r.fingerprint)
      );

      const seenFingerprints = new Set<string>();

      for (const bug of bugs) {
        seenFingerprints.add(bug.fingerprint);
        const existing = getStmt.get(bug.fingerprint) as TrackedBug | undefined;

        if (!existing) {
          // Brand new bug
          insertStmt.run(
            bug.fingerprint, now, now, bug.severity,
            bug.title, bug.endpoint.id, bug.agent
          );
          newBugs.push(bug);
        } else if (existing.status === "fixed") {
          // Was fixed, now it's back — regression
          updateStmt.run(now, "regression", bug.severity, bug.fingerprint);
          regressions.push(bug);
        } else {
          // Known open bug, update last_seen
          updateStmt.run(now, "open", bug.severity, bug.fingerprint);
          knownBugs.push(bug);
        }
      }

      // Bugs that were open but not seen this run → mark as fixed
      const markFixed = this.db.prepare(
        "UPDATE bugs SET status = 'fixed', last_seen = ? WHERE fingerprint = ?"
      );
      for (const fp of openFingerprints) {
        if (!seenFingerprints.has(fp)) {
          markFixed.run(now, fp);
        }
      }

      // Record the run
      this.db.prepare(`
        INSERT INTO runs (timestamp, url, endpoint_count, bug_count, new_bug_count, regression_count, duration_ms)
        VALUES (?, ?, ?, ?, ?, ?, ?)
      `).run(now, url, endpointCount, bugs.length, newBugs.length, regressions.length, Math.round(durationMs));
    });

    trackAll();

    return { newBugs, regressions, knownBugs };
  }

  getHistory(limit = 10): RunRecord[] {
    return this.db.prepare(
      "SELECT * FROM runs ORDER BY id DESC LIMIT ?"
    ).all(limit) as RunRecord[];
  }

  getOpenBugs(): TrackedBug[] {
    return this.db.prepare(
      "SELECT * FROM bugs WHERE status IN ('open', 'regression') ORDER BY severity"
    ).all() as TrackedBug[];
  }

  close(): void {
    this.db.close();
  }
}
