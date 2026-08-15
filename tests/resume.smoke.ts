/**
 * Launch resume policy: a relaunch continues the last persisted session, while
 * a session id recorded in the TUI state but never persisted (no turn ever
 * ran) is ignored — empty sessions must not come back, so the next launch
 * falls back to a fresh session.
 */
import { describe, expect, test } from "vitest";
import { pickResumeId } from "../src/harness";

function logs(ids: string[]): Array<{ summary: { id: string } }> {
  return ids.map((id) => ({ summary: { id } }));
}

describe("launch resume policy", () => {
  test("resumes the last persisted session", () => {
    const state = { activeSessionId: "session-persisted" };
    expect(pickResumeId(state, logs(["session-old", "session-persisted"]))).toBe("session-persisted");
  });

  test("ignores a recorded id that never hit disk (empty session)", () => {
    const state = { activeSessionId: "session-never-run" };
    expect(pickResumeId(state, logs(["session-persisted"]))).toBe("");
  });

  test("returns empty when nothing was recorded", () => {
    expect(pickResumeId({ activeSessionId: "" }, logs(["session-persisted"]))).toBe("");
  });
});
