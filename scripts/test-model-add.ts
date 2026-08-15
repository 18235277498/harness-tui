import { mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";

const base = mkdtempSync(join(tmpdir(), "dsh-add-"));
const home = join(base, "home");
const sessions = join(base, "sessions");
process.env.DSH_HOME = home;
process.env.DSH_SESSION_ROOT = sessions;

const { addCustomProvider, userModels } = await import("../src/harness");
addCustomProvider({
  provider: "test-gw",
  api: "openai-completions",
  baseURL: "http://localhost:9999/v1",
  apiKeyEnv: "TEST_KEY",
  apiKey: "abc123",
  model: "test-model",
  label: "Test Model",
});
console.log("userModels:", JSON.stringify(userModels));
console.log("--- settings.yaml ---");
console.log(readFileSync(join(home, "settings.yaml"), "utf8"));
console.log("--- .credentials.yaml ---");
console.log(readFileSync(join(home, ".credentials.yaml"), "utf8").trim());
writeFileSync(join(base, "ok"), "done");
process.exit(0);
