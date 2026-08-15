import { connect, prompt, session } from "../src/harness";

await connect();
console.log("connected, fresh session id:", session.id.slice(0, 16), "turns:", session.turns.length);
await prompt("Reply with exactly: pong");
console.log("after prompt: turns=", session.turns.length);
session.turns.forEach((t, i) => {
  console.log(`  [${i}] user=${JSON.stringify(t.user)?.slice(0, 30)} assistant=${JSON.stringify(t.assistant)?.slice(0, 40)} reason=${t.endReason}`);
});
process.exit(0);
