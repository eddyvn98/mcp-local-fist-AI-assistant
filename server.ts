import express from "express";
import { createServer as createViteServer } from "vite";
import path from "path";
import { fileURLToPath } from "url";
import { GoogleGenAI } from "@google/genai";
import dotenv from "dotenv";
import fs from "fs/promises";
import { randomUUID } from "crypto";
import { exec, execFile } from "child_process";
import { promisify } from "util";
import cron from "node-cron";
import {
  MemoryEntry,
  PatternFitReport,
  PatternTemplate,
  RoutingDecision,
  VerificationCommandResult,
} from "./src/types.js";
import { createMemoryRepository } from "./memoryRepository.js";

const execFileAsync = promisify(execFile);
const execAsync = promisify(exec);
dotenv.config();

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

let aiClient: GoogleGenAI | null = null;
const memoryRepository = createMemoryRepository(process.cwd());

function getAiClient(): GoogleGenAI {
  if (!aiClient) {
    const key = process.env.GEMINI_API_KEY;
    console.log("GEMINI_API_KEY present: ", !!key, " length: ", key?.length, " prefix: ", key?.substring(0, 4));
    if (!key) {
      throw new Error("GEMINI_API_KEY environment variable is missing.");
    }
    aiClient = new GoogleGenAI({ apiKey: key });
  }
  return aiClient;
}

async function getEmbedding(text: string) {
  try {
    const ai = getAiClient();
    const response = await ai.models.embedContent({
      model: "gemini-embedding-2-preview",
      contents: [{ parts: [{ text }] }],
    });
    return response.embeddings?.[0]?.values || new Array(768).fill(0);
  } catch (error: any) {
    console.error("Embedding failed:", error);
    if (error.message?.includes("API key not valid")) {
      throw new Error("Invalid API key configured. Please update it in AI Studio Settings.");
    }
    return new Array(768).fill(0);
  }
}

export interface SearchResult {
  file: string;
  line: string;
  content: string;
}

async function codeSearch(query: string): Promise<SearchResult[]> {
  try {
    const { stdout } = await execFileAsync("rg", [
      "-n",
      "--no-heading",
      "--glob",
      "!node_modules/**",
      "--glob",
      "!dist/**",
      "--glob",
      "!.git/**",
      query,
      ".",
    ]);
    return stdout.split('\n').filter(Boolean).map(line => {
      const [file, lineNo, ...contentParts] = line.split(':');
      return { file, line: lineNo, content: contentParts.join(':').trim() };
    });
  } catch (error: any) {
    if (error.code === 1) return []; // rg returns exit code 1 if no match
    console.error("Code search error:", error);
    return [];
  }
}

function parsePatternTemplate(input: any): PatternTemplate {
  return {
    name: String(input?.name ?? "").trim(),
    summary: String(input?.summary ?? "").trim(),
    intent: String(input?.intent ?? "").trim(),
    stack: Array.isArray(input?.stack) ? input.stack.map((v: any) => String(v)) : [],
    triggers: Array.isArray(input?.triggers) ? input.triggers.map((v: any) => String(v)) : [],
    antiPatterns: Array.isArray(input?.antiPatterns) ? input.antiPatterns.map((v: any) => String(v)) : [],
    requiredFiles: Array.isArray(input?.requiredFiles) ? input.requiredFiles.map((v: any) => String(v)) : [],
    steps: Array.isArray(input?.steps) ? input.steps.map((v: any) => String(v)) : [],
    verification: {
      commands: Array.isArray(input?.verification?.commands)
        ? input.verification.commands.map((v: any) => String(v))
        : [],
      smokeChecks: Array.isArray(input?.verification?.smokeChecks)
        ? input.verification.smokeChecks.map((v: any) => String(v))
        : [],
    },
  };
}

async function fileExists(absPath: string): Promise<boolean> {
  try {
    await fs.access(absPath);
    return true;
  } catch {
    return false;
  }
}

async function detectProjectSignals() {
  const pkgPath = path.join(process.cwd(), "package.json");
  const result = {
    dependencies: [] as string[],
    scripts: [] as string[],
    hasTsConfig: false,
  };
  try {
    const raw = await fs.readFile(pkgPath, "utf-8");
    const parsed = JSON.parse(raw);
    const deps = { ...(parsed.dependencies || {}), ...(parsed.devDependencies || {}) };
    result.dependencies = Object.keys(deps);
    result.scripts = Object.keys(parsed.scripts || {});
  } catch {
    // ignore: optional signal
  }
  result.hasTsConfig = await fileExists(path.join(process.cwd(), "tsconfig.json"));
  return result;
}

