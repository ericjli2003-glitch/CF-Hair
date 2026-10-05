"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useMemo, useState } from "react";
import { phonePretty } from "@/lib/admin-format";
import { ConsentChip, MSG_STATUS_STYLE, PROMO_LANGS, dateTime, shortDate } from "./ui";

export interface RecipientRow {
  id: string;
  customerId: string | null;
  name: string;
  phone: string;
  language: string;
  body: string;
  segments: number;
  consentType: string | null;
  status: string;
  skipReason: string | null;
  error: string | null;
  dryRun: boolean;
  isTest: boolean;
  sentAt: string | null;
  deliveredAt: string | null;
  booked: { id: string; service: string; start: string; priceCAD: number }[];
  optedOutAt: string | null;
  optOutText: string | null;
}

const SKIP: Record<string, string> = {
  no_consent: "No consent",
  withdrawn: "Opted out",
  implied_excluded: "Implied only",
  implied_expired: "Implied expired",
  frequency_cap: "Frequency cap",
  invalid_phone: "Invalid number",
  duplicate: "Duplicate",
  cancelled: "Cancelled",
};

const FILTERS = [
  { key: "all", label: "All" },
  { key: "sent", label: "Sent" },
  { key: "booked", label: "Booked" },
  { key: "optout", label: "Opted out" },
  { key: "failed", label: "Failed" },
  { key: "skipped", label: "Not sent" },
] as const;

export function CampaignActions({ id, status, canEdit }: { id: string; status: string; canEdit: boolean }) {
  const router = useRouter();
  const [busy, setBusy] = useState("");
  const [msg, setMsg] = useState("");
  async function post(path: string, label: string) {
    setBusy(label);
    setMsg("");
    const res = await fetch(path, { method: "POST", headers: { "Content-Type": "application/json" }, body: "{}" });
    const body = await res.json().catch(() => ({}));
    setBusy("");
    if (!res.ok) setMsg(body.message ?? body.error ?? "Failed");
    else if (body.adjustedForQuietHours) setMsg("Quiet hours: scheduled for 9:00 am.");
    router.refresh();
  }
  return (
    <div className="flex flex-wrap items-center gap-2">
      {canEdit && (
        <Link href={`/admin/promotions/${id}/edit`} className="inline-flex min-h-11 items-center justify-center rounded-md px-4 text-sm ring-1 ring-line hover:ring-primary">
          Edit
        </Link>
      )}
      {status === "scheduled" && (
        <button onClick={() => post(`/api/campaigns/${id}/send`, "send")} disabled={!!busy} className="btn-primary disabled:opacity-50">
          {busy === "send" ? "Sending..." : "Send now"}
        </button>
      )}
      {status === "sending" && (
        <button onClick={() => post(`/api/sms/queue`, "queue")} disabled={!!busy} className="btn-primary disabled:opacity-50">
          {busy === "queue" ? "Working..." : "Send next batch"}
        </button>
      )}
      {(status === "scheduled" || status === "sending") && (
        <button onClick={() => post(`/api/campaigns/${id}/cancel`, "cancel")} disabled={!!busy} className="inline-flex min-h-11 items-center justify-center rounded-md px-4 text-sm text-alert ring-1 ring-alert-line hover:bg-alert-wash disabled:opacity-50">
          {busy === "cancel" ? "Cancelling..." : status === "sending" ? "Stop sending" : "Cancel"}
        </button>
      )}
      {msg && <span className="text-sm text-ink-soft">{msg}</span>}
    </div>
  );
}

