// Accessibility contracts for the booking flow, the contact form and the owner
// admin, checked on server-rendered markup: live regions, labels, valid list
// structure, badge text and touch target classes. Also the strings the fixes rely
// on, in all four languages.
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { createElement as h, type ComponentType, type ReactNode } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";

vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: () => {}, replace: () => {}, refresh: () => {}, prefetch: () => {} }),
  usePathname: () => "/admin/cards",
  useSearchParams: () => new URLSearchParams(),
}));

const { BookingFlow } = await import("@/components/booking/BookingFlow");
const { LangProvider } = await import("@/components/LangProvider");
const { ContactForm } = await import("@/components/site/ContactForm");
const { AdminNav, badgeText } = await import("@/components/admin/AdminNav");
const { LoginForm } = await import("@/components/admin/LoginForm");
const { dictionaries, LANGS } = await import("@/lib/i18n/dictionary");
type Lang = (typeof LANGS)[number];

const services = [
  { id: "mens-cut", name: "Men's Haircut", category: "Haircuts", durationMin: 30, priceCAD: 30, description: "Cut and style" },
  { id: "down-perm", name: "Down Perm", category: "Perm", durationMin: 45, priceCAD: 60, description: "Flat sides" },
];
const staff = [{ id: "stylist-a", name: "Stylist A", role: "Stylist", bio: "", serviceIds: ["mens-cut", "down-perm"] }];
const hours = { mon: { open: "10:00", close: "18:00" }, tue: null, wed: null, thu: null, fri: null, sat: null, sun: null };

function inLang(lang: Lang, node: ReactNode) {
  return renderToStaticMarkup(h(LangProvider, { lang, children: node }));
}
function flow(lang: Lang, start: { serviceId?: string; staffId?: string; step: 0 | 1 | 2 | 3 }) {
  return inLang(
    lang,
    h(BookingFlow as unknown as ComponentType<Record<string, unknown>>, {
      services,
      staff,
      categories: ["Haircuts", "Perm"],
      hours,
      today: "2030-01-07",
      start,
      cancellationHours: 24,
    }),
  );
}
const attrs = (html: string, tag: string) => [...html.matchAll(new RegExp(`<${tag}\\b[^>]*>`, "g"))].map((m) => m[0]);

describe("booking flow", () => {
  for (const lang of LANGS) {
    it(`announces time updates in one polite status line (${lang})`, () => {
      const html = flow(lang, { serviceId: "mens-cut", staffId: "stylist-a", step: 2 });
      expect(html.match(/role="status"/g)).toHaveLength(1);
      // The slot grid itself is not a live region (it would read every time aloud).
      expect(html).not.toMatch(/aria-live="polite"[^>]*aria-busy/);
      // Every date chip says which day it is and whether it is chosen.
      const chips = attrs(html, "button").filter((b) => b.includes("aria-pressed") && b.includes("aria-label"));
      expect(chips.length).toBeGreaterThan(20);
      for (const b of chips) expect(b).toMatch(/aria-label="[^"]{4,}"/);
    });
  }

  it("names every step button with its number and label, at 44px", () => {
    const html = flow("en", { serviceId: "mens-cut", step: 1 });
    const steps = attrs(html, "button").filter((b) => b.includes("Step "));
    expect(steps.map((b) => b.match(/aria-label="([^"]+)"/)?.[1])).toEqual([
      "Step 1 of 4: Service",
      "Step 2 of 4: Stylist",
      "Step 3 of 4: Time",
      "Step 4 of 4: Your details",
    ]);
    for (const b of steps) expect(b).toContain("min-h-11");
  });

  it("keeps the booking summary a valid definition list with 44px Change buttons", () => {
    const html = flow("en", { serviceId: "mens-cut", staffId: "stylist-a", step: 2 });
    const dl = html.match(/<dl\b[^>]*>([\s\S]*?)<\/dl>/)![1];
    // Each row: <div> holding only dt and dd children.
    const rows = dl.split(/<div class="grid/).slice(1);
    expect(rows).toHaveLength(3);
    for (const row of rows) {
      expect(row).toMatch(/^[^>]*><dt/);
      expect(row).not.toMatch(/<div[^>]*><dt/);
    }
    const change = attrs(dl, "button");
    expect(change.length).toBe(2);
    for (const b of change) expect(b).toMatch(/min-h-11 min-w-11/);
  });
});

describe("contact form", () => {
  it("labels every field", () => {
    for (const lang of LANGS) {
      const html = inLang(lang, h(ContactForm));
      const ids = [...html.matchAll(/<(?:input|textarea)\b[^>]*\bid="([^"]+)"/g)].map((m) => m[1]);
      expect(ids).toEqual(["c-name", "c-phone", "c-msg"]);
      for (const id of ids) expect(html).toContain(`for="${id}"`);
    }
  });
});

