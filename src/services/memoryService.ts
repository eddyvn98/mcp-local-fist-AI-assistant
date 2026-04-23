import { MemoryEntry } from "../types";

function normalizeMemoryEntry(raw: any): MemoryEntry {
  const validType = raw?.type === "pattern" || raw?.type === "bug_fix" || raw?.type === "decision";
  const rawTags = Array.isArray(raw?.tags) ? raw.tags : [];
  return {
    id: String(raw?.id ?? Math.random().toString(36).slice(2)),
    type: validType ? raw.type : "pattern",
    content: String(raw?.content ?? ""),
    tags: rawTags.map((t: any) => String(t)).filter(Boolean),
    project: String(raw?.project ?? "General"),
    usage_count: Number(raw?.usage_count ?? 0),
    success_rate: Number(raw?.success_rate ?? 1),
    embedding: Array.isArray(raw?.embedding) ? raw.embedding : undefined,
  };
}

export const memoryService = {
  async addMemory(entry: Omit<MemoryEntry, "id" | "usage_count" | "success_rate" | "embedding">) {
    const res = await fetch("/api/memory", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(entry)
    });
    return res.json();
  },

  async searchMemory(query: string, limit: number = 5) {
    const res = await fetch(`/api/memory/search?query=${encodeURIComponent(query)}&limit=${limit}`);
    return res.json();
  },

  async getStats() {
    const res = await fetch("/api/memory/stats");
    return res.json();
  },

  async getMemories(): Promise<MemoryEntry[]> {
    const res = await fetch("/api/memory");
    const data = await res.json();
    if (!Array.isArray(data)) return [];
    return data.map(normalizeMemoryEntry);
  }
};