async function calculatePatternFit(
  pattern: PatternTemplate,
  task: string,
  projectContext: string
): Promise<PatternFitReport> {
  const normalizedTask = `${task} ${projectContext}`.toLowerCase();
  const signals = await detectProjectSignals();

  let score = 0;
  const reasons: string[] = [];
  const warnings: string[] = [];

  const triggerHits = pattern.triggers.filter((t) => normalizedTask.includes(t.toLowerCase()));
  if (triggerHits.length > 0) {
    const triggerScore = Math.min(35, triggerHits.length * 8);
    score += triggerScore;
    reasons.push(`Task matches triggers: ${triggerHits.join(", ")}`);
  }

  const stackHits = pattern.stack.filter((s) =>
    signals.dependencies.some((dep) => dep.toLowerCase().includes(s.toLowerCase()))
  );
  if (stackHits.length > 0) {
    const stackScore = Math.min(25, stackHits.length * 6);
    score += stackScore;
    reasons.push(`Project stack matches: ${stackHits.join(", ")}`);
  }

  if (signals.hasTsConfig && pattern.stack.some((s) => s.toLowerCase().includes("typescript"))) {
    score += 5;
  }

  let requiredMatched = 0;
  for (const requiredPath of pattern.requiredFiles) {
    const absolute = path.resolve(process.cwd(), requiredPath);
    if (await fileExists(absolute)) {
      requiredMatched += 1;
    }
  }
  if (pattern.requiredFiles.length > 0) {
    const requiredRatio = requiredMatched / pattern.requiredFiles.length;
    score += Math.round(requiredRatio * 25);
    if (requiredMatched > 0) {
      reasons.push(`Required files present: ${requiredMatched}/${pattern.requiredFiles.length}`);
    } else {
      warnings.push("No required files found for this pattern in current repo.");
    }
  }

  const antiHits = pattern.antiPatterns.filter((a) => normalizedTask.includes(a.toLowerCase()));
  if (antiHits.length > 0) {
    const penalty = Math.min(25, antiHits.length * 8);
    score -= penalty;
    warnings.push(`Anti-pattern conditions detected: ${antiHits.join(", ")}`);
  }

  score = Math.max(0, Math.min(100, score));
  return { score, reasons, warnings };
}

async function runVerification(commands: string[]): Promise<VerificationCommandResult[]> {
  const results: VerificationCommandResult[] = [];
  for (const command of commands) {
    try {
      const { stdout, stderr } = await execAsync(command, {
        cwd: process.cwd(),
        windowsHide: true,
        maxBuffer: 1024 * 1024,
      });
      results.push({
        command,
        ok: true,
        stdout: stdout?.toString().slice(0, 5000) || "",
        stderr: stderr?.toString().slice(0, 5000) || "",
      });
    } catch (error: any) {
      results.push({
        command,
        ok: false,
        stdout: error?.stdout?.toString().slice(0, 5000) || "",
        stderr: error?.stderr?.toString().slice(0, 5000) || error?.message || "Unknown command error",
      });
    }
  }
  return results;
}

// Autonomous Researcher Service
async function sendNotification(message: string) {
  const webhookUrl = process.env.NOTIFICATION_WEBHOOK_URL;
  if (!webhookUrl) {
    console.log("No NOTIFICATION_WEBHOOK_URL configured. Skipping notification. Insight generated:\n", message);
    return;
  }
  
  try {
    // Basic Discord/Slack compatible webhook payload
    await fetch(webhookUrl, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ 
        content: `**🤖 Báo cáo Nghiên Cứu Tự Động Hằng Ngày**\n\n${message}` 
      })
    });
    console.log("Đã gửi thông báo thành công!");
  } catch (error) {
    console.error("Lỗi khi gửi thông báo:", error);
  }
}

