const path = require("path");
const dotenv = require("dotenv");

dotenv.config({ path: path.join(__dirname, ".env.local") });

const toBool = (value, fallback = false) => {
  if (value == null || value === "") return fallback;
  return String(value).toLowerCase() === "true";
};

const startLocalQdrant = toBool(process.env.START_LOCAL_QDRANT, true);
const enableCloudflared = toBool(process.env.ENABLE_CLOUDFLARED, false);

const apps = [];

if (startLocalQdrant) {
  apps.push({
    name: "qdrant",
    script: "./qdrant/qdrant.exe",
    cwd: __dirname,
    env: {
      QDRANT__SERVICE__HOST: process.env.QDRANT_BIND_HOST || "127.0.0.1",
      QDRANT__SERVICE__HTTP_PORT: process.env.QDRANT_BIND_PORT || "6333",
      QDRANT__SERVICE__API_KEY: process.env.QDRANT_API_KEY || "",
    },
  });
}

apps.push({
  name: "mcp-assistant",
  cwd: __dirname,
  script: "D:/nodejs/node.exe",
  args: "--import tsx server.ts",
  env: {
    NODE_ENV: process.env.NODE_ENV || "production",
    PORT: process.env.PORT || "3000",
    MEMORY_PROVIDER: process.env.MEMORY_PROVIDER || "qdrant",
    QDRANT_URL: process.env.QDRANT_URL || "http://127.0.0.1:6333",
    QDRANT_API_KEY: process.env.QDRANT_API_KEY || "",
    QDRANT_COLLECTION: process.env.QDRANT_COLLECTION || "memory_entries",
    QDRANT_VECTOR_SIZE: process.env.QDRANT_VECTOR_SIZE || "768",
    GEMINI_API_KEY: process.env.GEMINI_API_KEY || "",
  },
});

if (enableCloudflared) {
  const cloudflaredBin =
    process.env.CLOUDFLARED_BIN || "C:/Program Files (x86)/cloudflared/cloudflared.exe";
  const cloudflaredToken = process.env.CLOUDFLARED_TUNNEL_TOKEN || "";
  const cloudflaredConfig =
    process.env.CLOUDFLARED_CONFIG || path.join(__dirname, "cloudflared", "config.yml");
  const tunnelName = process.env.CLOUDFLARED_TUNNEL_NAME || "";

  let args = "";
  if (cloudflaredToken) {
    args = `tunnel --no-autoupdate run --token ${cloudflaredToken}`;
  } else {
    args = `tunnel --config "${cloudflaredConfig}" run${tunnelName ? ` ${tunnelName}` : ""}`;
  }

  apps.push({
    name: "cloudflared",
    cwd: __dirname,
    script: cloudflaredBin,
    args,
    interpreter: "none",
  });
}

module.exports = { apps };
