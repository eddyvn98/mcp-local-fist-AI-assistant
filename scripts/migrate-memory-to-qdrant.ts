import { LocalJsonMemoryRepository, QdrantMemoryRepository } from "../memoryRepository.js";
import dotenv from "dotenv";

dotenv.config();

async function run() {
  const baseDir = process.cwd();
  const localRepo = new LocalJsonMemoryRepository(baseDir);
  const qdrantRepo = new QdrantMemoryRepository();

  await localRepo.initialize();
  await qdrantRepo.initialize();

  const memories = await localRepo.listMemories();
  let migrated = 0;
  let skipped = 0;

  for (const memory of memories) {
    if (!memory.content?.trim()) {
      skipped += 1;
      continue;
    }
    try {
      await qdrantRepo.addMemory(memory);
      migrated += 1;
      if (migrated % 50 === 0) console.log(`Migrated ${migrated} memories...`);
    } catch (err: any) {
      console.error(`Failed to migrate memory ${memory.id}:`, err?.data?.status?.error || err.message);
      process.exit(1);
    }
  }

  console.log(`Migration completed. migrated=${migrated}, skipped=${skipped}`);
}

run().catch((error) => {
  console.error("Migration failed:", error);
  process.exit(1);
});

