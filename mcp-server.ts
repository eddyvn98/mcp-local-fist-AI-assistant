import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import {
    CallToolRequestSchema,
    ListToolsRequestSchema,
} from "@modelcontextprotocol/sdk/types.js";
import { createMemoryRepository } from "./memoryRepository.js";
import { exec, execFile } from "child_process";
import { promisify } from "util";
import dotenv from "dotenv";
import fs from "fs/promises";
import path from "path";
import { randomUUID } from "crypto";
import { PatternTemplate } from "./src/types.js";

const execFileAsync = promisify(execFile);
const execAsync = promisify(exec);
dotenv.config();

const memoryRepository = createMemoryRepository(process.cwd());

async function codeSearch(query: string) {
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
        if (error.code === 1) return [];
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
        hasTsConfig: false,
    };
    try {
        const raw = await fs.readFile(pkgPath, "utf-8");
        const parsed = JSON.parse(raw);
        const deps = { ...(parsed.dependencies || {}), ...(parsed.devDependencies || {}) };
        result.dependencies = Object.keys(deps);
    } catch {
        // no-op
    }
    result.hasTsConfig = await fileExists(path.join(process.cwd(), "tsconfig.json"));
    return result;
}

async function calculatePatternFit(pattern: PatternTemplate, task: string, projectContext: string) {
    const normalizedTask = `${task} ${projectContext}`.toLowerCase();
    const signals = await detectProjectSignals();

    let score = 0;
    const reasons: string[] = [];
    const warnings: string[] = [];

    const triggerHits = pattern.triggers.filter((t) => normalizedTask.includes(t.toLowerCase()));
    if (triggerHits.length > 0) {
        score += Math.min(35, triggerHits.length * 8);
        reasons.push(`Task matches triggers: ${triggerHits.join(", ")}`);
    }

    const stackHits = pattern.stack.filter((s) =>
        signals.dependencies.some((dep) => dep.toLowerCase().includes(s.toLowerCase()))
    );
    if (stackHits.length > 0) {
        score += Math.min(25, stackHits.length * 6);
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
        reasons.push(`Required files present: ${requiredMatched}/${pattern.requiredFiles.length}`);
        if (requiredMatched === 0) {
            warnings.push("No required files found for this pattern in current repo.");
        }
    }

    const antiHits = pattern.antiPatterns.filter((a) => normalizedTask.includes(a.toLowerCase()));
    if (antiHits.length > 0) {
        score -= Math.min(25, antiHits.length * 8);
        warnings.push(`Anti-pattern conditions detected: ${antiHits.join(", ")}`);
    }

    score = Math.max(0, Math.min(100, score));
    return { score, reasons, warnings };
}

