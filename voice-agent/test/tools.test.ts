import { describe, expect, it } from "vitest";
import { TOOL_DEFINITIONS, ToolExecutor, ToolInputSchemas, validateToolInput, type ToolHooks } from "../src/agent/tools.js";
import { FIXED_NOW, testDeps } from "./helpers.js";
import type { LanguageCode } from "../src/languages.js";

describe("tool argument validation", () => {
  it("every tool definition has a matching validator, in a stable order", () => {
    expect(TOOL_DEFINITIONS.map((t) => t.name)).toEqual(Object.keys(ToolInputSchemas));
    for (const t of TOOL_DEFINITIONS) expect(t.eager_input_streaming).toBe(true);
  });

  it("accepts a valid booking", () => {
    const r = validateToolInput("book_appointment", {
      service_id: "mens-cut",
      start: "2026-10-08T14:30:00-07:00",
      staff_id: "stylist-b",
      customer_name: "Alex Chen",
      confirmed_with_caller: true,
    });
    expect(r.ok).toBe(true);
  });

  it("refuses to book without caller confirmation", () => {
    const r = validateToolInput("book_appointment", {
      service_id: "mens-cut",
      start: "2026-10-08T14:30:00-07:00",
      customer_name: "Alex",
      confirmed_with_caller: false,
    });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error).toMatch(/confirmed_with_caller/);
  });

  it("rejects malformed dates, missing fields, unknown fields and bad enums", () => {
    expect(validateToolInput("check_availability", { service_id: "mens-cut", date: "tomorrow" }).ok).toBe(false);
    expect(validateToolInput("check_availability", { date: "2026-10-08" }).ok).toBe(false);
    expect(validateToolInput("check_availability", { service_id: "x", date: "2026-10-08", foo: 1 }).ok).toBe(false);
    expect(validateToolInput("book_appointment", { service_id: "mens-cut", start: "2:30pm", customer_name: "A", confirmed_with_caller: true }).ok).toBe(false);
    expect(validateToolInput("take_message", { caller_name: "A", message: "hi", urgency: "urgent", reason: "callback" }).ok).toBe(false);
    expect(validateToolInput("set_language", { language: "fr-FR" }).ok).toBe(false);
    expect(validateToolInput("set_language", { language: "zh-HK" }).ok).toBe(true);
    expect(validateToolInput("end_call", {}).ok).toBe(false);
  });

  it("names unknown tools and tolerates letter-case slips", () => {
    const bad = validateToolInput("make_coffee", {});
    expect(bad.ok).toBe(false);
    const caseSlip = validateToolInput("Get_Services", {});
    expect(caseSlip.ok && caseSlip.name).toBe("get_services");
  });
});

function hooks(over: Partial<ToolHooks> = {}): ToolHooks & { outcomes: string[] } {
  const outcomes: string[] = [];
  let lang: LanguageCode = "en-US";
  return {
    callSid: "CAtest",
    callerPhone: "+16045550123",
    currentLanguage: () => lang,
    switchLanguage: async (c) => {
      lang = c;
      return { saved: "api" };
    },
    requestEnd: () => {},
    requestTransfer: () => ({ ok: false, why: "closed" }),
    recordOutcome: (o) => void outcomes.push(o),
    rememberName: () => {},
    sendMessage: async () => "sent",
    now: () => FIXED_NOW,
    outcomes,
    ...over,
  };
}

describe("tool execution against the mock API", () => {
  it("returns errors to the model instead of throwing", async () => {
    const deps = testDeps();
    const ex = new ToolExecutor(deps.api, deps.salon, hooks());
    const r = await ex.run("check_availability", { service_id: "mens-cut", date: "2026-10-01" });
    expect(r.isError).toBe(true);
    expect(r.content).toMatch(/past/);
    const r2 = await ex.run("check_availability", { service_id: "balayage", date: "2026-10-08", staff_id: "stylist-c" });
    expect(r2.isError).toBe(true);
    expect(r2.content).toMatch(/does not do/);
  });

  it("needs a callback number when caller ID is withheld", async () => {
    const deps = testDeps();
    const ex = new ToolExecutor(deps.api, deps.salon, hooks({ callerPhone: null }));
    const r = await ex.run("book_appointment", {
      service_id: "mens-cut",
      start: "2026-10-08T14:30:00-07:00",
      customer_name: "Sam",
      confirmed_with_caller: true,
    });
    expect(r.isError).toBe(true);
    expect(r.content).toMatch(/phone number/);
  });

  it("falls back to salon.json for prices and says booking is offline when the API is down", async () => {
    const deps = testDeps();
    deps.mockApi!.offline = true;
    const ex = new ToolExecutor(deps.api, deps.salon, hooks());
    const services = JSON.parse((await ex.run("get_services", {})).content);
    expect(services.source).toMatch(/salon.json/);
    expect(services.services.find((s: { id: string }) => s.id === "mens-cut").priceCAD).toBe(30);
    const avail = await ex.run("check_availability", { service_id: "mens-cut", date: "2026-10-08" });
    expect(avail.isError).toBe(true);
    expect(avail.content).toMatch(/BOOKING_SYSTEM_UNAVAILABLE/);
    expect(avail.content).toMatch(/take_message/);
  });
});
