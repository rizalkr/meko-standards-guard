#!/usr/bin/env node
import path from "node:path";
import { Command } from "commander";
import {
  GuardModeSchema,
  createMekoClient,
  loadAdrDocuments,
  loadGuardConfig,
  type GuardMode
} from "@meko-guard/core";

function resolveMode(rawMode: string | undefined): GuardMode {
  return GuardModeSchema.parse(rawMode ?? process.env.GUARD_MODE ?? "mock");
}

const program = new Command();

program
  .name("standards-guard")
  .description("Meko-backed Architecture & Financial Invariant Guard")
  .version("0.1.0")
  .option("--mode <mode>", "Meko client mode: mock | record | live");

program
  .command("seed")
  .description("Upload all ADR documents from standards/ into the Meko Knowledge Base")
  .action(async () => {
    const mode = resolveMode(program.opts<{ mode?: string }>().mode);
    const rootDir = process.cwd();
    const config = loadGuardConfig(rootDir);
    const docs = loadAdrDocuments(config, rootDir);
    const meko = createMekoClient({
      mode,
      datapack: config.datapack,
      fixturePath: path.resolve(rootDir, config.fixturePath)
    });

    await meko.connect();
    try {
      let created = 0;
      let updated = 0;
      for (const doc of docs) {
        const res = await meko.knowledgebaseUpload(doc);
        if (res.updated) {
          updated += 1;
        } else {
          created += 1;
        }
      }

      const receipt = await meko.artifactPut("seed-summary.json", {
        datapack: config.datapack,
        mode,
        adrCount: docs.length,
        adrIds: docs.map((d) => d.id)
      });

      const quota = meko.getQuotaUsage();
      console.log(
        `[standards-guard] Seeded ${docs.length} ADRs into "${config.datapack}" (mode=${mode}, created=${created}, updated=${updated})`
      );
      console.log(`[standards-guard] Seed artifact hash: ${receipt.contentHash}`);
      console.log(
        `[standards-guard] Session quota: uploads=${quota.uploads}, artifacts=${quota.artifacts}, searches=${quota.searches}`
      );
    } finally {
      await meko.close();
    }
  });

program
  .command("status")
  .description("Inspect Meko datapack knowledge, 2-tier memories, and artifacts")
  .action(async () => {
    const mode = resolveMode(program.opts<{ mode?: string }>().mode);
    const rootDir = process.cwd();
    const config = loadGuardConfig(rootDir);
    const meko = createMekoClient({
      mode,
      datapack: config.datapack,
      fixturePath: path.resolve(rootDir, config.fixturePath)
    });

    await meko.connect();
    try {
      const snapshot = await meko.getSnapshot();
      const privateMemories = snapshot.memories.filter((m) => m.tier === "private").length;
      const sharedMemories = snapshot.memories.filter((m) => m.tier === "shared").length;

      console.log(`Datapack: ${snapshot.datapack} (mode=${mode})`);
      console.log(`  Knowledge ADRs   : ${snapshot.knowledge.length}`);
      console.log(`  Private Memories : ${privateMemories}`);
      console.log(`  Shared Memories  : ${sharedMemories}`);
      console.log(`  Conversations    : ${snapshot.conversations.length}`);
      console.log(`  Artifacts        : ${snapshot.artifacts.length}`);
      console.log(`  Self-Learning    : ${snapshot.selfLearning.length}`);
    } finally {
      await meko.close();
    }
  });

program.parseAsync(process.argv).catch((err: unknown) => {
  const message = err instanceof Error ? err.message : String(err);
  console.error(`[standards-guard] Error: ${message}`);
  process.exitCode = 1;
});