async function runVerification(commands: string[]) {
    const results: any[] = [];
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

const IGNORE_DIRS = new Set(["node_modules", ".git", "dist", "build", ".next", "out", "public", "assets", ".vscode"]);
const ALLOWED_EXTS = new Set([".js", ".jsx", ".ts", ".tsx", ".md", ".json"]);
const MAX_FILE_SIZE = 50_000;

async function ingestDirectory(targetDir: string, project?: string) {
    const absolute = path.resolve(targetDir);
    let totalFiles = 0;
    let saved = 0;

    async function walk(dir: string) {
        const entries = await fs.readdir(dir, { withFileTypes: true });
        for (const entry of entries) {
            const fullPath = path.join(dir, entry.name);
            if (entry.isDirectory()) {
                if (!IGNORE_DIRS.has(entry.name) && !entry.name.startsWith(".")) {
                    await walk(fullPath);
                }
                continue;
            }

            if (!entry.isFile()) {
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
            const content = await fs.readFile(fullPath, "utf-8");
            await memoryRepository.addMemory({
                id: Math.random().toString(36).substring(7),
                usage_count: 0,
                success_rate: 1,
                type: "pattern",
                content: `File: ${fullPath}\n\n${content}`,
                tags: [ext.replace(".", ""), "local_ingest"],
                project: project || path.basename(absolute),
            });
            saved += 1;
        }
    }

    await walk(absolute);
    return { scannedDirectory: absolute, totalFiles, saved };
}

const server = new Server(
    {
        name: "local-first-ai-assistant",
        version: "1.0.0",
    },
    {
        capabilities: {
            tools: {},
        },
    }
);

/**
 * List available tools.
 * Exposes core capabilities: memory retrieval and code search.
 */
server.setRequestHandler(ListToolsRequestSchema, async () => {
    return {
        tools: [
            {
                name: "list_memories",
                description: "List all stored technical memories and patterns.",
                inputSchema: { type: "object", properties: {} },
            },
            {
                name: "search_memory",
                description: "Search for technical memories using keywords.",
                inputSchema: {
                    type: "object",
                    properties: {
                        query: { type: "string", description: "The search term" },
                    },
                    required: ["query"],
                },
            },
            {
                name: "code_search",
                description: "Search for code snippets in the current workspace using grep.",
                inputSchema: {
                    type: "object",
                    properties: {
                        query: { type: "string", description: "The term to search for in code" },
                    },
                    required: ["query"],
                },
            },
            {
                name: "ingest_directory",
                description: "Scan a local directory and persist compact code knowledge into memory for future retrieval.",
                inputSchema: {
                    type: "object",
                    properties: {
                        dir: { type: "string", description: "Absolute or relative directory path (e.g. D:/repo-name)" },
                        project: { type: "string", description: "Optional project label to store with memories" },
                    },
                    required: ["dir"],
                },
            },
            {
                name: "memory_stats",
                description: "Return memory storage statistics by type.",
                inputSchema: { type: "object", properties: {} },
            },
            {
                name: "pattern_register",
                description: "Register a reusable implementation pattern with fit rules and verification commands.",
                inputSchema: {
                    type: "object",
                    properties: {
                        pattern: { type: "object", description: "PatternTemplate payload" },
                        project: { type: "string", description: "Project label for this pattern" },
                        tags: { type: "array", items: { type: "string" }, description: "Optional tags" },
                    },
                    required: ["pattern"],
                },
            },
            {
                name: "pattern_list",
                description: "List registered patterns from memory.",
                inputSchema: { type: "object", properties: {} },
            },
            {
                name: "pattern_apply",
                description: "Analyze fit, select best pattern, and run optional verification commands.",
                inputSchema: {
                    type: "object",
                    properties: {
                        task: { type: "string", description: "Task to solve" },
                        projectContext: { type: "string", description: "Optional project context" },
                        minFitScore: { type: "number", description: "Minimum fit threshold, default 60" },
                        dryRun: { type: "boolean", description: "Plan only, skip verification" },
                        overrideVerificationCommands: {
                            type: "array",
                            items: { type: "string" },
                            description: "Optional command list to run instead of pattern defaults",
                        },
                    },
                    required: ["task"],
                },
            },
        ],
    };
});

/**
 * Handle tool execution.
 */
server.setRequestHandler(CallToolRequestSchema, async (request) => {
    const { name, arguments: args } = request.params;

    try {
        switch (name) {
            case "list_memories": {
                const memories = await memoryRepository.listMemories();
                return {
                    content: [{ type: "text", text: JSON.stringify(memories, null, 2) }],
                };
            }
            case "search_memory": {
                const query = (args?.query as string) || "";
                const memories = await memoryRepository.listMemories();
                const filtered = memories.filter(m =>
                    m.content.toLowerCase().includes(query.toLowerCase()) ||
                    m.tags.some(t => t.toLowerCase().includes(query.toLowerCase()))
                );
                return {
                    content: [{ type: "text", text: JSON.stringify(filtered, null, 2) }],
                };
            }
            case "code_search": {
                const query = (args?.query as string) || "";
                const results = await codeSearch(query);
                return {
                    content: [{ type: "text", text: JSON.stringify(results, null, 2) }],
                };
            }
            case "ingest_directory": {
                const dir = String(args?.dir || "").trim();
                const project = typeof args?.project === "string" ? args.project : undefined;
                if (!dir) {
                    throw new Error("dir is required");
                }

                const result = await ingestDirectory(dir, project);
                return {
                    content: [{ type: "text", text: JSON.stringify(result, null, 2) }],
                };
            }
            case "memory_stats": {
                const stats = await memoryRepository.getStats();
                return {
                    content: [{ type: "text", text: JSON.stringify(stats, null, 2) }],
                };
            }
            case "pattern_register": {
                const pattern = parsePatternTemplate(args?.pattern || {});
                const project = typeof args?.project === "string" ? args.project : "General";
                const tags = Array.isArray(args?.tags) ? args.tags.map((v: any) => String(v)) : [];
                if (!pattern.name || !pattern.intent || !pattern.summary) {
                    throw new Error("pattern.name, pattern.intent, and pattern.summary are required");
                }

                const stored = await memoryRepository.addMemory({
                    id: randomUUID(),
                    usage_count: 0,
                    success_rate: 1,
                    type: "pattern",
                    content: `[Pattern] ${pattern.name}: ${pattern.summary}`,
                    tags: Array.from(new Set([...tags, "pattern_registry"])),
                    project,
                    embedding: new Array(768).fill(0),
                    patternData: pattern,
                });
                return {
                    content: [{ type: "text", text: JSON.stringify(stored, null, 2) }],
                };
            }
            case "pattern_list": {
                const all = await memoryRepository.listMemories();
                const patterns = all
                    .filter((m) => m.type === "pattern" && m.patternData)
                    .map((m) => ({
                        id: m.id,
                        project: m.project,
                        tags: m.tags,
                        usage_count: m.usage_count,
                        success_rate: m.success_rate,
                        pattern: m.patternData,
                    }));
                return {
                    content: [{ type: "text", text: JSON.stringify({ total: patterns.length, patterns }, null, 2) }],
                };
            }
            case "pattern_apply": {
                const task = String(args?.task || "").trim();
                const projectContext = String(args?.projectContext || "");
                const minFitScore = Number(args?.minFitScore ?? 60);
                const dryRun = Boolean(args?.dryRun ?? false);
                const overrideVerificationCommands = Array.isArray(args?.overrideVerificationCommands)
                    ? args.overrideVerificationCommands.map((v: any) => String(v))
                    : [];

                if (!task) {
                    throw new Error("task is required");
                }

                const all = await memoryRepository.listMemories();
                const candidates = all.filter((m) => m.type === "pattern" && m.patternData);
                if (candidates.length === 0) {
                    throw new Error("No registered patterns found. Use pattern_register first.");
                }

                const scored = await Promise.all(
                    candidates.map(async (entry) => ({
                        entry,
                        fit: await calculatePatternFit(entry.patternData!, task, projectContext),
                    }))
                );
                scored.sort((a, b) => b.fit.score - a.fit.score);

                const best = scored[0];
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

                if (best.fit.score < minFitScore) {
                    return {
                        content: [{
                            type: "text",
                            text: JSON.stringify({
                                status: "rejected_low_fit",
                                threshold: minFitScore,
                                applyPlan,
                                alternatives: scored.slice(1, 4).map((s) => ({
                                    patternName: s.entry.patternData?.name,
                                    score: s.fit.score,
                                })),
                            }, null, 2),
                        }],
                    };
                }

                const verificationCommands = overrideVerificationCommands.length > 0
                    ? overrideVerificationCommands
                    : best.entry.patternData!.verification.commands;
                const verificationResults = !dryRun && verificationCommands.length > 0
                    ? await runVerification(verificationCommands)
                    : [];
                const verificationPassed = verificationResults.length === 0 || verificationResults.every((r) => r.ok);

                if (!dryRun && verificationPassed) {
                    await memoryRepository.addMemory({
                        id: randomUUID(),
                        usage_count: 0,
                        success_rate: 1,
                        type: "decision",
                        content: `Pattern applied successfully: ${best.entry.patternData!.name}`,
                        tags: ["pattern_apply_success", best.entry.patternData!.name],
                        project: projectContext || "General",
                        embedding: new Array(768).fill(0),
                    });
                }

                return {
                    content: [{
                        type: "text",
                        text: JSON.stringify({
                            status: dryRun ? "planned" : verificationPassed ? "ready" : "verification_failed",
                            applyPlan,
                            verification: {
                                executed: !dryRun,
                                commands: verificationCommands,
                                passed: verificationPassed,
                                results: verificationResults,
                            },
                        }, null, 2),
                    }],
                };
            }
            default:
                throw new Error(`Unknown tool: ${name}`);
        }
    } catch (error: any) {
        return {
            content: [{ type: "text", text: `Error: ${error.message}` }],
            isError: true,
        };
    }
});

/**
 * Start the server using stdio transport.
 */
async function main() {
    await memoryRepository.initialize();
    const transport = new StdioServerTransport();
    await server.connect(transport);
    console.error("Local First AI Assistant MCP server running on stdio");
}

main().catch((error) => {
    console.error("Server error:", error);
    process.exit(1);
});
