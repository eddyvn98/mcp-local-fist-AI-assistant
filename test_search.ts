import { createMemoryRepository } from "./memoryRepository.js";
import path from "path";

async function test() {
    const repo = createMemoryRepository(process.cwd());
    await repo.initialize();

    const query = "TradingBot";
    const memories = await repo.listMemories();

    // Keyword search simulation (like in mcp-server.ts)
    const results = memories.filter(m =>
        m.content.toLowerCase().includes(query.toLowerCase()) ||
        m.tags.some(t => t.toLowerCase().includes(query.toLowerCase()))
    );

    console.log("Memory Search Results for 'TradingBot':");
    console.log(JSON.stringify(results, null, 2));
}

test().catch(console.error);
