import { connect, setPermission, session } from "../src/harness";
await connect();
console.log("fresh session id:", session.id, "turns:", session.turns.length);
const perm = await setPermission("read-only");
console.log("setPermission(read-only) on FRESH session accepted:", perm, "| error:", JSON.stringify(session.error));
process.exit(0);