async function runDailyAutonomousResearch() {
  console.log("Khởi động phiên nghiên cứu tự động...");
  try {
    const ai = getAiClient();
    const existingMemories = await memoryRepository.listMemories();
    
    // 1. Đọc Baseline Bối Cảnh (Package.json & Memory Tags)
    const pkgData = await fs.readFile(path.join(process.cwd(), "package.json"), "utf-8").catch(() => "{}");
    const allTags = existingMemories.flatMap(m => m.tags || []);
    // Lấu 20 tag xuất hiện nhiều nhất từ các thư viện cũ của người dùng
    const tagCounts = allTags.reduce((acc, tag) => { acc[tag] = (acc[tag] || 0) + 1; return acc; }, {} as Record<string, number>);
    const uniqueTags = Object.entries(tagCounts).sort((a, b) => b[1] - a[1]).slice(0, 20).map(t => t[0]);

    console.log("Đang phân tích repo và lịch sử để tạo Chủ Đề Định Hướng...");

    // 2. Nhờ AI sinh ra chủ đề DỰA TRÊN repo thực tế
    const topicGenPrompt = `
      You are an AI Tech Lead. Read the following context about the user's actual local projects and legacy codebases.
      
      Current Project dependencies (package.json excerpt):
      ${pkgData.slice(0, 1000)}
      
      Legacy Projects & Core Knowledge Tags extracted from local Memory:
      ${uniqueTags.join(", ")}

      Generate exactly 3 highly specific, narrow technical research topics to investigate today.
      They MUST be directly tied to upgrading the user's EXISTING tools shown above, finding better/cheaper alternatives for their stack, or solving known issues in these specific domains.
      Do not invent generic topics. Base it deeply on what you see in the tags and dependencies.
      Output ONLY a valid JSON array of 3 strings. 
      Example format: ["Tailwind v4 optimization techniques", "Replace node-cron with modern alternative in NodeJS", "New React 19 hooks for data fetching in dashboards"]
    `;

    const topicResp = await ai.models.generateContent({
      model: "gemini-2.5-flash",
      contents: topicGenPrompt
    });

    let topics: string[] = [];
    try {
      const rawText = topicResp.text?.replace(/```json/g, "").replace(/```/g, "").trim() || "[]";
      topics = JSON.parse(rawText);
      if (!Array.isArray(topics) || topics.length === 0) throw new Error("Invalid format");
    } catch (e) {
      console.error("Lỗi sinh chủ đề tự động, dùng fallback dựa trên Tags...", e);
      topics = [
        `Latest updates and security patches for ${uniqueTags.slice(0, 3).join(", ")}`,
        `Better performance alternatives to ${uniqueTags.slice(3, 5).join(", ")} in Node.js/React`,
        `Modern architectural patterns for combining ${uniqueTags.slice(0, 4).join(" and ")}`
      ];
    }

    let fullReport = "";

    // Lặp qua nhiều lượt để khỏi bị nghẽn (Context quá tải)
    for (const [index, topic] of topics.entries()) {
      console.log(`Tiến hành nghiên cứu chủ đề ${index + 1}: ${topic}`);
      const prompt = `
        You are a Senior Principal Engineer. Search the internet for the absolute latest updates and tools concerning: "${topic}".
        Evaluate these updates against our current tech stack context (React, Express, Tailwind, Local Vector Memory).
        Should we adopt any of these new updates? What are the pros and cons?

        Please output your answer focusing on Actionable Insights. Format it clearly.
        If there's a highly recommended new pattern or tool, identify it.

        CRITICAL: Also output an XML memory block like:
        <new_memory>
        {
          "type": "decision",
          "content": "Short actionable technical roadmap or tool to adapt based on new trend",
          "tags": ["trend", "architecture"],
          "project": "Tech Radar"
        }
        </new_memory>
      `;

      const searchResp = await ai.models.generateContent({
        model: "gemini-2.5-flash",
        contents: prompt,
        config: {
          tools: [{ googleSearch: {} }]
        }
      });

      let aiText = searchResp.text || "";

      // Logic bóc tách Memory giống /api/mcp/query
      const memoryMatch = aiText.match(/<new_memory>\s*({[\s\S]*?})\s*<\/new_memory>/);
      if (memoryMatch) {
         try {
           const newMemData = JSON.parse(memoryMatch[1]);
           const emb = await getEmbedding(newMemData.content);
           await memoryRepository.addMemory({
              id: Math.random().toString(36).substring(7),
              usage_count: 0,
              success_rate: 1.0,
              content: `[Auto-Research]: ${newMemData.content}`,
              type: "pattern",
              tags: [...(newMemData.tags || []), 'auto_research'],
              project: "Global Tech Radar",
              embedding: emb
           });
           aiText = aiText.replace(memoryMatch[0], "").trim();
         } catch(e) {
           console.error("Failed to parse auto-memory during research");
         }
      }

      fullReport += `### 💡 Chủ đề ${index + 1}: ${topic}\n${aiText}\n\n`;
      
      // Delay giữa các lượt tìm kiếm để tránh rate limit
      await new Promise(r => setTimeout(r, 5000));
    }

    // Gửi thông báo tổng hợp
    await sendNotification(fullReport);

  } catch (error) {
    console.error("Lỗi trong quá trình Auto Research:", error);
  }
}

