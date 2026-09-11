import fs from "node:fs";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { useAutoCleanupTempDirTracker } from "../../test/helpers/temp-dir.js";
import type { LegacyStateMigrationStepReceipt } from "../infra/state-migrations.types.js";
import {
  createSourceRuntime,
  runIsolatedModuleScript,
} from "./doctor-config-preflight.process.test-support.js";

const tempDirs = useAutoCleanupTempDirTracker(afterEach);

describe("Doctor preflight historical Workshop workspace", () => {
  it.each([
    { historical: false, status: "pending" },
    { historical: false, status: "applied" },
    { historical: true, status: "pending" },
    { historical: true, status: "applied" },
  ] as const)(
    "settles setup before relocating a $status create (historical=$historical)",
    async ({ historical, status }) => {
      const root = fs.realpathSync(tempDirs.make("openclaw-doctor-historical-workspace-"));
      const stateDir = path.join(root, "state");
      const oldWorkspace = path.join(root, "workspace");
      const currentWorkspace = historical ? path.join(oldWorkspace, "current") : oldWorkspace;
      const configPath = path.join(root, "openclaw.json");
      const configRaw = JSON.stringify({
        agents: { defaults: { workspace: currentWorkspace }, entries: { main: {} } },
      });
      fs.mkdirSync(currentWorkspace, { recursive: true });
      fs.mkdirSync(stateDir, { recursive: true });
      fs.writeFileSync(configPath, configRaw);
      const sourcePath = path.join(oldWorkspace, "openclaw-workspace-state.json");
      const setup = {
        version: 1,
        bootstrapSeededAt: "2026-07-05T17:21:38.000Z",
        setupCompletedAt: "2026-07-05T17:29:02.000Z",
      };
      const setupRaw = JSON.stringify(setup);
      fs.writeFileSync(sourcePath, setupRaw);
      const runtimeRoot = createSourceRuntime(root);
      const { stdout } = await runIsolatedModuleScript(
        {
          PATH: process.env.PATH,
          HOME: root,
          USERPROFILE: root,
          OPENCLAW_STATE_DIR: stateDir,
          OPENCLAW_CONFIG_PATH: configPath,
          OPENCLAW_SERVICE_REPAIR_POLICY: "external",
          NO_COLOR: "1",
        },
        `
        import fs from "node:fs";
        import path from "node:path";
        import assert from "node:assert/strict";
        import { runDoctorConfigPreflight } from "./src/commands/doctor-config-preflight.ts";
        import { readWorkspaceStateSnapshot } from "./src/agents/workspace-state-store.ts";
        import { hashSkillProposalContent, importLegacySkillProposal, readSkillProposalRecord } from "./src/skills/workshop/store.ts";
        import { SKILL_WORKSHOP_SCHEMA } from "./src/skills/workshop/types.ts";
        import { resolveWorkshopSkillsDir } from "./src/skills/workshop/skills-root.ts";
        import { openOpenClawStateDatabase } from "./src/state/openclaw-state-db.ts";
        const config = ${configRaw};
        const oldWorkspace = ${JSON.stringify(oldWorkspace)};
        const stateDir = ${JSON.stringify(stateDir)};
        const status = ${JSON.stringify(status)};
        const skillDir = path.join(oldWorkspace, "skills", "retained-procedure");
        const content = "---\\nname: retained-procedure\\ndescription: Retained procedure\\n---\\n\\n# Retained procedure\\n";
        const now = "2026-09-01T00:00:00.000Z";
        const record = {
          schema: SKILL_WORKSHOP_SCHEMA,
          id: "retained-procedure-20260901-1234567890",
          kind: "create", status,
          title: "Create retained procedure", description: "Retained procedure",
          createdAt: now, updatedAt: now, createdBy: "skill-workshop",
          proposedVersion: "v1", draftFile: "PROPOSAL.md",
          draftHash: hashSkillProposalContent(content),
          target: {
            skillKey: "retained-procedure", skillName: "retained-procedure",
            skillDir, skillFile: path.join(skillDir, "SKILL.md"), source: "openclaw-workspace",
          },
          scan: { state: "clean", scannedAt: now, critical: 0, warn: 0, info: 0, findings: [] },
          ...(status === "applied" ? { appliedAt: now } : {}),
        };
        importLegacySkillProposal({ record, ownerAgentId: "main", store: { config, env: process.env } });
        // Doctor retires missing pending drafts before relocation. Keep a valid
        // bundle so this fixture reaches the historical setup gate instead.
        const draftDir = path.join(stateDir, "skill-workshop", "proposals", record.id);
        fs.mkdirSync(draftDir, { recursive: true });
        fs.writeFileSync(path.join(draftDir, record.draftFile), content);
        if (status === "applied") {
          fs.mkdirSync(skillDir, { recursive: true });
          fs.writeFileSync(record.target.skillFile, content);
        }
        let result;
        try {
          await runDoctorConfigPreflight({ doctorOnlyStateMigrations: true, migrateLegacyConfig: false });
          result = { completed: true };
        } catch (error) {
          result = { completed: false, name: error.name, stepReceipts: error.stepReceipts, message: error.message };
        }
        const options = { config, env: process.env };
        const readRecord = () => readSkillProposalRecord(record.id, options, {}, { config });
        if (!result.completed) {
          assert.equal(fs.readFileSync(${JSON.stringify(sourcePath)}, "utf8"), ${JSON.stringify(setupRaw)});
          assert.equal(fs.existsSync(${JSON.stringify(sourcePath)} + ".doctor-importing"), false);
          assert.deepEqual(await readRecord(), record);
        } else {
          const snapshot = await readWorkspaceStateSnapshot(oldWorkspace, { env: process.env });
          assert.equal(snapshot.setup.bootstrapSeededAt, ${JSON.stringify(setup.bootstrapSeededAt)});
          assert.equal(snapshot.setup.setupCompletedAt, ${JSON.stringify(setup.setupCompletedAt)});
          assert.equal(fs.existsSync(${JSON.stringify(sourcePath)}), false);
          const archives = fs.readdirSync(oldWorkspace).filter(name => name.startsWith("openclaw-workspace-state.json.migrated."));
          assert.equal(archives.length, 1);
          assert.equal(fs.readFileSync(path.join(oldWorkspace, archives[0]), "utf8"), ${JSON.stringify(setupRaw)});
          const db = openOpenClawStateDatabase({ env: process.env }).db;
          const receipt = db.prepare("SELECT report_json, removed_source FROM migration_sources WHERE source_path = ?").get(${JSON.stringify(sourcePath)});
          assert.equal(receipt.removed_source, 1);
          assert.equal(JSON.parse(receipt.report_json).archivePath, path.join(oldWorkspace, archives[0]));
          const migrated = await readRecord();
          const destination = path.join(resolveWorkshopSkillsDir(config, "main", process.env), record.target.skillKey);
          assert.deepEqual(migrated, { ...record, target: { ...record.target, skillDir: destination, skillFile: path.join(destination, "SKILL.md"), source: "openclaw-workshop" } });
          if (status === "applied") assert.equal(fs.readFileSync(migrated.target.skillFile, "utf8"), content);
          else assert.equal(fs.existsSync(migrated.target.skillFile), false);
          await runDoctorConfigPreflight({ doctorOnlyStateMigrations: true, migrateLegacyConfig: false });
          assert.deepEqual(await readRecord(), migrated);
          assert.deepEqual(db.prepare("SELECT report_json, removed_source FROM migration_sources WHERE source_path = ?").get(${JSON.stringify(sourcePath)}), receipt);
          assert.deepEqual(fs.readdirSync(oldWorkspace).filter(name => name.startsWith("openclaw-workspace-state.json.migrated.")), archives);
        }
        assert.equal(fs.readFileSync(path.join(draftDir, record.draftFile), "utf8"), content);
        console.log("HISTORICAL_WORKSPACE_RESULT:" + JSON.stringify(result));
        `,
        { runtimeRoot, timeoutMs: 60_000 },
      );
      const result = JSON.parse(stdout.split("HISTORICAL_WORKSPACE_RESULT:").at(-1) ?? "null") as {
        completed: boolean;
        stepReceipts?: LegacyStateMigrationStepReceipt[];
      };
      expect(fs.readFileSync(configPath, "utf8")).toBe(configRaw);
      // Keep the full first-refusal receipt in the failure output: an unrelated
      // fixture/setup error is not evidence for the historical discovery bug.
      expect(
        result,
        JSON.stringify(
          result.stepReceipts?.find((receipt) => receipt.refusal?.code === "step-refused"),
        ),
      ).toMatchObject({ completed: true });
    },
    60_000,
  );
});
