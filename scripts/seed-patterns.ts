import { randomUUID } from "crypto";
import { createMemoryRepository } from "../memoryRepository.js";
import { PatternTemplate } from "../src/types.js";

const memoryRepository = createMemoryRepository(process.cwd());

const defaultPatterns: PatternTemplate[] = [
  {
    name: "Express API Route Guard",
    summary: "Standardize request validation and failure-safe handling for Express endpoints.",
    intent: "Avoid inconsistent input validation and unhandled runtime errors across projects.",
    stack: ["express", "typescript", "zod"],
    triggers: ["api", "route", "validation", "endpoint", "express"],
    antiPatterns: ["trust raw body", "no validation"],
    requiredFiles: ["server.ts"],
    steps: [
      "Validate input payload at route boundary.",
      "Return explicit 4xx for invalid input.",
      "Wrap async logic and normalize error responses.",
    ],
    verification: {
      commands: ["npm run lint"],
      smokeChecks: ["Invalid payload returns 400", "Unhandled errors return 500 JSON"],
    },
  },
  {
    name: "Cross-Project Feature Porting",
    summary: "Port proven behavior from a sibling project with compatibility checks first.",
    intent: "Prevent blind copy-paste regressions when reusing existing functionality.",
    stack: ["typescript", "react", "express"],
    triggers: ["port", "apply from project", "reuse", "migrate feature"],
    antiPatterns: ["copy y chang", "skip compatibility check"],
    requiredFiles: ["package.json", "src/App.tsx"],
    steps: [
      "Map source feature dependencies and contracts.",
      "Compute compatibility gaps in target project.",
      "Apply minimal adaptation patch, not whole-file rewrites.",
      "Run verification gate before marking success.",
    ],
    verification: {
      commands: ["npm run lint", "npm run build"],
      smokeChecks: ["Core flow from source feature works in target project"],
    },
  },
  {
    name: "Pattern Apply Verification Gate",
    summary: "Enforce post-apply verification commands before a pattern is considered successful.",
    intent: "Stop false-positive success when changes compile but break behavior.",
    stack: ["typescript", "node"],
    triggers: ["pattern apply", "verification", "gate", "qa"],
    antiPatterns: ["skip tests", "assume success"],
    requiredFiles: ["package.json"],
    steps: [
      "Run command checks configured by pattern.",
      "Block success state if any verification fails.",
      "Persist success memory only when all checks pass.",
    ],
    verification: {
      commands: ["npm run lint"],
      smokeChecks: ["Only passed apply operations get success memory tag"],
    },
  },
];

async function run() {
  await memoryRepository.initialize();
  const existing = await memoryRepository.listMemories();
  const existingNames = new Set(
    existing
      .filter((m) => m.type === "pattern" && m.patternData?.name)
      .map((m) => m.patternData!.name)
  );

  let created = 0;
  for (const pattern of defaultPatterns) {
    if (existingNames.has(pattern.name)) {
      continue;
    }

    await memoryRepository.addMemory({
      id: randomUUID(),
      usage_count: 0,
      success_rate: 1,
      type: "pattern",
      content: `[Pattern] ${pattern.name}: ${pattern.summary}`,
      tags: ["pattern_registry", "seeded"],
      project: "Global",
      embedding: new Array(768).fill(0),
      patternData: pattern,
    });
    created += 1;
  }

  console.log(
    JSON.stringify(
      {
        status: "ok",
        created,
        skipped: defaultPatterns.length - created,
        totalPatterns: defaultPatterns.length,
      },
      null,
      2
    )
  );
}

run().catch((error) => {
  console.error("Failed to seed patterns:", error);
  process.exit(1);
});