async function startServer() {
  const app = express();
  const PORT = Number(process.env.PORT) || 3000;

  app.use(express.json());

  // Initialize memory provider on startup
  await memoryRepository.initialize();
  console.log(`Memory provider: ${memoryRepository.provider}`);

  app.get("/api/health", (req, res) => {
    res.json({ status: "ok" });
  });

  // --- MCP (Model Context Protocol) API Endpoints for AI Agents ---
  app.get("/api/mcp/tools", (req, res) => {
    res.json({
      tools: [
        {
          name: "mcp_query",
          description: "Route a coding task through the local memory vector store for enhanced context.",
          endpoint: "POST /api/mcp/query",
          schema: { task: "string", projectContext: "string?", currentCode: "string?" }
        },
        {
          name: "read_file",
          description: "Read contents of a file in the workspace.",
          endpoint: "GET /api/workspace/read-file?path=string"
        },
        {
          name: "list_files",
          description: "List files in a directory.",
          endpoint: "GET /api/workspace/list-files?dir=string"
        },
        {
          name: "pattern_register",
          description: "Register a reusable implementation pattern with fit rules and verification commands.",
          endpoint: "POST /api/pattern/register"
        },
        {
          name: "pattern_list",
          description: "List registered reusable patterns.",
          endpoint: "GET /api/pattern/list"
        },
        {
          name: "pattern_apply",
          description: "Analyze task -> score best pattern fit -> build apply plan -> optionally run verification gate.",
          endpoint: "POST /api/pattern/apply"
        }
      ]
    });
  });

  app.get("/api/workspace/read-file", async (req, res) => {
    try {
      const targetPath = req.query.path as string;
      if (!targetPath) return res.status(400).json({ error: "Missing path parameter" });
      const fullPath = path.resolve(process.cwd(), targetPath);
      // Access restriction removed to allow reading external projects locally
      const content = await fs.readFile(fullPath, "utf-8");
      res.json({ path: targetPath, content });
    } catch (e: any) {
      res.status(500).json({ error: e.message });
    }
  });

  app.get("/api/workspace/list-files", async (req, res) => {
    try {
      const targetDir = (req.query.dir as string) || ".";
      const fullPath = path.resolve(process.cwd(), targetDir);
      // Access restriction removed to allow listing external projects locally
      const files = await fs.readdir(fullPath, { withFileTypes: true });
      const result = files.map(f => ({ name: f.name, isDirectory: f.isDirectory() }));
      res.json({ path: targetDir, files: result });
    } catch (e: any) {
      res.status(500).json({ error: e.message });
    }
  });
  // -------------------------------------------------------------

  app.get("/api/debug", (req, res) => {
    const key = process.env.GEMINI_API_KEY;
    res.json({
      hasKey: !!key,
      length: key?.length,
      prefix: key?.substring(0, 4)
    });
  });

  // Code search endpoint
  app.post("/api/code/search", async (req, res) => {
    const { query } = req.body;
    if (!query) {
      return res.status(400).json({ error: "Query is required" });
    }
    const results = await codeSearch(query);
    res.json({ results });
  });

  // Memory endpoints
  app.get("/api/memory", (req, res) => {
    memoryRepository.listMemories()
      .then((items) => res.json(items))
      .catch((e: any) => res.status(500).json({ error: e.message }));
  });

  app.get("/api/memory/stats", (req, res) => {
    memoryRepository.getStats()
      .then((stats) => res.json(stats))
      .catch((e: any) => res.status(500).json({ error: e.message }));
  });

  app.get("/api/memory/search", async (req, res) => {
    const query = req.query.query as string;
    const limit = parseInt(req.query.limit as string) || 5;
    if (!query) return res.json([]);

    const queryEmbedding = await getEmbedding(query);
    const results = await memoryRepository.searchByEmbedding(queryEmbedding, limit);
    res.json(results);
  });

  app.post("/api/memory", async (req, res) => {
    const { content, type, tags, project } = req.body;
    const embedding = await getEmbedding(content);
    const item: MemoryEntry = {
      id: Math.random().toString(36).substring(7),
      usage_count: 0,
      success_rate: 1.0,
      content, type, tags, project, embedding
    };
    const stored = await memoryRepository.addMemory(item);
    res.json(stored);
  });

  app.get("/api/pattern/list", async (req, res) => {
    try {
      const items = await memoryRepository.listMemories();
      const patterns = items
        .filter((m) => m.type === "pattern" && m.patternData)
        .map((m) => ({
          id: m.id,
          project: m.project,
          tags: m.tags,
          usage_count: m.usage_count,
          success_rate: m.success_rate,
          pattern: m.patternData,
        }));
      res.json({ total: patterns.length, patterns });
    } catch (error: any) {
      res.status(500).json({ error: error.message });
    }
  });

  app.post("/api/pattern/register", async (req, res) => {
    try {
      const { pattern, project = "General", tags = [] } = req.body || {};
      const parsed = parsePatternTemplate(pattern);
      if (!parsed.name || !parsed.intent || !parsed.summary) {
        return res.status(400).json({
          error: "pattern.name, pattern.intent, and pattern.summary are required.",
        });
      }

      const content = `[Pattern] ${parsed.name}: ${parsed.summary}`;
      const embedding = await getEmbedding(`${parsed.name}\n${parsed.intent}\n${parsed.summary}`);
      const stored = await memoryRepository.addMemory({
        id: randomUUID(),
        usage_count: 0,
        success_rate: 1.0,
        content,
        type: "pattern",
        tags: Array.from(new Set([...(Array.isArray(tags) ? tags.map((t: any) => String(t)) : []), "pattern_registry"])),
        project: String(project),
        embedding,
        patternData: parsed,
      });
      res.json(stored);
    } catch (error: any) {
      res.status(500).json({ error: error.message });
    }
  });

  app.post("/api/pattern/apply", async (req, res) => {
    try {
      const {
        task,
        projectContext = "",
        currentCode = "",
        minFitScore = 60,
        dryRun = false,
        overrideVerificationCommands = [],
      } = req.body || {};

      if (!task || typeof task !== "string") {
        return res.status(400).json({ error: "task is required." });
      }

      const allMemories = await memoryRepository.listMemories();
      const candidates = allMemories.filter((m) => m.type === "pattern" && m.patternData);
      if (candidates.length === 0) {
        return res.status(404).json({ error: "No registered patterns found. Use /api/pattern/register first." });
      }

      const scoredCandidates = await Promise.all(
        candidates.map(async (entry) => ({
          entry,
          fit: await calculatePatternFit(entry.patternData!, task, projectContext),
        }))
      );

      scoredCandidates.sort((a, b) => b.fit.score - a.fit.score);
      const best = scoredCandidates[0];
      if (!best) {
        return res.status(404).json({ error: "No applicable pattern found." });
      }

      const applyPlan = {
        patternName: best.entry.patternData!.name,
        summary: best.entry.patternData!.summary,
        fitScore: best.fit.score,
        reasons: best.fit.reasons,
        warnings: best.fit.warnings,
        steps: best.entry.patternData!.steps,
        requiredFiles: best.entry.patternData!.requiredFiles,
        verification: best.entry.patternData!.verification,
      };

      if (best.fit.score < Number(minFitScore)) {
        return res.status(200).json({
          status: "rejected_low_fit",
          threshold: Number(minFitScore),
          applyPlan,
          alternatives: scoredCandidates.slice(1, 4).map((c) => ({
            patternName: c.entry.patternData?.name,
            score: c.fit.score,
          })),
        });
      }

      const ai = getAiClient();
      const generatedPlan = await ai.models.generateContent({
        model: "gemini-2.5-flash",
        contents: `
Task: ${task}
Project context: ${projectContext}
Current code:
\`\`\`
${currentCode}
\`\`\`

Selected pattern:
${JSON.stringify(best.entry.patternData, null, 2)}

Generate a concise patch plan with:
1) files_to_touch (array)
2) risky_points (array)
3) adaptation_notes (array)
4) done_criteria (array)
Return JSON only.
        `.trim(),
      });

      let parsedGeneratedPlan: any = null;
      try {
        parsedGeneratedPlan = JSON.parse(
          (generatedPlan.text || "{}").replace(/```json/g, "").replace(/```/g, "").trim()
        );
      } catch {
        parsedGeneratedPlan = { raw: generatedPlan.text || "" };
      }

      let verificationResults: VerificationCommandResult[] = [];
      const verificationCommands = Array.isArray(overrideVerificationCommands) && overrideVerificationCommands.length > 0
        ? overrideVerificationCommands.map((v: any) => String(v))
        : best.entry.patternData!.verification.commands;

      if (!dryRun && verificationCommands.length > 0) {
        verificationResults = await runVerification(verificationCommands);
      }

      const verificationPassed =
        verificationResults.length === 0 || verificationResults.every((r) => r.ok);

      if (!dryRun && verificationPassed) {
        const successEmbedding = await getEmbedding(
          `Applied pattern ${best.entry.patternData!.name} for task: ${task}`
        );
        await memoryRepository.addMemory({
          id: randomUUID(),
          usage_count: 0,
          success_rate: 1.0,
          type: "decision",
          content: `Pattern applied successfully: ${best.entry.patternData!.name}`,
          tags: ["pattern_apply_success", best.entry.patternData!.name],
          project: projectContext || "General",
          embedding: successEmbedding,
        });
      }

      res.json({
        status: dryRun ? "planned" : verificationPassed ? "ready" : "verification_failed",
        applyPlan,
        generatedPlan: parsedGeneratedPlan,
        verification: {
          executed: !dryRun,
          commands: verificationCommands,
          passed: verificationPassed,
          results: verificationResults,
        },
      });
    } catch (error: any) {
      res.status(500).json({ error: error.message, stack: error.stack });
    }
  });

  // MCP Query (The Brain)
  app.post("/api/mcp/query", async (req, res) => {
    try {
      const { task, projectContext, currentCode } = req.body;

      // 1. Code Search
      const keywords = task.split(' ').filter((word: string) => word.length > 3).slice(0, 3);
      let codeSearchResults: SearchResult[] = [];
      if (keywords.length > 0) {
        const searchTasks = keywords.map((kw: string) => codeSearch(kw));
        const searchResultsArray = await Promise.all(searchTasks);
        codeSearchResults = searchResultsArray.flat().slice(0, 10);
        codeSearchResults = codeSearchResults.filter((v, i, a) => a.findIndex(t => (t.file === v.file && t.line === v.line)) === i);
      }

      // 2. Retrieve memory
      const queryEmbedding = await getEmbedding(task);
      const scoredMemories = await memoryRepository.searchByEmbedding(queryEmbedding, 5);

      const maxSimilarity = scoredMemories.length > 0 ? scoredMemories[0].similarity : 0;
      
      let useMemory: "strong" | "reference" | "ignore" = "ignore";
      if (maxSimilarity > 0.8) useMemory = "strong";
      else if (maxSimilarity >= 0.6) useMemory = "reference";

      const decision: RoutingDecision = { useMemory, similarity: maxSimilarity };

      // 3. Build Prompt
      let memoryContext = "";
      if (decision.useMemory !== "ignore") {
        memoryContext = `\n--- RELEVANT KNOWLEDGE FROM PAST PROJECTS ---\n`;
        scoredMemories.forEach((m, i) => {
          memoryContext += `[Knowledge ${i + 1}] (${m.type}): ${m.content}\n`;
        });
      }

      let searchContext = "";
      if (codeSearchResults.length > 0) {
        searchContext = `\n--- RELEVANT CODE SNIPPETS FOUND IN CURRENT PROJECT ---\n`;
        codeSearchResults.forEach((r, i) => {
          searchContext += `[Snippet ${i + 1}] File: ${r.file}, Line: ${r.line}\nContent: ${r.content}\n\n`;
        });
      }

      // 2.5 External URL Fetching (Auto-Scrapper)
      const urlRegex = /(https?:\/\/[^\s]+)/g;
      const urls = task.match(urlRegex) || [];
      let webContext = "";
      if (urls.length > 0) {
        const fetchTasks = urls.map(async (url) => {
          try {
            const r = await fetch(url);
            const text = await r.text();
            // Basic HTML strip to save tokens (remove scripts, styles, tags), limit per URL
            const clean = text
              .replace(/<script\b[^<]*(?:(?!<\/script>)<[^<]*)*<\/script>/gi, ' ')
              .replace(/<style\b[^<]*(?:(?!<\/style>)<[^<]*)*<\/style>/gi, ' ')
              .replace(/<[^>]+>/g, ' ')
              .replace(/\s+/g, ' ')
              .slice(0, 10000); 
            return `[Content from ${url}]:\n${clean}`;
          } catch(e) {
            return `[Failed to fetch ${url} - Internet context skipped]`;
          }
        });
        const webResults = await Promise.all(fetchTasks);
        webContext = `\n--- EXTERNAL WEB CONTEXT (URLS PROVIDED BY USER) ---\n` + webResults.join("\n\n") + "\n";
      }

      const instruction = decision.useMemory === "strong" 
        ? "You MUST strictly follow the patterns and decisions found in the provided memory and project code."
        : decision.useMemory === "reference"
        ? "Use memory and project code if relevant, otherwise rely on your own knowledge."
        : "Rely on your internal model knowledge for this task, using project code as reference.";

      const prompt = `
Task: ${task}

${projectContext ? `Project Context: ${projectContext}` : ""}

${currentCode ? `Current Code:\n\`\`\`\n${currentCode}\n\`\`\`` : ""}

${searchContext}

${webContext}

${memoryContext}

Instruction: ${instruction}

CRITICAL: As an AI agent, you must self-reflect. If you establish a new pattern, make a key technical decision, or fix a notable bug, output a memory block at the end of your response using EXACTLY this XML format:
<new_memory>
{
  "type": "pattern",
  "content": "Short description of the knowledge to persist",
  "tags": ["tag1", "tag2"],
  "project": "${projectContext || 'General'}"
}
</new_memory>
Please provide the solution below.
      `.trim();

      // 4. AIS Call
      const ai = getAiClient();
      const genAiResponse = await ai.models.generateContent({
        model: "gemini-2.5-flash",
        contents: prompt,
        config: {
          // Enable Google Search to proactively investigate new market trends/tools (like Cloudflare AI)
          tools: [{ googleSearch: {} }] 
        }
      });

      let aiText = genAiResponse.text || "No response from AI.";
      
      // Auto-extract memory from AI response
      const memoryMatch = aiText.match(/<new_memory>\s*({[\s\S]*?})\s*<\/new_memory>/);
      if (memoryMatch) {
         try {
           const newMemData = JSON.parse(memoryMatch[1]);
           const emb = await getEmbedding(newMemData.content);
           await memoryRepository.addMemory({
              id: Math.random().toString(36).substring(7),
              usage_count: 0,
              success_rate: 1.0,
              content: newMemData.content,
              type: newMemData.type || "pattern",
              tags: newMemData.tags || [],
              project: newMemData.project || projectContext || "General",
              embedding: emb
           });
           // Clean the output
           aiText = aiText.replace(memoryMatch[0], "").trim();
         } catch(e) {
           console.error("Failed to parse auto-memory:", e);
         }
      }

      res.json({
        decision,
        relevantMemories: scoredMemories,
        codeSearchResults,
        aiResponse: aiText
      });
    } catch (e: any) {
      console.error("MCP Query Error:", e);
      if (e.message?.includes("API key not valid")) {
        return res.status(400).json({ 
          error: "API key is invalid. It looks like you're using a placeholder or an incorrect key. Please provide a valid Gemini API key in the AI Studio Settings > Secrets panel." 
        });
      }
      res.status(500).json({ error: e.message, stack: e.stack });
    }
  });

  if (process.env.NODE_ENV !== "production") {
    const vite = await createViteServer({
      server: { middlewareMode: true },
      appType: "spa",
    });
    app.use(vite.middlewares);
  } else {
    const distPath = path.join(process.cwd(), "dist");
    app.use(express.static(distPath));
    app.get("*", (req, res) => {
      res.sendFile(path.join(distPath, "index.html"));
    });
  }

  app.listen(PORT, "0.0.0.0", () => {
    console.log(`Server running on http://localhost:${PORT}`);
  });

  // Schedule background Auto-Research Job
  // Runs every day at 02:00 AM server time
  cron.schedule("0 2 * * *", () => {
    runDailyAutonomousResearch();
  });
  console.log("Hệ thống đặt lịch (Scheduler) Auto-Research đã được kích hoạt lúc 02:00 sáng mỗi ngày.");
}

startServer();
