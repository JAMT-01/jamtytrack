import fs from "node:fs";
import path from "node:path";
import { backup, DatabaseSync } from "node:sqlite";

/** Preserve an existing diary, including committed WAL data, on first use of the new name. */
export async function localDatabasePath(dataDir: string) {
  const target = path.join(dataDir, "jamtytrack.db");
  const legacy = path.join(dataDir, "macroflow.db");
  if (!fs.existsSync(target) && fs.existsSync(legacy)) {
    const source = new DatabaseSync(legacy, { readOnly: true });
    const temporary = `${target}.${crypto.randomUUID()}.tmp`;
    try {
      await backup(source, temporary);
      // An exclusive copy never overwrites a diary created by another process.
      try {
        fs.copyFileSync(temporary, target, fs.constants.COPYFILE_EXCL);
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code !== "EEXIST") throw error;
      }
    } finally {
      source.close();
      fs.rmSync(temporary, { force: true });
    }
  }
  return target;
}
