import fs from "fs/promises";
import path from "path";

type IngestTarget = {
  dir: string;
  project?: string;
  tags?: string[];
  maxFileSizeBytes?: number;
};

type IngestConfig = {
  apiUrl?: string;
  ignoreDirs?: string[];
  allowedExtensions?: string[];
  defaultMaxFileSizeBytes?: number;
  targets: IngestTarget[];
};

const DEFAULT_API_URL = "http://localhost:3000/api/memory";
const DEFAULT_IGNORE_DIRS = [
  "node_modules",
  ".git",
  "dist",
  "build",
  ".next",
  "out",
  "public",
  "assets",
  ".vscode",
];
const DEFAULT_ALLOWED_EXTENSIONS = [".js", ".jsx", ".ts", ".tsx", ".md", ".json"];
const DEFAULT_MAX_FILE_SIZE_BYTES = 50_000;

function parseConfigArg() {
  const idx = process.argv.indexOf("--config");
  if (idx === -1) {
    return path.resolve(process.cwd(), "scripts", "ingest-targets.json");
  }
  const value = process.argv[idx + 1];
  if (!value) {
    throw new Error("Missing value after --config");
  }
  return path.resolve(process.cwd(), value);
}

async function readConfig(configPath: string): Promise<IngestConfig> {
  const raw = await fs.readFile(configPath, "utf-8");
  const parsed = JSON.parse(raw);
  if (!Array.isArray(parsed?.targets) || parsed.targets.length === 0) {
    throw new Error("Config must contain non-empty 'targets' array");
  }
  return parsed as IngestConfig;
}

async function postMemory(apiUrl: string, payload: any) {
  const response = await fetch(apiUrl, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  });
  if (!response.ok) {
    throw new Error(`API ${response.status} ${response.statusText}`);
  }
}

async function ingestTarget(config: IngestConfig, target: IngestTarget) {
  const ignoreDirs = new Set(config.ignoreDirs ?? DEFAULT_IGNORE_DIRS);
  const allowedExts = new Set(
    (config.allowedExtensions ?? DEFAULT_ALLOWED_EXTENSIONS).map((ext) => ext.toLowerCase())
  );
  const maxFileSizeBytes = target.maxFileSizeBytes ?? config.defaultMaxFileSizeBytes ?? DEFAULT_MAX_FILE_SIZE_BYTES;
  const apiUrl = config.apiUrl ?? DEFAULT_API_URL;
  const targetDir = path.resolve(target.dir);
  const projectName = target.project || path.basename(targetDir);
  const baseTags = target.tags ?? [];

  let scanned = 0;
  let ingested = 0;
  let skipped = 0;
  let failed = 0;

  async function walk(dir: string): Promise<void> {
    const entries = await fs.readdir(dir, { withFileTypes: true });
    for (const entry of entries) {
      const fullPath = path.join(dir, entry.name);
      if (entry.isDirectory()) {
        if (!ignoreDirs.has(entry.name) && !entry.name.startsWith(".")) {
          await walk(fullPath);
        }
        continue;
      }

      if (!entry.isFile()) {
        continue;
      }

      scanned += 1;
      const ext = path.extname(entry.name).toLowerCase();
      if (!allowedExts.has(ext)) {
        skipped += 1;
        continue;
      }

      const stat = await fs.stat(fullPath);
      if (stat.size > maxFileSizeBytes) {
        skipped += 1;
        continue;
      }

      try {
        const content = await fs.readFile(fullPath, "utf-8");
        await postMemory(apiUrl, {
          type: "pattern",
          content: `File: ${fullPath}\n\n${content}`,
          tags: [ext.replace(".", ""), "batch_ingest", ...baseTags],
          project: projectName,
        });
        ingested += 1;
      } catch (error: any) {
        failed += 1;
        console.error(`[ingest-error] ${fullPath} :: ${error.message}`);
      }
    }
  }

  console.log(`[target] start: ${targetDir}`);
  await walk(targetDir);
  console.log(
    `[target] done: ${targetDir} | scanned=${scanned} ingested=${ingested} skipped=${skipped} failed=${failed}`
  );
}

async function main() {
  try {
    const configPath = parseConfigArg();
    const config = await readConfig(configPath);
    console.log(`[batch] config: ${configPath}`);
    for (const target of config.targets) {
      await ingestTarget(config, target);
    }
    console.log("[batch] completed");
  } catch (error: any) {
    console.error(`[batch] failed: ${error.message}`);
    process.exit(1);
  }
}

main();
