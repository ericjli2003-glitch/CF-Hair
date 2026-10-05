"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { phonePretty } from "@/lib/admin-format";

export function PromoSettings(props: {
  capMax: number;
  capDays: number;
  ownerPhone: string | null;
  promoSender: boolean;
  txnSender: boolean;
  promoMode: "live" | "outbox" | "blocked";
  txnMode: "live" | "outbox";
}) {
  const router = useRouter();
  const [capMax, setCapMax] = useState(String(props.capMax));
  const [capDays, setCapDays] = useState(String(props.capDays));
  const [phone, setPhone] = useState(props.ownerPhone ? phonePretty(props.ownerPhone) : "");
  const [state, setState] = useState<"idle" | "saving" | "saved" | "error">("idle");
  const [error, setError] = useState("");

  async function save(e: React.FormEvent) {
    e.preventDefault();
    setState("saving");
    const res = await fetch("/api/sms/settings", {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ capMax: Number(capMax), capDays: Number(capDays), ownerPhone: phone.trim() || null }),
    });
    const body = await res.json().catch(() => ({}));
    if (!res.ok) {
      setState("error");
      setError(body.error === "INVALID_PHONE" ? "Check the phone number." : "Check the numbers.");
      return;
    }
    setState("saved");
    router.refresh();
  }

  const sender = (label: string, on: boolean, mode: string) => (
    <div className="flex items-center justify-between gap-3 py-2">
      <span>{label}</span>
      <span
        className={`rounded-md px-2.5 py-0.5 text-xs ring-1 ${
          mode === "live" ? "bg-primary-wash text-primary ring-primary-line" : mode === "blocked" ? "bg-alert-wash text-alert ring-alert-line" : "bg-tile text-slate ring-rule"
        }`}
      >
        {mode === "live" ? "Twilio, live" : mode === "blocked" ? "Not set up" : on ? "Dry run" : "Outbox"}
      </span>
    </div>
  );

  return (
    <form onSubmit={save} className="rounded-xl bg-paper p-5 ring-1 ring-line">
      <p className="font-medium">Sending settings</p>
      <div className="mt-2 divide-y divide-line/70 text-sm text-ink-soft">
        {sender("Promotions number", props.promoSender, props.promoMode)}
        {sender("Appointment number", props.txnSender, props.txnMode)}
      </div>

      <p className="label mt-4">Frequency cap</p>
      <div className="flex items-center gap-2 text-sm text-ink-soft">
        <span>At most</span>
        <input aria-label="Texts" type="number" min={1} max={30} value={capMax} onChange={(e) => setCapMax(e.target.value)} className="field !w-16 !px-2 !py-2 text-center" />
        <span>promotions per</span>
        <input aria-label="Days" type="number" min={1} max={365} value={capDays} onChange={(e) => setCapDays(e.target.value)} className="field !w-16 !px-2 !py-2 text-center" />
        <span>days</span>
      </div>

      <p className="label mt-4">Quiet hours</p>
      <p className="text-sm text-ink-soft">Promotions only go out 9:00 am to 8:00 pm, Vancouver time. Anything later waits for 9:00 am.</p>

      <label className="label mt-4" htmlFor="owner-phone">Owner&apos;s phone for test sends</label>
      <input id="owner-phone" type="tel" value={phone} onChange={(e) => setPhone(e.target.value)} placeholder="604 555 0123" className="field !py-2.5" />

      <div className="mt-4 flex items-center gap-3">
        <button disabled={state === "saving"} className="inline-flex min-h-11 items-center justify-center rounded-md bg-primary px-4 text-sm text-paper hover:bg-primary-hover disabled:opacity-50">
          {state === "saving" ? "Saving..." : "Save"}
        </button>
        {state === "saved" && <span className="text-sm text-primary">Saved</span>}
        {state === "error" && <span className="text-sm text-alert">{error}</span>}
      </div>
    </form>
  );
}
