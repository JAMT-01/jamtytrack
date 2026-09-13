import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { DatabaseSync } from "node:sqlite";
import { afterEach, expect, it } from "vitest";
import { localDatabasePath } from "./local-database.js";

const directories: string[] = [];
afterEach(() => { for (const directory of directories.splice(0)) fs.rmSync(directory, { recursive: true, force: true }); });
function directory() { const value = fs.mkdtempSync(path.join(os.tmpdir(), "jamtytrack-db-")); directories.push(value); return value; }

it("copies committed WAL data and preserves the old diary as a backup", async () => {
  const dir = directory();
  const old = new DatabaseSync(path.join(dir, "macroflow.db"));
  try {
    old.exec("PRAGMA journal_mode=WAL; CREATE TABLE diary (value TEXT); INSERT INTO diary VALUES ('kept');");
    const migrated = new DatabaseSync(await localDatabasePath(dir));
    try { expect(migrated.prepare("SELECT value FROM diary").get()?.value).toBe("kept"); }
    finally { migrated.close(); }
    expect(old.prepare("SELECT COUNT(*) AS count FROM diary").get()?.count).toBe(1);
  } finally { old.close(); }
});

it("never replaces an existing Jamtytrack diary", async () => {
  const dir = directory();
  fs.writeFileSync(path.join(dir, "macroflow.db"), "legacy");
  const target = path.join(dir, "jamtytrack.db");
  fs.writeFileSync(target, "current");
  expect(await localDatabasePath(dir)).toBe(target);
  expect(fs.readFileSync(target, "utf8")).toBe("current");
});

it("returns the new name without creating an empty diary when no old file exists", async () => {
  const dir = directory();
  expect(await localDatabasePath(dir)).toBe(path.join(dir, "jamtytrack.db"));
  expect(fs.readdirSync(dir)).toEqual([]);
});
