import { createMemoryRepository } from "../memoryRepository.js";
import fs from "fs/promises";
import path from "path";
import dotenv from "dotenv";

dotenv.config();

async function main() {
    const memoryRepository = createMemoryRepository(process.cwd());
    await memoryRepository.initialize();

    const reportPath = "C:\\Users\\hatha\\.gemini\\antigravity\\brain\\85b7d5ad-e7c6-4b54-b75d-7cb2769ab183\\knowledge_report.md";

    try {
        const content = await fs.readFile(reportPath, "utf-8");
        const stored = await memoryRepository.addMemory({
            id: "knowledge_report_summary_" + Date.now(),
            type: "pattern",
            content: `Technical Knowledge Report Summary:\n\n${content}`,
            tags: ["architecture", "summary", "cinema", "telegram", "payment", "sepay"],
            project: "Cinema-Ecosystem",
        });
        console.log("Successfully saved knowledge report to Qdrant:", stored.id);
    } catch (e) {
        console.error("Error saving report:", e);
    }
}

main().catch(console.error);
