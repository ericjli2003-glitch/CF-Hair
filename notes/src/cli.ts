#!/usr/bin/env node
/**
 * CF Hair handwritten notes CLI.
 *
 *   npm run notes -- campaigns
 *   npm run notes -- plan     --campaign win-back [--csv sample/clients.csv] [--today 2026-10-09]
 *   npm run notes -- generate --campaign win-back [--csv ...] [--mock]
 *   npm run notes -- proof    --run win-back-2026-10-09
 *   npm run notes -- send     --approved approved-win-back-2026-10-09.json [--dry-run | --send [--test-mode]] [--provider plotter]
 *   npm run notes -- push     --run win-back-2026-10-09          (upload for review in the website admin)
 *   npm run notes -- send     --from-admin [--batch <id>] [--dry-run | --send]
 *   npm run notes -- catalog  (Handwrytten card and font ids)
 */
import { parseArgs } from "node:util";
import { listCampaigns } from "./campaigns.js";
import { loadSettings } from "./config.js";
import { salonToday } from "./dates.js";
import { HandwryttenAdapter } from "./providers/handwrytten.js";
import { CardsApi, pushRun, sendFromAdmin } from "./admin.js";
import { generate, loadRun, plan, printPlan, proof, sendApproved } from "./run.js";

const HELP = `CF Hair handwritten notes

Commands
  campaigns                         List campaigns and their audience rules
  plan      --campaign <id>         Show who would get a card, who is excluded and why, and the cost
  generate  --campaign <id>         Write every note (Claude, or labelled mock templates without ANTHROPIC_API_KEY)
                                    Add --push to upload the batch to the website admin for approval
  proof     --run <runId|dir>       Build the offline HTML proof sheet for review and approval
  push      --run <runId|dir>       Upload a generated batch to the website admin (Cards tab) for approval
  send      --from-admin            Send what the owner approved in the website admin (optionally --batch <id>)
  send      --approved <file>       Send an approved list exported from the offline proof sheet
            Both: dry run by default. Add --send to mail. --test-mode uses the provider's test mode
  catalog                           List Handwrytten card and font ids (needs HANDWRYTTEN_API_KEY)

Data options (plan, generate)
  --csv <file>        Client CSV (see sample/clients.csv). Without it, BOOKING_API_URL + AGENT_API_KEY are used
  --staff <file>      Stylist name overrides, e.g. sample/staff.sample.json
  --today <date>      Pretend today is YYYY-MM-DD (salon time). Default: today in America/Vancouver

Other options
  --provider <name>   handwrytten (default) or plotter
  --mock              Use template copy even if ANTHROPIC_API_KEY is set
  --history <file>    Sent-history ledger (default data/history.json)
  --api-url <url>     Website base URL (default BOOKING_API_URL); the agent key comes from AGENT_API_KEY
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
      push: { type: "boolean", default: false },
      "from-admin": { type: "boolean", default: false },
      batch: { type: "string" },
      "api-url": { type: "string" },
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
      const { run, dir } = await generate({ ...common, campaign: needCampaign(), mock: values.mock });
      if (values.push) {
        await pushRun(run, dir, CardsApi.fromEnv({ baseUrl: values["api-url"] }));
        console.log(`Then: npm run notes -- send --from-admin --batch <id>   (dry run; add --send to mail)`);
      } else {
        console.log(`Next: npm run notes -- proof --run ${run.runId}   or   npm run notes -- push --run ${run.runId}`);
      }
      return 0;
    }
    case "proof": {
      const id = values.run ?? (values.campaign ? `${values.campaign}-${today}` : undefined);
      if (!id) throw new Error("--run <runId or directory> is required (e.g. win-back-2026-10-09)");
      await proof(id, { provider: values.provider });
      return 0;
    }
    case "push": {
      const id = values.run ?? (values.campaign ? `${values.campaign}-${today}` : undefined);
      if (!id) throw new Error("--run <runId or directory> is required (e.g. win-back-2026-10-09)");
      const { run, dir } = loadRun(id);
      await pushRun(run, dir, CardsApi.fromEnv({ baseUrl: values["api-url"] }));
      return 0;
    }
    case "send": {
      if (values.send && values["dry-run"]) throw new Error("Choose either --dry-run or --send, not both.");
      if (values["from-admin"]) {
        if (values.approved) throw new Error("Use either --from-admin or --approved <file>, not both.");
        const summary = await sendFromAdmin({
          api: CardsApi.fromEnv({ baseUrl: values["api-url"] }),
          batchId: values.batch,
          provider: values.provider ?? loadSettings().defaultProvider,
          send: values.send,
          testMode: values["test-mode"],
          historyFile: values.history,
          today,
        });
        return summary.failed.length ? 1 : 0;
      }
      if (!values.approved) {
        throw new Error("Nothing is ever sent without an approval. Use --from-admin (approved in the website admin) or --approved <file> (exported from the offline proof sheet).");
      }
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
