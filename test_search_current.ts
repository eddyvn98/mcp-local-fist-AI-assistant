import { createMemoryRepository } from "./memoryRepository.js";
import path from "path";

async function test() {
    const repo = createMemoryRepository(process.cwd());
    await repo.initialize();

    const queries = ["mcp", "assistant", "local-first"];
    const memories = await repo.listMemories();

    const results = memories.filter(m =>
        queries.some(q =>
            m.content.toLowerCase().includes(q.toLowerCase()) ||
            m.tags.some(t => t.toLowerCase().includes(q.toLowerCase())) ||
            m.project.toLowerCase().includes(q.toLowerCase())
        )
    );

    console.log("Memory Search Results for Current Project Keywords:");
    console.log(JSON.stringify(results, null, 2));
}

test().catch(console.error);
