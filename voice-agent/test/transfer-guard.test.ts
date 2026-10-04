import { describe, expect, it } from "vitest";
import { CallSession, type CallChannel } from "../src/agent/session.js";
import { transferBlockReason } from "../src/transfer-guard.js";
import { FakeLlm, testDeps } from "./helpers.js";

const MAIN = "+16044757705";

describe("transferBlockReason", () => {
  it("allows a transfer to a different line", () => {
    expect(transferBlockReason({ target: "+16045559999", mainNumber: MAIN })).toBeNull();
  });

  it("blocks a transfer to the salon's own forwarded line, whatever the number format", () => {
    expect(transferBlockReason({ target: "(604) 475-7705", mainNumber: MAIN })).toMatch(/loop/);
    expect(transferBlockReason({ target: "6044757705", mainNumber: "+1 604 475 7705" })).toMatch(/loop/);
  });

  it("blocks when the call was forwarded from the transfer number", () => {
    expect(transferBlockReason({ target: "+16045559999", mainNumber: MAIN, forwardedFrom: "+16045559999" })).toMatch(/forwarded/);
  });

  it("blocks a second transfer after one went unanswered", () => {
    expect(transferBlockReason({ target: "+16045559999", mainNumber: MAIN, alreadyTried: true })).toMatch(/already tried/);
  });

  it("reports a missing transfer number", () => {
    expect(transferBlockReason({ target: "", mainNumber: MAIN })).toMatch(/No transfer number/);
  });
});

/** Runs one transfer request and returns the tool result text the model saw, plus whether the call ended. */
async function attemptTransfer(opts: { forward: string; forwardedFrom?: string; resumeReason?: string }) {
  const llm = new FakeLlm([
    { tools: [{ name: "transfer_to_human", input: { reason: "wants a person", summary: "Wants to talk to the owner." } }] },
    { text: "I can take a message for the owner instead." },
  ]);
  const deps = testDeps({ forward: opts.forward, llm });
  let ended = false;
  const channel: CallChannel = { sendText: () => {}, setLanguage: () => {}, end: () => void (ended = true) };
  const session = new CallSession(
    deps,
    { callSid: "CAguard", from: "+16045550666", to: null, forwardedFrom: opts.forwardedFrom ?? null, resumeReason: opts.resumeReason ?? null },
    channel,
  );
  await session.handlePrompt("Can I talk to someone?");
  await new Promise((r) => setTimeout(r, 50));
  const last = llm.requests[1]?.messages.at(-1);
  const toolResult = JSON.stringify(last?.content ?? "");
  await session.close();
  return { toolResult, ended, salonPhone: deps.salon.phone };
}

describe("transfer loop guard in a call", () => {
  it("refuses to transfer to the salon's main number and the call carries on", async () => {
    const deps = testDeps();
    const { toolResult, ended } = await attemptTransfer({ forward: deps.salon.phone });
    expect(toolResult).toMatch(/loop/);
    expect(ended).toBe(false);
  });

  it("refuses when Twilio says the call was forwarded from the transfer number", async () => {
    const { toolResult, ended } = await attemptTransfer({ forward: "+16045559999", forwardedFrom: "+16045559999" });
    expect(toolResult).toMatch(/forwarded/);
    expect(ended).toBe(false);
  });

  it("does not try a second transfer after one went unanswered", async () => {
    const { toolResult, ended } = await attemptTransfer({ forward: "+16045559999", resumeReason: "transfer_failed" });
    expect(toolResult).toMatch(/already tried/);
    expect(ended).toBe(false);
  });
});
