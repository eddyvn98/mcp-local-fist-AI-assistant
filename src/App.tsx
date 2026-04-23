/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import { useState, useEffect, useRef } from "react";
import {
  Terminal,
  Brain,
  Database,
  Code2,
  Send,
  Settings,
  Sparkles,
  AlertCircle,
  CheckCircle2,
  Bug,
  Lightbulb,
  Search,
  ExternalLink,
  Save,
  Trash2,
  BarChart3
} from "lucide-react";
import { motion, AnimatePresence } from "motion/react";
import ReactMarkdown from "react-markdown";
import { cn } from "./lib/utils";
import { memoryService } from "./services/memoryService";
import { MemoryEntry, KnowledgeType } from "./types";
import {
  BarChart,
  Bar,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ResponsiveContainer,
  Cell
} from "recharts";

export default function App() {
  const [task, setTask] = useState("");
  const [currentCode, setCurrentCode] = useState("// Write or paste code here...");
  const [projectContext, setProjectContext] = useState("E-commerce React Application");
  const [isLoading, setIsLoading] = useState(false);
  const [messages, setMessages] = useState<any[]>([]);
  const [memories, setMemories] = useState<MemoryEntry[]>([]);
  const [routingData, setRoutingData] = useState<any>(null);
  const [isAddingMemory, setIsAddingMemory] = useState(false);
  const [newMemory, setNewMemory] = useState({ content: "", type: "pattern" as KnowledgeType, tags: "" });

  const scrollRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    // Initial Load / Mock data seeding
    const seed = async () => {
      try {
        const stats = await memoryService.getStats();
        if (stats.totalItems === 0) {
          await memoryService.addMemory({
            content: "Use react-query for all API calls to ensure consistency and cache management.",
            type: "pattern",
            tags: ["react", "api", "standard"],
            project: "Alpha Project"
          });
          await memoryService.addMemory({
            content: "Fixed a recurring bug in Tailwind grid layouts where columns would collapse on mobile by adding min-w-0 to flex items.",
            type: "bug_fix",
            tags: ["css", "tailwind", "layout"],
            project: "Beta Project"
          });
          await memoryService.addMemory({
            content: "Decision to use Vite instead of Webpack for faster HMR and build times in large codebases.",
            type: "decision",
            tags: ["build", "dx"],
            project: "Global Project"
          });
        }
        refreshMemories();
      } catch (e) {
        console.error("Seed failed", e);
      }
    };
    seed();
  }, []);

  const refreshMemories = async () => {
    try {
      const ms = await memoryService.getMemories();
      setMemories(ms);
    } catch (e) {
      console.error(e);
    }
  };

  const handleSend = async () => {
    if (!task.trim()) return;

    setIsLoading(true);
    setMessages(prev => [...prev, { role: "user", content: task }]);

    try {
      const resp = await fetch("/api/mcp/query", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ task, currentCode, projectContext })
      });
      const data = await resp.json();

      if (!resp.ok) {
        throw new Error(data.error || "Failed to process task");
      }

      setRoutingData({ decision: data.decision, relevantMemories: data.relevantMemories, codeSearchResults: data.codeSearchResults });

      setMessages(prev => [...prev, {
        role: "assistant",
        content: data.aiResponse || "No response from AI.",
        routing: { decision: data.decision, relevantMemories: data.relevantMemories, codeSearchResults: data.codeSearchResults }
      }]);

    } catch (error: any) {
      console.error(error);
      setMessages(prev => [...prev, { role: "assistant", content: `Error: ${error.message || "Failed to process task."}` }]);
    } finally {
      setIsLoading(false);
      setTask("");
    }
  };

  const handleAddMemory = async () => {
    if (!newMemory.content) return;
    await memoryService.addMemory({
      content: newMemory.content,
      type: newMemory.type,
      tags: newMemory.tags.split(",").map(t => t.trim()),
      project: "Manual Entry"
    });
    setNewMemory({ content: "", type: "pattern", tags: "" });
    setIsAddingMemory(false);
    refreshMemories();
  };

  return (
    <div className="flex h-screen bg-[#0d0d0d] text-gray-200 font-sans selection:bg-indigo-500/30 overflow-hidden">
      {/* Sidebar - Memory & Stats */}
      <aside className="w-80 border-r border-white/5 bg-black/40 p-4 flex flex-col gap-6 overflow-y-auto">
        <div className="flex items-center gap-2 px-2 py-1">
          <div className="w-8 h-8 rounded-lg bg-indigo-600 flex items-center justify-center">
            <Brain className="w-5 h-5 text-white" />
          </div>
          <h1 className="font-semibold text-lg tracking-tight">MCP Core</h1>
        </div>

        <div>
          <div className="flex items-center justify-between mb-3 px-2">
            <div className="flex items-center gap-2 text-xs font-medium text-gray-400 uppercase tracking-wider">
              <Database className="w-4 h-4" />
              Memory Store
            </div>
            <button
              onClick={() => setIsAddingMemory(true)}
              className="p-1 hover:bg-white/5 rounded text-indigo-400 hover:text-indigo-300 transition-colors"
            >
              <Save className="w-4 h-4" />
            </button>
          </div>

          <div className="space-y-3">
            {memories.map((m) => (
              <div
                key={m.id}
                className="p-3 rounded-xl bg-white/5 border border-white/5 hover:border-indigo-500/30 transition-all group"
              >
                <div className="flex items-center justify-between mb-2">
                  <span className={cn(
                    "text-[10px] px-1.5 py-0.5 rounded uppercase font-bold tracking-tighter",
                    m.type === "pattern" ? "bg-blue-500/20 text-blue-400" :
                      m.type === "bug_fix" ? "bg-red-500/20 text-red-400" :
                        "bg-amber-500/20 text-amber-400"
                  )}>
                    {m.type}
                  </span>
                  <span className="text-[10px] text-gray-500">{m.project}</span>
                </div>
                <div className="text-sm text-gray-300 line-clamp-3 leading-relaxed">{m.content}</div>
                <div className="mt-2 flex flex-wrap gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
                  {m.tags.map(tag => (
                    <span key={tag} className="text-[9px] px-1 bg-white/5 rounded text-gray-500">#{tag}</span>
                  ))}
                </div>
              </div>
            ))}
          </div>
        </div>

        <div className="mt-auto border-t border-white/5 pt-6 pb-2">
          <div className="flex items-center gap-2 text-xs font-medium text-gray-400 uppercase tracking-wider mb-4 px-2">
            <BarChart3 className="w-4 h-4" />
            Intelligence Stats
          </div>
          <div className="h-32 w-full" style={{ minHeight: '128px' }}>
            <ResponsiveContainer width="100%" height="100%">
              <BarChart data={[
                { name: 'Pat', val: (memories || []).filter(m => m.type === 'pattern').length },
                { name: 'Bugs', val: (memories || []).filter(m => m.type === 'bug_fix').length },
                { name: 'Dec', val: (memories || []).filter(m => m.type === 'decision').length },
              ]}>
                <Bar dataKey="val">
                  {[0, 1, 2].map((entry, index) => <Cell key={index} fill={['#3b82f6', '#ef4444', '#f59e0b'][index]} fillOpacity={0.6} />)}
                </Bar>
              </BarChart>
            </ResponsiveContainer>
          </div>
        </div>
      </aside>

      {/* Main Content Area */}
      <main className="flex-1 flex flex-col min-w-0 bg-[#0d0d0d]">
        {/* Header/Context Bar */}
        <header className="h-14 border-b border-white/5 flex items-center px-6 justify-between bg-black/20 backdrop-blur-sm z-10">
          <div className="flex items-center gap-4">
            <div className="flex items-center gap-2">
              <Code2 className="w-4 h-4 text-indigo-500" />
              <input
                value={projectContext}
                onChange={(e) => setProjectContext(e.target.value)}
                className="bg-transparent text-sm border-none focus:outline-none text-gray-400 hover:text-white transition-colors"
                placeholder="Project Name..."
              />
            </div>
            <div className="h-4 w-px bg-white/10" />
            <div className="flex gap-4">
              <button className="text-xs text-gray-500 hover:text-indigo-400 transition-colors flex items-center gap-1.5">
                <Terminal className="w-3.5 h-3.5" />
                Terminal
              </button>
              <button className="text-xs text-gray-500 hover:text-indigo-400 transition-colors flex items-center gap-1.5">
                <Search className="w-3.5 h-3.5" />
                Global Search
              </button>
            </div>
          </div>
          <div className="flex items-center gap-3">
            <div className="flex -space-x-2">
              {[1, 2, 3].map(i => (
                <div key={i} className="w-6 h-6 rounded-full border-2 border-[#0d0d0d] bg-gradient-to-br from-indigo-500 to-purple-500 flex items-center justify-center text-[8px] font-bold">
                  A{i}
                </div>
              ))}
            </div>
            <Settings className="w-4 h-4 text-gray-500 hover:text-white cursor-pointer" />
          </div>
        </header>

        {/* Editor & Task Interaction */}
        <div className="flex-1 flex flex-col p-6 gap-6 overflow-hidden">
          {/* Editor Area */}
          <div className="flex-1 rounded-2xl border border-white/5 bg-black/20 overflow-hidden flex flex-col shadow-2xl relative shadow-indigo-500/5">
            <div className="h-10 border-b border-white/5 bg-black/40 flex items-center px-4 justify-between">
              <div className="flex items-center gap-2">
                <div className="flex gap-1.5">
                  <div className="w-2.5 h-2.5 rounded-full bg-red-500/50" />
                  <div className="w-2.5 h-2.5 rounded-full bg-amber-500/50" />
                  <div className="w-2.5 h-2.5 rounded-full bg-emerald-500/50" />
                </div>
                <span className="ml-4 text-xs font-mono text-gray-500">current_code.ts</span>
              </div>
              <Sparkles className="w-4 h-4 text-indigo-500/50" />
            </div>
            <textarea
              value={currentCode}
              onChange={(e) => setCurrentCode(e.target.value)}
              className="flex-1 bg-transparent p-6 font-mono text-sm resize-none focus:outline-none leading-relaxed text-indigo-100/80"
            />
            <div className="absolute top-12 right-6 flex flex-col gap-2">
              <div className="px-3 py-1.5 rounded-lg bg-indigo-500/10 border border-indigo-500/20 text-[10px] font-mono text-indigo-400 backdrop-blur-md">
                MCP ACTIVE
              </div>
            </div>
          </div>

          {/* Task Input */}
          <div className="h-32 flex gap-4">
            <div className="flex-1 relative group">
              <textarea
                value={task}
                onChange={(e) => setTask(e.target.value)}
                onKeyDown={(e) => e.key === 'Enter' && !e.shiftKey && (e.preventDefault(), handleSend())}
                placeholder="Describe your coding task..."
                className="w-full h-full bg-white/5 border border-white/10 rounded-2xl p-4 pr-16 text-sm focus:outline-none focus:border-indigo-500/50 transition-all resize-none shadow-xl"
              />
              <button
                onClick={handleSend}
                disabled={isLoading || !task.trim()}
                className="absolute bottom-4 right-4 w-10 h-10 rounded-xl bg-indigo-600 flex items-center justify-center hover:bg-indigo-500 disabled:bg-gray-800 disabled:text-gray-600 transition-all shadow-lg hover:shadow-indigo-500/20"
              >
                <Send className={cn("w-5 h-5 text-white transition-transform", isLoading && "animate-pulse")} />
              </button>
            </div>
          </div>
        </div>
      </main>

      {/* Chat & Context Insights Panel */}
      <aside className="w-[400px] border-l border-white/5 bg-black/40 flex flex-col overflow-hidden">
        <div className="h-14 border-b border-white/5 flex items-center px-6 gap-2">
          <Terminal className="w-4 h-4 text-gray-500" />
          <h2 className="text-sm font-semibold text-gray-300">AI Context & Memory</h2>
        </div>

        <div className="flex-1 overflow-y-auto p-6 space-y-6 flex flex-col" ref={scrollRef}>
          {messages.length === 0 ? (
            <div className="flex-1 flex flex-col items-center justify-center text-center p-8 space-y-4">
              <div className="w-16 h-16 rounded-3xl bg-indigo-500/10 flex items-center justify-center">
                <Brain className="w-8 h-8 text-indigo-500/50" />
              </div>
              <div>
                <h3 className="text-gray-300 font-medium mb-1">Waiting for instructions</h3>
                <p className="text-xs text-gray-500 leading-relaxed max-w-[200px]">
                  Enter a task to see how MCP intelligently routes through your local memory.
                </p>
              </div>
            </div>
          ) : (
            messages.map((m, i) => (
              <div key={i} className={cn(
                "flex flex-col gap-3",
                m.role === "user" ? "items-end" : "items-start"
              )}>
                {m.role === "user" ? (
                  <div className="bg-indigo-600/20 border border-indigo-500/30 px-4 py-3 rounded-2xl max-w-[80%]">
                    <div className="text-sm text-indigo-100">{m.content}</div>
                  </div>
                ) : (
                  <div className="space-y-4 w-full">
                    {/* Routing Meta */}
                    {m.routing && (
                      <div className="p-4 rounded-2xl bg-black/40 border border-white/5 space-y-3">
                        <div className="flex items-center justify-between">
                          <div className="flex items-center gap-2 text-[10px] font-bold text-gray-500 uppercase tracking-widest">
                            <Sparkles className="w-3 h-3 text-amber-500" />
                            Routing Analysis
                          </div>
                          <div className={cn(
                            "text-[10px] px-2 py-0.5 rounded-full font-bold",
                            m.routing.decision.useMemory === "strong" ? "bg-emerald-500/20 text-emerald-400" :
                              m.routing.decision.useMemory === "reference" ? "bg-blue-500/20 text-blue-400" :
                                "bg-gray-500/20 text-gray-400"
                          )}>
                            {m.routing.decision.useMemory === "strong" ? "HIGH RELEVANCE" : m.routing.decision.useMemory === "reference" ? "CONTEXTUAL" : "GENERAL KNOWLEDGE"}
                          </div>
                        </div>

                        <div className="space-y-2">
                          <div className="flex justify-between text-[10px]">
                            <span className="text-gray-500">Score: {Math.round(m.routing.decision.similarity * 100)}%</span>
                            <span className="text-gray-500">3 Memories Fetched</span>
                          </div>
                          <div className="h-1.5 w-full bg-white/5 rounded-full overflow-hidden">
                            <motion.div
                              initial={{ width: 0 }}
                              animate={{ width: `${m.routing.decision.similarity * 100}%` }}
                              className={cn(
                                "h-full rounded-full bg-gradient-to-r",
                                m.routing.decision.useMemory === "strong" ? "from-emerald-500 to-teal-500" : "from-indigo-500 to-purple-500"
                              )}
                            />
                          </div>
                        </div>

                        {(m.routing.relevantMemories || []).slice(0, 2).map((mem: any, idx: number) => (
                          <div key={idx} className="flex gap-3 text-[11px] bg-white/5 p-2 rounded-lg border border-white/5">
                            <AlertCircle className="w-3.5 h-3.5 text-indigo-400 shrink-0" />
                            <div className="text-gray-400 italic line-clamp-2">“{mem.content}”</div>
                          </div>
                        ))}

                        {Array.isArray(m.routing.codeSearchResults) && m.routing.codeSearchResults.length > 0 && (
                          <div className="pt-2 space-y-2">
                            <div className="text-[9px] font-bold text-gray-600 uppercase tracking-widest pl-1">Code Snippets</div>
                            {m.routing.codeSearchResults.slice(0, 3).map((res: any, idx: number) => (
                              <div key={idx} className="flex gap-2 text-[10px] bg-indigo-500/5 p-2 rounded-lg border border-indigo-500/10">
                                <Code2 className="w-3 h-3 text-indigo-400 shrink-0 mt-0.5" />
                                <div className="min-w-0">
                                  <div className="text-gray-300 truncate font-mono">{res.file}:{res.line}</div>
                                  <div className="text-gray-500 truncate italic">{res.content}</div>
                                </div>
                              </div>
                            ))}
                          </div>
                        )}
                      </div>
                    )}

                    {/* AI Content */}
                    <div className="bg-white/5 border border-white/5 p-5 rounded-3xl w-full prose prose-invert prose-sm max-w-none">
                      <ReactMarkdown>{m.content}</ReactMarkdown>
                    </div>
                  </div>
                )}
              </div>
            ))
          )}
          {isLoading && (
            <div className="flex items-center gap-3 text-gray-500 animate-pulse bg-white/5 p-4 rounded-2xl border border-white/5">
              <div className="flex gap-1">
                <div className="w-1.5 h-1.5 rounded-full bg-indigo-500 animate-bounce" />
                <div className="w-1.5 h-1.5 rounded-full bg-indigo-500 animate-bounce delay-75" />
                <div className="w-1.5 h-1.5 rounded-full bg-indigo-500 animate-bounce delay-150" />
              </div>
              <span className="text-xs font-mono">Routing task through MCP Layer...</span>
            </div>
          )}
        </div>
      </aside>

      {/* Add Memory Modal Overlay */}
      <AnimatePresence>
        {isAddingMemory && (
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className="fixed inset-0 bg-black/60 backdrop-blur-md z-50 flex items-center justify-center p-6"
          >
            <motion.div
              initial={{ scale: 0.9, y: 20 }}
              animate={{ scale: 1, y: 0 }}
              exit={{ scale: 0.9, y: 20 }}
              className="w-full max-w-md bg-[#121212] border border-white/10 rounded-3xl p-8 shadow-2xl"
            >
              <div className="flex items-center gap-3 mb-6">
                <div className="w-10 h-10 rounded-2xl bg-indigo-500/20 flex items-center justify-center">
                  <Database className="w-5 h-5 text-indigo-400" />
                </div>
                <div>
                  <h3 className="text-lg font-semibold text-white">Store Knowledge</h3>
                  <div className="text-xs text-gray-500">Capture a pattern, bug fix, or technical decision.</div>
                </div>
              </div>

              <div className="space-y-4">
                <div className="space-y-2">
                  <label className="text-[10px] font-bold text-gray-500 uppercase tracking-widest pl-1">Type</label>
                  <div className="grid grid-cols-3 gap-2">
                    {["pattern", "bug_fix", "decision"].map(type => (
                      <button
                        key={type}
                        onClick={() => setNewMemory(prev => ({ ...prev, type: type as KnowledgeType }))}
                        className={cn(
                          "py-2 rounded-xl text-[10px] font-bold uppercase transition-all border",
                          newMemory.type === type
                            ? "bg-indigo-600 border-indigo-500 text-white shadow-lg shadow-indigo-500/20"
                            : "bg-white/5 border-white/5 text-gray-500 hover:border-white/10"
                        )}
                      >
                        {type.replace("_", " ")}
                      </button>
                    ))}
                  </div>
                </div>

                <div className="space-y-2">
                  <label className="text-[10px] font-bold text-gray-500 uppercase tracking-widest pl-1">Content</label>
                  <textarea
                    value={newMemory.content}
                    onChange={(e) => setNewMemory(prev => ({ ...prev, content: e.target.value }))}
                    placeholder="Describe the knowledge or pattern..."
                    className="w-full h-32 bg-white/5 border border-white/5 rounded-xl p-4 text-sm focus:outline-none focus:border-indigo-500/50 transition-all resize-none"
                  />
                </div>

                <div className="space-y-2">
                  <label className="text-[10px] font-bold text-gray-500 uppercase tracking-widest pl-1">Tags (comma separated)</label>
                  <input
                    value={newMemory.tags}
                    onChange={(e) => setNewMemory(prev => ({ ...prev, tags: e.target.value }))}
                    placeholder="e.g. react, performance, bug"
                    className="w-full bg-white/5 border border-white/5 rounded-xl px-4 py-3 text-sm focus:outline-none focus:border-indigo-500/50 transition-all"
                  />
                </div>
              </div>

              <div className="mt-8 flex gap-3">
                <button
                  onClick={() => setIsAddingMemory(false)}
                  className="flex-1 py-3 rounded-xl border border-white/5 text-sm font-medium text-gray-500 hover:bg-white/5 transition-all"
                >
                  Cancel
                </button>
                <button
                  onClick={handleAddMemory}
                  className="flex-1 py-3 rounded-xl bg-indigo-600 text-sm font-medium text-white hover:bg-indigo-500 transition-all shadow-lg hover:shadow-indigo-500/20"
                >
                  Store Memory
                </button>
              </div>
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}
