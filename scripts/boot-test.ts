/**
 * Boot test: connect + prompt against whatever DSH_CONFIG points to, to verify
 * a config variant (e.g. the sandbox one) boots and runs a real turn.
 */
import { connect, prompt, session } from "../src/harness";

const t0 = Date.now();
await connect();
console.log(`[connect] ok in ${Date.now() - t0}ms — id=${session.id} model=${session.model}`);
await prompt("Reply with exactly: pong");
console.log(`[prompt] done in ${Date.now() - t0}ms`);
console.log(`  error=${JSON.stringify(session.error)} status=${session.status} turns=${session.turns.length}`);
const t = session.turns.at(-1);
console.log(`  turn endReason=${t?.endReason} endError=${JSON.stringify(t?.endError)} assistant=${JSON.stringify(t?.assistant)?.slice(0, 120)} tools=${t?.tools.length}`);
console.log(`  stats=${JSON.stringify(session.stats)}`);
process.exit(0);
