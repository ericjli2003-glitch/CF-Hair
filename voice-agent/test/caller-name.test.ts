import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { CallerMemory, LocalCallerStore } from "../src/callers.js";
import { DateTime } from "luxon";
import { callContext } from "../src/agent/prompt.js";
import { testDeps } from "./helpers.js";

describe("a shared phone", () => {
  it("keeps the number's name when someone books under another name", async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "callers-"));
    const local = new LocalCallerStore(path.join(dir, "callers.json"));
    const puts: { phone: string; body: unknown }[] = [];
    const api = { putCaller: async (phone: string, body: unknown) => void puts.push({ phone, body }) } as any;
    const callers = new CallerMemory(api, local);
    await callers.saveName("+16045550101", "Amy");
    await callers.saveName("+16045550101", "David"); // her husband, booking for himself
    await callers.saveName("+16045550101", "amy");
    expect(local.get("+16045550101")?.name).toBe("amy");
    expect(puts.map((p) => (p.body as { name: string }).name)).toEqual(["Amy", "amy"]);
  });

  it("tells the agent the caller may not be the person on file", () => {
    const text = callContext({
      salon: testDeps().salon,
      now: DateTime.now(),
      callerPhone: "+16045550101",
      callerAnonymous: false,
      callerName: "Amy",
      callCount: 3,
      preferredLanguage: "en-US",
      currentLanguage: { code: "en-US", englishName: "English" } as any,
      greeting: "Hi, CF Hair Salon.",
      spokenAfterGreeting: null,
      transferAvailable: false,
    } as any);
    expect(text).toContain("someone else using the same phone");
  });
});