export function RecipientsTable({ rows, outbox }: { rows: RecipientRow[]; outbox: boolean }) {
  const router = useRouter();
  const [filter, setFilter] = useState<(typeof FILTERS)[number]["key"]>("all");
  const [open, setOpen] = useState<string | null>(null);
  const [reply, setReply] = useState("STOP");
  const [result, setResult] = useState<{ id: string; text: string } | null>(null);
  const [busy, setBusy] = useState(false);

  const list = useMemo(() => {
    const real = rows.filter((r) => !r.isTest);
    switch (filter) {
      case "sent":
        return real.filter((r) => r.status === "sent" || r.status === "delivered");
      case "booked":
        return real.filter((r) => r.booked.length > 0);
      case "optout":
        return real.filter((r) => r.optedOutAt);
      case "failed":
        return real.filter((r) => r.status === "failed");
      case "skipped":
        return real.filter((r) => r.status === "skipped");
      default:
        return real;
    }
  }, [rows, filter]);
  const tests = rows.filter((r) => r.isTest);

  async function simulate(r: RecipientRow) {
    setBusy(true);
    const res = await fetch("/api/sms/simulate", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ phone: r.phone, body: reply, channel: "promo" }),
    });
    const body = await res.json().catch(() => ({}));
    setBusy(false);
    const what =
      body.action === "stop"
        ? "Opted out and logged."
        : body.action === "start"
          ? "Re-subscribed and logged."
          : body.action === "help"
            ? "HELP answered."
            : body.action === "message"
              ? "Not a keyword: sent to the Messages inbox."
              : body.message ?? body.error ?? "Failed";
    setResult({ id: r.id, text: `${what}${body.reply ? ` Reply: "${body.reply}"` : ""}` });
    router.refresh();
  }

  return (
    <div>
      <div className="no-scrollbar flex gap-2 overflow-x-auto">
        {FILTERS.map((f) => (
          <button
            key={f.key}
            onClick={() => setFilter(f.key)}
            className={`shrink-0 inline-flex min-h-11 items-center justify-center rounded-md px-3.5 text-sm ring-1 ${filter === f.key ? "bg-primary text-paper ring-primary" : "bg-paper text-ink-soft ring-line"}`}
          >
            {f.label}
          </button>
        ))}
      </div>
      <div className="mt-4 overflow-x-auto rounded-xl bg-paper ring-1 ring-line">
        <table className="w-full min-w-[880px] text-left text-sm">
          <thead className="border-b border-line bg-tile text-sm text-ink-soft">
            <tr>
              <th className="px-5 py-3 font-medium">Client</th>
              <th className="px-3 py-3 font-medium">Version</th>
              <th className="px-3 py-3 font-medium">Consent</th>
              <th className="px-3 py-3 font-medium">Status</th>
              <th className="px-5 py-3 font-medium">Outcome (14 days)</th>
            </tr>
          </thead>
          <tbody>
            {list.map((r) => {
              const lang = PROMO_LANGS.find((l) => l.code === r.language);
              const sent = r.status === "sent" || r.status === "delivered";
              return (
                <tr key={r.id} className="border-b border-line/70 align-top last:border-0">
                  <td className="px-5 py-3.5">
                    {r.customerId ? (
                      <Link href={`/admin/customers/${r.customerId}`} className="font-medium hover:underline">
                        {r.name}
                      </Link>
                    ) : (
                      <p className="font-medium">{r.name}</p>
                    )}
                    <p className="whitespace-nowrap text-ink-soft">{phonePretty(r.phone)}</p>
                  </td>
                  <td className="px-3 py-3.5">
                    <span className="whitespace-nowrap rounded-md bg-tile px-2 py-0.5 text-xs text-ink-soft">{lang?.code === "en-US" ? "English" : lang?.script}</span>
                    <p className="mt-1 text-xs text-mute">{r.segments} seg</p>
                  </td>
                  <td className="px-3 py-3.5">{r.consentType && <ConsentChip status={r.consentType} />}</td>
                  <td className="px-3 py-3.5">
                    <span className={`whitespace-nowrap rounded-md px-2.5 py-0.5 text-xs ring-1 ${r.status === "skipped" ? "" : "capitalize"} ${MSG_STATUS_STYLE[r.status] ?? MSG_STATUS_STYLE.sent}`}>
                      {r.status === "skipped" ? SKIP[r.skipReason ?? ""] ?? "Skipped" : r.status === "sent" && r.dryRun ? "In outbox" : r.status}
                    </span>
                    {r.sentAt && <p className="mt-1 whitespace-nowrap text-xs text-mute">{dateTime(r.deliveredAt ?? r.sentAt)}</p>}
                    {r.error && <p className="mt-1 max-w-[14rem] text-xs text-alert">{r.error}</p>}
                  </td>
                  <td className="px-5 py-3.5">
                    {r.booked.map((b) => (
                      <p key={b.id} className="mb-1 inline-block rounded-md bg-primary-wash px-2.5 py-0.5 text-xs text-primary ring-1 ring-primary-line">
                        Booked {b.service} · {shortDate(b.start)} · ${b.priceCAD}
                      </p>
                    ))}
                    {r.optedOutAt && (
                      <p className="inline-block rounded-md bg-alert-wash px-2.5 py-0.5 text-xs text-alert ring-1 ring-alert-line">
                        Replied {r.optOutText ? `"${r.optOutText}"` : "STOP"} · {shortDate(r.optedOutAt)}
                      </p>
                    )}
                    {outbox && sent && !r.optedOutAt && (
                      <div className="mt-1">
                        {open === r.id ? (
                          <div className="flex flex-wrap items-center gap-1.5">
                            <select value={reply} onChange={(e) => setReply(e.target.value)} className="rounded-lg border border-line bg-paper px-2 py-1 text-xs">
                              {["STOP", "退订", "수신거부", "HELP", "Do you have parking?"].map((o) => (
                                <option key={o}>{o}</option>
                              ))}
                            </select>
                            <button disabled={busy} onClick={() => simulate(r)} className="rounded-lg bg-primary px-2.5 py-1 text-xs text-paper disabled:opacity-50">
                              {busy ? "..." : "Simulate reply"}
                            </button>
                            <button onClick={() => setOpen(null)} className="text-xs text-mute">
                              Close
                            </button>
                          </div>
                        ) : (
                          <button onClick={() => (setOpen(r.id), setResult(null))} className="text-xs text-mute underline-offset-2 hover:text-ink hover:underline">
                            Simulate a reply
                          </button>
                        )}
                        {result?.id === r.id && <p className="mt-1 max-w-xs text-xs text-ink-soft">{result.text}</p>}
                      </div>
                    )}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
        {list.length === 0 && <p className="p-8 text-center text-ink-soft">Nobody here.</p>}
      </div>
      {tests.length > 0 && (
        <p className="mt-3 text-xs text-mute">
          {tests.length} test send{tests.length === 1 ? "" : "s"} to {phonePretty(tests[0].phone)} (not counted).
        </p>
      )}
    </div>
  );
}