describe("owner admin", () => {
  it("writes out what each nav badge means", () => {
    expect(badgeText("/admin/messages", 3)).toBe("3 new");
    expect(badgeText("/admin/cards", 1)).toBe("1 waiting for approval");
    expect(badgeText("/admin/cards", 0)).toBeNull();
    expect(badgeText("/admin/calls", 5)).toBeNull();
  });

  it("wraps the tabs instead of scrolling them, so badges stay in view", () => {
    const html = renderToStaticMarkup(h(AdminNav, { newMessages: 4, cardsWaiting: 7 }));
    const nav = html.match(/<nav\b[\s\S]*?<\/nav>/)![0];
    expect(nav).toContain('aria-label="Owner"');
    expect(nav).toContain("flex-wrap");
    expect(nav).not.toContain("overflow-x-auto");
    expect(nav).toContain(", 4 new");
    expect(nav).toContain(", 7 waiting for approval");
    expect(nav).toMatch(/href="\/admin\/cards"[^>]*aria-current="page"|aria-current="page"[^>]*href="\/admin\/cards"/);
    for (const a of attrs(nav, "a")) expect(a).toContain("min-h-11");
    // The logo link has a name even where its text is hidden.
    expect(html).toMatch(/<a [^>]*href="\/admin"[^>]*>[\s\S]*?Owner[\s\S]*?<\/a>/);
  });

  it("labels the password field and offers show and hide", () => {
    const html = renderToStaticMarkup(h(LoginForm));
    expect(html).toContain('for="pw"');
    expect(html).toMatch(/<input[^>]*id="pw"[^>]*autoComplete="current-password"|<input[^>]*autocomplete="current-password"[^>]*id="pw"/i);
    expect(html).toMatch(/aria-pressed="false"[^>]*>Show/);
  });
});

describe("strings the fixes rely on", () => {
  it("exist in every language and fill their placeholders", () => {
    for (const lang of LANGS) {
      const t = dictionaries[lang];
      expect(t.book.loadingSlots.length).toBeGreaterThan(2);
      expect(t.book.slotsFound).toContain("{n}");
      expect(t.book.slotsFound).toContain("{date}");
      expect(t.common.loading.length).toBeGreaterThan(1);
    }
  });

  it("use no em dashes anywhere in the website source", () => {
    const files: string[] = [];
    const walk = (dir: string) => {
      for (const f of readdirSync(dir)) {
        const p = join(dir, f);
        if (statSync(p).isDirectory()) walk(p);
        else if (/\.(tsx?|css|json|mjs)$/.test(f)) files.push(p);
      }
    };
    walk(join(__dirname, "../src"));
    walk(join(__dirname, "../scripts"));
    const dash = String.fromCharCode(0x2014);
    expect(files.filter((f) => readFileSync(f, "utf8").includes(dash))).toEqual([]);
  });
});

describe("modal overlays (drawers and the phone menu)", async () => {
  const { inertOutside, wrapTarget } = await import("@/lib/use-modal");
  type N = { name: string; parentElement: N | null; children: N[]; inert?: boolean };
  const node = (name: string, kids: N[] = []): N => {
    const n: N = { name, parentElement: null, children: kids };
    for (const k of kids) k.parentElement = n;
    return n;
  };

  it("makes everything outside the overlay inert, and undoes only its own changes", () => {
    // body > [header, main > [toolbar, drawer > [panel]], portal(already inert)]
    const panel = node("panel");
    const drawer = node("drawer", [panel]);
    const toolbar = node("toolbar");
    const main = node("main", [toolbar, drawer]);
    const header = node("header");
    const portal = node("portal");
    portal.inert = true;
    const body = node("body", [header, main, portal]);
    const undo = inertOutside(drawer, body);
    expect([header.inert, toolbar.inert, portal.inert]).toEqual([true, true, true]);
    expect([main.inert, drawer.inert, panel.inert, body.inert]).toEqual([undefined, undefined, undefined, undefined]);
    undo();
    expect([header.inert, toolbar.inert, portal.inert]).toEqual([false, false, true]);
  });

  it("wraps Tab from last to first and Shift+Tab from first to last", () => {
    const items = ["close", "call", "status", "history"];
    expect(wrapTarget(items, "history", false)).toBe("close");
    expect(wrapTarget(items, "close", true)).toBe("history");
    expect(wrapTarget(items, "call", false)).toBeNull();
    expect(wrapTarget(items, "call", true)).toBeNull();
    // Focus somehow outside: pull it back in.
    expect(wrapTarget(items, "page-link", false)).toBe("close");
    expect(wrapTarget(items, null, true)).toBe("history");
    expect(wrapTarget([], "x", false)).toBeNull();
  });
});
