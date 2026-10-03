#!/usr/bin/env node
/**
 * CF Hair handwritten notes CLI.
 *
 *   npm run notes -- campaigns
 *   npm run notes -- plan     --campaign win-back [--csv sample/clients.csv] [--today 2026-10-09]
 *   npm run notes -- generate --campaign win-back [--csv ...] [--mock]
 *   npm run notes -- proof    --run win-back-2026-10-09
 *   npm run notes -- send     --approved approved-win-back-2026-10-09.json [--dry-run | --send [--test-mode]] [--provider plotter]
 *   npm run notes -- catalog  (Handwrytten card and font ids)
 */
import { parseArgs } from "node:util";
import { listCampaigns } from "./campaigns.js";
import { loadSettings } from "./config.js";
import { salonToday } from "./dates.js";
import { HandwryttenAdapter } from "./providers/handwrytten.js";
import { generate, plan, printPlan, proof, sendApproved } from "./run.js";

const HELP = `CF Hair handwritten notes

Commands
  campaigns                         List campaigns and their audience rules
  plan      --campaign <id>         Show who would get a card, who is excluded and why, and the cost
  generate  --campaign <id>         Write every note (Claude, or labelled mock templates without ANTHROPIC_API_KEY)
  proof     --run <runId|dir>       Build the HTML proof sheet for review and approval
  send      --approved <file>       Dry run by default. Add --send to mail. --test-mode uses the provider's test mode
  catalog                           List Handwrytten card and font ids (needs HANDWRYTTEN_API_KEY)

Data options (plan, generate)
  --csv <file>        Client CSV (see sample/clients.csv). Without it, BOOKING_API_URL + AGENT_API_KEY are used
  --staff <file>      Stylist name overrides, e.g. sample/staff.sample.json
  --today <date>      Pretend today is YYYY-MM-DD (salon time). Default: today in America/Vancouver

Other options
  --provider <name>   handwrytten (default) or plotter
  --mock              Use template copy even if ANTHROPIC_API_KEY is set
  --history <file>    Sent-history ledger (default data/history.json)
`;

async function main(argv: string[]): Promise<number> {
  const [cmd, ...rest] = argv;
  const { values } = parseArgs({
    args: rest,
    options: {
      campaign: { type: "string", short: "c" },
      csv: { type: "string" },
      staff: { type: "string" },
      today: { type: "string" },
      provider: { type: "string" },
      run: { type: "string" },
      approved: { type: "string" },
      send: { type: "boolean", default: false },
      "dry-run": { type: "boolean", default: false },
      "test-mode": { type: "boolean", default: false },
      mock: { type: "boolean", default: false },
      history: { type: "string" },
      help: { type: "boolean", short: "h" },
    },
    allowPositionals: true,
  });

  if (!cmd || values.help || cmd === "help") {
    console.log(HELP);
    return 0;
  }
  const today = salonToday(values.today);
  const common = {
    csv: values.csv,
    staffFile: values.staff,
    today,
    provider: values.provider,
    historyFile: values.history,
  };
  const needCampaign = () => {
    if (!values.campaign) throw new Error(`--campaign is required. Try: ${listCampaigns().map((c) => c.id).join(", ")}`);
    return values.campaign;
  };

  switch (cmd) {
    case "campaigns": {
      for (const c of listCampaigns()) {
        console.log(`${c.id.padEnd(20)} ${c.name}\n${" ".repeat(21)}${JSON.stringify(c.audience)}\n${" ".repeat(21)}max ${c.maxChars} chars, design ${c.design}, dedupe ${c.dedupe}${c.offer ? `, offer ${c.offer.code}` : ""}\n`);
      }
      return 0;
    }
    case "plan": {
      printPlan(await plan({ ...common, campaign: needCampaign() }));
      return 0;
    }
    case "generate": {
      const { run } = await generate({ ...common, campaign: needCampaign(), mock: values.mock });
      console.log(`Next: npm run notes -- proof --run ${run.runId}`);
      return 0;
    }
    case "proof": {
      const id = values.run ?? (values.campaign ? `${values.campaign}-${today}` : undefined);
      if (!id) throw new Error("--run <runId or directory> is required (e.g. win-back-2026-10-09)");
      await proof(id, { provider: values.provider });
      return 0;
    }
    case "send": {
      if (!values.approved) throw new Error("--approved <file> is required. Export it from the proof sheet; nothing is ever sent without one.");
      if (values.send && values["dry-run"]) throw new Error("Choose either --dry-run or --send, not both.");
      const summary = await sendApproved({
        approvedFile: values.approved,
        provider: values.provider ?? loadSettings().defaultProvider,
        send: values.send,
        testMode: values["test-mode"],
        historyFile: values.history,
        today,
      });
      return summary.failed.length ? 1 : 0;
    }
    case "catalog": {
      const { cards, fonts } = await new HandwryttenAdapter().catalog();
      console.log(JSON.stringify({ cards, fonts }, null, 2));
      return 0;
    }
    default:
      console.error(`Unknown command "${cmd}".\n\n${HELP}`);
      return 2;
  }
}

main(process.argv.slice(2)).then(
  (code) => process.exit(code),
  (err) => {
    console.error(`error: ${(err as Error).message}`);
    process.exit(1);
  },
);
