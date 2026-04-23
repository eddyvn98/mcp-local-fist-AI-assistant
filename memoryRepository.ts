import fs from "fs/promises";
import path from "path";
import { randomUUID } from "crypto";
import { QdrantClient } from "@qdrant/js-client-rest";
import { MemoryEntry, KnowledgeType, PatternTemplate } from "./src/types.js";

export interface MemoryStats {
  totalItems: number;
  types: Record<string, number>;
}

export interface MemorySearchResult extends MemoryEntry {
  similarity: number;
}

export interface MemoryRepository {
  provider: "local" | "qdrant";
  initialize(): Promise<void>;
  listMemories(): Promise<MemoryEntry[]>;
  addMemory(entry: MemoryEntry): Promise<MemoryEntry>;
  searchByEmbedding(embedding: number[], limit: number): Promise<MemorySearchResult[]>;
  getStats(): Promise<MemoryStats>;
}

function normalizeType(type: string): KnowledgeType {
  if (type === "pattern" || type === "bug_fix" || type === "decision") {
    return type;
  }
  return "pattern";
}

function normalizeMemoryEntry(raw: any): MemoryEntry {
  let id = String(raw?.id ?? "");
  // Qdrant requires UUID or unsigned integer. If not a number, we should ideally use a UUID.
  // For simplicity and compatibility with existing local_memory.json which might have non-UUID strings,
  // we will try to keep it but for NEW entries we should use something better.
  // However, the error says 'values are either an unsigned integer or a UUID'.
  // So we MUST ensure it looks like a UUID if it's not an entry from the file that is already a number.
  if (!id || (!/^\d+$/.test(id) && !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(id))) {
    id = randomUUID();
  }

  const patternData = raw?.patternData as PatternTemplate | undefined;

  return {
    id,
    type: normalizeType(String(raw?.type ?? "pattern")),
    content: String(raw?.content ?? ""),
    tags: Array.isArray(raw?.tags) ? raw.tags.map((t: any) => String(t)) : [],
    project: String(raw?.project ?? "General"),
    usage_count: Number(raw?.usage_count ?? 0),
    success_rate: Number(raw?.success_rate ?? 1),
    embedding: Array.isArray(raw?.embedding) ? raw.embedding : undefined,
    patternData: patternData
      ? {
        name: String(patternData.name ?? ""),
        summary: String(patternData.summary ?? ""),
        intent: String(patternData.intent ?? ""),
        stack: Array.isArray(patternData.stack) ? patternData.stack.map((v) => String(v)) : [],
        triggers: Array.isArray(patternData.triggers) ? patternData.triggers.map((v) => String(v)) : [],
        antiPatterns: Array.isArray(patternData.antiPatterns) ? patternData.antiPatterns.map((v) => String(v)) : [],
        requiredFiles: Array.isArray(patternData.requiredFiles) ? patternData.requiredFiles.map((v) => String(v)) : [],
        steps: Array.isArray(patternData.steps) ? patternData.steps.map((v) => String(v)) : [],
        verification: {
          commands: Array.isArray(patternData.verification?.commands)
            ? patternData.verification.commands.map((v) => String(v))
            : [],
          smokeChecks: Array.isArray(patternData.verification?.smokeChecks)
            ? patternData.verification.smokeChecks.map((v) => String(v))
            : [],
        },
      }
      : undefined,
  };
}

function dotProduct(a: number[], b: number[]) {
  return a.reduce((sum, val, i) => sum + val * (b[i] ?? 0), 0);
}

function magnitude(a: number[]) {
  return Math.sqrt(a.reduce((sum, val) => sum + val * val, 0));
}

function cosineSimilarity(a: number[], b: number[]) {
  const dp = dotProduct(a, b);
  const magA = magnitude(a);
  const magB = magnitude(b);
  if (magA === 0 || magB === 0) return 0;
  return dp / (magA * magB);
}

export class LocalJsonMemoryRepository implements MemoryRepository {
  public readonly provider = "local" as const;
  private readonly filePath: string;
  private memoryStore: MemoryEntry[] = [];

  constructor(baseDir: string) {
    this.filePath = path.join(baseDir, "local_memory.json");
  }

  async initialize() {
    try {
      const data = await fs.readFile(this.filePath, "utf-8");
      const parsed = JSON.parse(data);
      this.memoryStore = Array.isArray(parsed) ? parsed.map(normalizeMemoryEntry) : [];
      console.log(`Loaded ${this.memoryStore.length} memories from local JSON store.`);
    } catch {
      console.log("No existing local memory file found or invalid format. Starting fresh.");
      this.memoryStore = [];
    }
  }

  private async persist() {
    await fs.writeFile(this.filePath, JSON.stringify(this.memoryStore, null, 2), "utf-8");
  }

  async listMemories() {
    return this.memoryStore;
  }

