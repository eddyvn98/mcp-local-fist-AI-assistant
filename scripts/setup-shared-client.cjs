#!/usr/bin/env node
const fs = require("fs");
const path = require("path");

function parseArgs(argv) {
  const out = {};
  for (let i = 0; i < argv.length; i += 1) {
    const item = argv[i];
    if (!item.startsWith("--")) continue;
    const key = item.slice(2);
    const next = argv[i + 1];
    if (!next || next.startsWith("--")) {
      out[key] = "true";
      continue;
    }
    out[key] = next;
    i += 1;
  }
  return out;
}

function toEnvLine(key, value) {
  const safe = String(value ?? "").replace(/"/g, '\\"');
  return `${key}="${safe}"`;
}

function upsertEnvBlock(existing, updates) {
  const lines = existing ? existing.split(/\r?\n/) : [];
  const map = new Map();
  lines.forEach((line, idx) => {
    const m = line.match(/^\s*([A-Za-z_][A-Za-z0-9_]*)\s*=/);
    if (m) map.set(m[1], idx);
  });

  const output = [...lines];
  Object.entries(updates).forEach(([key, value]) => {
    const line = toEnvLine(key, value);
    if (map.has(key)) {
      output[map.get(key)] = line;
    } else {
      output.push(line);
    }
  });

  return `${output.filter(Boolean).join("\n")}\n`;
}

function main() {
  const args = parseArgs(process.argv.slice(2));
  const qdrantUrl = args["qdrant-url"];
  if (!qdrantUrl) {
    console.error("Missing required --qdrant-url");
    console.error("Example: node scripts/setup-shared-client.cjs --qdrant-url http://192.168.1.10:6333");
    process.exit(1);
  }

  const root = process.cwd();
  const envPath = path.join(root, ".env.local");
  const existing = fs.existsSync(envPath) ? fs.readFileSync(envPath, "utf8") : "";

  const updates = {
    MEMORY_PROVIDER: "qdrant",
    START_LOCAL_QDRANT: "false",
    QDRANT_URL: qdrantUrl,
    QDRANT_API_KEY: args["qdrant-api-key"] || "",
    QDRANT_COLLECTION: args["qdrant-collection"] || "memory_entries",
    QDRANT_VECTOR_SIZE: args["qdrant-vector-size"] || "768",
    PORT: args.port || "3000",
  };

  const next = upsertEnvBlock(existing, updates);
  fs.writeFileSync(envPath, next, "utf8");

  console.log("Updated .env.local for shared-client mode:");
  Object.entries(updates).forEach(([k, v]) => {
    console.log(`- ${k}=${v}`);
  });
}

main();
