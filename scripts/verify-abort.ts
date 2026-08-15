import { connect, prompt, abortSession, session } from "../src/harness";

const t0 = Date.now();
await connect();
console.log(`[${Date.now() - t0}ms] connected id=${session.id.slice(0, 12)} turns=${session.turns.length}`);
const p = prompt("Reply with exactly: pong");
await new Promise((r) => setTimeout(r, 400)); // catch the turn mid-run
console.log(`[${Date.now() - t0}ms] before abort: status=${session.status}`);
const ok = await abortSession();
console.log(`[${Date.now() - t0}ms] abort accepted: ${ok}`);
await p.catch(() => {});
await new Promise((r) => setTimeout(r, 500));
console.log(`[${Date.now() - t0}ms] settled: status=${session.status} turns=${session.turns.length}`);
const t = session.turns.at(-1);
console.log(`  last turn user=${JSON.stringify(t?.user)?.slice(0, 30)} endReason=${t?.endReason} assistant=${JSON.stringify(t?.assistant)?.slice(0, 60)}`);
process.exit(0);
