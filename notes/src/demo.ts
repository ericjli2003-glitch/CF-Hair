/**
 * End-to-end demo on the sample CSV:
 *   plan -> generate -> proof -> (demo auto-approval) -> send --dry-run (Handwrytten)
 *   -> send --send (plotter SVGs) -> send again to show idempotency
 *   -> (optional) push to the website admin and dry-run send --from-admin, when
 *      BOOKING_API_URL answers; skipped cleanly otherwise.
 * Uses real Claude when ANTHROPIC_API_KEY is set, otherwise labelled mock templates.
 * Everything is written under out/demo-<date>/ with its own history file, so the
 * demo never touches the real sent-history ledger.
 */
import { existsSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import path from "node:path";
import { NOTES_ROOT, OUT_DIR } from "./config.js";
import { generate, plan, printPlan, proof, sendApproved } from "./run.js";
import { CardsApi, pushRun, sendFromAdmin, websiteReachable } from "./admin.js";
import type { ApprovedFile, RunManifest } from "./types.js";

const TODAY = process.env.NOTES_TODAY ?? "2026-10-09"; // Friday's sales meeting; the sample CSV is anchored to it
const CSV = path.join(NOTES_ROOT, "sample", "clients.csv");
const STAFF = path.join(NOTES_ROOT, "sample", "staff.sample.json");
const CAMPAIGNS = (process.env.DEMO_CAMPAIGNS ?? "win-back,first-visit-thanks,birthday").split(",");

function rule(title: string) {
  console.log(`\n${"=".repeat(78)}\n${title}\n${"=".repeat(78)}`);
}

async function main() {
  const live = !!process.env.ANTHROPIC_API_KEY;
  const historyFile = path.join(OUT_DIR, `demo-${TODAY}`, "history.json");
  if (existsSync(historyFile)) rmSync(historyFile);
  mkdirSync(path.dirname(historyFile), { recursive: true });
  console.log(`CF Hair handwritten notes demo. Pretending today is ${TODAY} (America/Vancouver).`);
  console.log(live ? "ANTHROPIC_API_KEY found: Claude writes every note." : "ANTHROPIC_API_KEY not set: notes use deterministic MOCK templates, labelled as mock everywhere.");

  const proofs: string[] = [];
  let firstApproved: string | undefined;
  let firstRun: { run: RunManifest; dir: string } | undefined;
  for (const campaign of CAMPAIGNS) {
    const common = { campaign, csv: CSV, staffFile: STAFF, today: TODAY, historyFile };
    rule(`1. plan --campaign ${campaign}`);
    printPlan(await plan(common));

    rule(`2. generate --campaign ${campaign}`);
    const { run, dir } = await generate(common);

    rule(`3. proof --run ${run.runId}`);
    proofs.push(await proof(dir));

    // In real use the owner clicks Approve/Skip and "Export approved list" on the proof sheet.
    const approved: ApprovedFile = {
      runId: run.runId,
      campaignId: run.campaignId,
      exportedAt: new Date().toISOString(),
      approvedBy: "demo auto-approval (every note that passed all checks)",
      approved: run.notes
        .filter((n) => n.status === "ok")
        .map((n) => ({ noteId: n.noteId, idempotencyKey: n.idempotencyKey, message: n.message, messageAlt: n.messageAlt, signature: n.signature })),
    };
    const approvedFile = path.join(dir, `approved-${run.runId}.json`);
    writeFileSync(approvedFile, JSON.stringify(approved, null, 2) + "\n");
    console.log(`Demo approval file: ${path.relative(process.cwd(), approvedFile)} (${approved.approved.length} of ${run.notes.length} cards)`);
    firstApproved ??= approvedFile;
    firstRun ??= { run, dir };
  }

  if (firstApproved) {
    rule("4. send --dry-run (Handwrytten payloads, nothing leaves this computer)");
    await sendApproved({ approvedFile: firstApproved, provider: "handwrytten", send: false, historyFile, today: TODAY });

    rule("5. send --send --provider plotter (writes single-stroke AxiDraw SVGs, records history)");
    await sendApproved({ approvedFile: firstApproved, provider: "plotter", send: true, historyFile, today: TODAY });

    rule("6. send --send again: idempotency means nobody is mailed twice");
    await sendApproved({ approvedFile: firstApproved, provider: "plotter", send: true, historyFile, today: TODAY });
  }

  // Optional: the website's approval queue. Only runs when a website answers at BOOKING_API_URL.
  rule("7. push to the website admin (optional)");
  const site = process.env.BOOKING_API_URL;
  if (!site || !process.env.AGENT_API_KEY) {
    console.log("Skipped: set BOOKING_API_URL and AGENT_API_KEY (and start the website) to push this batch to the admin Cards tab.");
  } else if (!(await websiteReachable(site))) {
    console.log(`Skipped: no website answering at ${site}. Start it (cd website && npm run dev) and run the demo again.`);
  } else if (firstRun) {
    try {
      const api = CardsApi.fromEnv();
      const { batchId } = await pushRun(firstRun.run, firstRun.dir, api);
      rule("8. send --from-admin --dry-run (whatever the owner has approved so far)");
      await sendFromAdmin({ api, batchId, provider: "handwrytten", send: false, historyFile, today: TODAY });
      console.log(`Approve cards at ${api.adminUrl(batchId)}, then: npm run notes -- send --from-admin --batch ${batchId}`);
    } catch (err) {
      // The website may not have the Cards API yet; the offline flow above already worked.
      console.log(`Skipped: the website answered but the card queue did not (${(err as Error).message}).`);
    }
  }

  rule("Done");
  for (const p of proofs) console.log(`Proof sheet: ${path.relative(process.cwd(), p)}`);
  console.log(`Plotter SVGs: ${path.relative(process.cwd(), path.join(OUT_DIR, "plotter"))}/`);
  console.log(`Demo history ledger: ${path.relative(process.cwd(), historyFile)}`);
}

main().catch((err) => {
  console.error(`demo failed: ${(err as Error).stack ?? err}`);
  process.exit(1);
});
