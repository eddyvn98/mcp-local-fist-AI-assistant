import { createMemoryRepository } from "../memoryRepository.js";
import fs from "fs/promises";
import path from "path";
import dotenv from "dotenv";

dotenv.config();

const IGNORE_DIRS = new Set(["node_modules", ".git", "dist", "build", ".next", "out", "public", "assets", ".vscode"]);
const ALLOWED_EXTS = new Set([".js", ".jsx", ".ts", ".tsx", ".md", ".json", ".py"]);
const MAX_FILE_SIZE = 50_000;

async function fileExists(absPath: string): Promise<boolean> {
    try {
        await fs.access(absPath);
        return true;
    } catch {
        return false;
    }
}

async function ingestDirectory(repo: any, targetDir: string, project?: string) {
    const absolute = path.resolve(targetDir);
    if (!(await fileExists(absolute))) {
        console.error(`Directory not found: ${absolute}`);
        return { scannedDirectory: absolute, totalFiles: 0, saved: 0 };
    }

    let totalFiles = 0;
    let saved = 0;

    async function walk(dir: string) {
        let entries;
        try {
            entries = await fs.readdir(dir, { withFileTypes: true });
        } catch (e) {
            console.error(`Error reading dir ${dir}:`, e);
            return;
        }

        for (const entry of entries) {
            const fullPath = path.join(dir, entry.name);
            if (entry.isDirectory()) {
                if (!IGNORE_DIRS.has(entry.name) && !entry.name.startsWith(".")) {
                    await walk(fullPath);
                }
                continue;
            }

            const ext = path.extname(entry.name).toLowerCase();
            if (!ALLOWED_EXTS.has(ext)) {
                continue;
            }

            const stats = await fs.stat(fullPath);
            if (stats.size > MAX_FILE_SIZE) {
                continue;
            }

            totalFiles += 1;
            try {
                const content = await fs.readFile(fullPath, "utf-8");
                await repo.addMemory({
                    id: Math.random().toString(36).substring(7),
                    type: "pattern",
                    content: `File: ${fullPath}\n\n${content}`,
                    tags: [ext.replace(".", ""), "local_ingest"],
                    project: project || path.basename(absolute),
                });
                saved += 1;
                if (saved % 10 === 0) console.log(`Saved ${saved} files...`);
            } catch (e) {
                console.error(`Error saving file ${fullPath}:`, e);
            }
        }
    }

    await walk(absolute);
    return { scannedDirectory: absolute, totalFiles, saved };
}

async function main() {
    const memoryRepository = createMemoryRepository(process.cwd());
    await memoryRepository.initialize();

    const folders = [
        { dir: "D:\\discordvip-cinema-web", project: "Cinema-Web" },
        { dir: "D:\\discordvip-cinema", project: "Cinema-Core" },
        { dir: "D:\\telefilm", project: "Telefilm" },
        { dir: "D:\\discordvip", project: "DiscordVIP" }
    ];

    for (const folder of folders) {
        console.log(`Starting ingestion for ${folder.dir}...`);
        const result = await ingestDirectory(memoryRepository, folder.dir, folder.project);
        console.log(`Finished ${folder.dir}:`, result);
    }
}

main().catch(console.error);
