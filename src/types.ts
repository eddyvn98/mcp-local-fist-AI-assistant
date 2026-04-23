export type KnowledgeType = "pattern" | "bug_fix" | "decision";

export interface PatternVerificationSpec {
  commands: string[];
  smokeChecks: string[];
}

export interface PatternTemplate {
  name: string;
  summary: string;
  intent: string;
  stack: string[];
  triggers: string[];
  antiPatterns: string[];
  requiredFiles: string[];
  steps: string[];
  verification: PatternVerificationSpec;
}

export interface MemoryEntry {
  id?: string;
  type: KnowledgeType;
  content: string;
  tags: string[];
  project: string;
  usage_count?: number;
  success_rate?: number;
  embedding?: number[];
  patternData?: PatternTemplate;
}

export interface ContextSelection {
  current_code?: string;
  related_code?: string;
  memory: MemoryEntry[];
  project_context: string;
}

export interface RoutingDecision {
  useMemory: "strong" | "reference" | "ignore";
  similarity: number;
}

export interface PatternFitReport {
  score: number;
  reasons: string[];
  warnings: string[];
}

export interface VerificationCommandResult {
  command: string;
  ok: boolean;
  stdout: string;
  stderr: string;
}