  async addMemory(entry: MemoryEntry) {
    const normalized = normalizeMemoryEntry(entry);
    this.memoryStore.push(normalized);
    await this.persist();
    return normalized;
  }

  async searchByEmbedding(embedding: number[], limit: number) {
    if (!Array.isArray(embedding) || embedding.length === 0) return [];
    return this.memoryStore
      .map((entry) => ({
        ...entry,
        similarity: entry.embedding ? cosineSimilarity(embedding, entry.embedding) : 0,
      }))
      .sort((a, b) => b.similarity - a.similarity)
      .slice(0, limit);
  }

  async getStats() {
    const stats: MemoryStats = {
      totalItems: this.memoryStore.length,
      types: this.memoryStore.reduce((acc, curr) => {
        acc[curr.type] = (acc[curr.type] || 0) + 1;
        return acc;
      }, {} as Record<string, number>),
    };
    return stats;
  }
}

export class QdrantMemoryRepository implements MemoryRepository {
  public readonly provider = "qdrant" as const;
  private readonly client: QdrantClient;
  private readonly collectionName: string;
  private readonly vectorSize: number;

  constructor() {
    const url = process.env.QDRANT_URL;
    if (!url) {
      throw new Error("QDRANT_URL is required when MEMORY_PROVIDER=qdrant");
    }

    this.collectionName = process.env.QDRANT_COLLECTION || "memory_entries";
    this.vectorSize = Number(process.env.QDRANT_VECTOR_SIZE || 768);
    this.client = new QdrantClient({
      url,
      apiKey: process.env.QDRANT_API_KEY || undefined,
    });
  }

  async initialize() {
    try {
      await this.client.getCollection(this.collectionName);
    } catch {
      await this.client.createCollection(this.collectionName, {
        vectors: {
          size: this.vectorSize,
          distance: "Cosine",
        },
      });
    }
    console.log(`Qdrant memory repository ready (collection: ${this.collectionName}).`);
  }

  private async scrollAll() {
    const points: any[] = [];
    let offset: any = undefined;

    while (true) {
      const response: any = await this.client.scroll(this.collectionName, {
        with_payload: true,
        with_vector: false,
        limit: 256,
        offset,
      });

      const chunk = response?.points || [];
      points.push(...chunk);
      offset = response?.next_page_offset;
      if (!offset) break;
    }

    return points;
  }

  private toMemoryEntry(point: any): MemoryEntry {
    const payload = point?.payload || {};
    return normalizeMemoryEntry({
      id: point?.id,
      type: payload?.type,
      content: payload?.content,
      tags: payload?.tags,
      project: payload?.project,
      usage_count: payload?.usage_count,
      success_rate: payload?.success_rate,
      patternData: payload?.patternData,
    });
  }

  async listMemories() {
    const points = await this.scrollAll();
    return points.map((p) => this.toMemoryEntry(p));
  }

  async addMemory(entry: MemoryEntry) {
    const normalized = normalizeMemoryEntry(entry);
    let vector =
      Array.isArray(normalized.embedding) && normalized.embedding.length > 0
        ? normalized.embedding
        : new Array(this.vectorSize).fill(0);

    // Ensure vector matches expected size
    if (vector.length < this.vectorSize) {
      vector = [...vector, ...new Array(this.vectorSize - vector.length).fill(0)];
    } else if (vector.length > this.vectorSize) {
      vector = vector.slice(0, this.vectorSize);
    }

    await this.client.upsert(this.collectionName, {
      wait: true,
      points: [
        {
          id: normalized.id,
          vector,
          payload: {
            type: normalized.type,
            content: normalized.content,
            tags: normalized.tags,
            project: normalized.project,
            usage_count: normalized.usage_count,
            success_rate: normalized.success_rate,
            patternData: normalized.patternData,
          },
        },
      ],
    });

    return normalized;
  }

  async searchByEmbedding(embedding: number[], limit: number) {
    if (!Array.isArray(embedding) || embedding.length === 0) return [];

    const response: any[] = await this.client.search(this.collectionName, {
      vector: embedding,
      limit,
      with_payload: true,
      with_vector: false,
    });

    return response.map((item: any) => ({
      ...this.toMemoryEntry(item),
      similarity: Number(item?.score || 0),
    }));
  }

  async getStats() {
    const points = await this.scrollAll();
    const stats: MemoryStats = {
      totalItems: points.length,
      types: {},
    };
    for (const point of points) {
      const type = normalizeType(String(point?.payload?.type ?? "pattern"));
      stats.types[type] = (stats.types[type] || 0) + 1;
    }
    return stats;
  }
}

export function createMemoryRepository(baseDir: string): MemoryRepository {
  const provider = (process.env.MEMORY_PROVIDER || "local").toLowerCase();
  if (provider === "qdrant") {
    return new QdrantMemoryRepository();
  }
  return new LocalJsonMemoryRepository(baseDir);
}
