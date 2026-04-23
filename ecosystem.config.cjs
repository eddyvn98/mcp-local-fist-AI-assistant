module.exports = {
  apps: [
    {
      name: "mcp-assistant",
      cwd: "D:/mcp-local-first-ai-assistant",
      script: "D:/nodejs/node.exe",
      args: "--import tsx server.ts",
      env: {
        NODE_ENV: "production",
        MEMORY_PROVIDER: "qdrant",
        QDRANT_URL: "http://127.0.0.1:6333",
      },
    },
  ],
};
