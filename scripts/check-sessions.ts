/**
 * Debug helper: list the REAL persisted sessions the TUI runtime has written
 * (compression-none JSONL under the configured root), verifying the restore
 * path reads them correctly.
 */
import { listSessionLogs } from "../src/harness";

const logs = listSessionLogs();
console.log(`found ${logs.length} persisted session(s)\n`);
for (const { log, summary } of logs) {
  console.log(`id        ${summary.id}`);
  console.log(`file      ${log}`);
  console.log(`title     ${summary.title || "(none)"}`);
  console.log(`created   ${new Date(summary.createdAt).toLocaleString()}`);
  console.log(`updated   ${new Date(summary.updatedAt).toLocaleString()}`);
  console.log(`turns     ${summary.turns}`);
  console.log(`events    ${summary.events.length}`);
  console.log("---");
}
