"use client";

import { useState } from "react";
import { useI18n } from "../LangProvider";
import { Sparkle } from "../art/Monogram";

export function ContactForm() {
  const { t } = useI18n();
  const [state, setState] = useState<"idle" | "sending" | "sent" | "error">("idle");
  const [err, setErr] = useState("");

  async function onSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const fd = new FormData(e.currentTarget);
    setState("sending");
    setErr("");
    const res = await fetch("/api/contact", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(Object.fromEntries(fd)),
    }).catch(() => null);
    if (res?.ok) return setState("sent");
    const body = await res?.json().catch(() => null);
    setErr(body?.error === "INVALID_PHONE" ? t.book.errPhone : t.contact.error);
    setState("error");
  }

  if (state === "sent") {
    return (
      <div className="grid min-h-[420px] place-items-center rounded-[28px] bg-espresso p-10 text-center text-paper">
        <div>
          <Sparkle className="mx-auto h-6 w-6 text-champagne" />
          <p className="display mt-6 text-[2.2rem] leading-tight">{t.contact.sent}</p>
        </div>
      </div>
    );
  }

  return (
    <form onSubmit={onSubmit} className="rounded-[28px] bg-paper p-7 ring-1 ring-line sm:p-9">
      <h2 className="display text-[2.2rem]">{t.contact.formTitle}</h2>
      <p className="mt-2 text-sm text-ink-soft">{t.contact.formLead}</p>
      <div className="mt-7 space-y-5">
        <div>
          <label className="label" htmlFor="c-name">{t.contact.name}</label>
          <input id="c-name" name="name" required autoComplete="name" className="field" />
        </div>
        <div>
          <label className="label" htmlFor="c-phone">{t.contact.phone}</label>
          <input id="c-phone" name="phone" required type="tel" autoComplete="tel" placeholder="(604) 555-0123" className="field" />
        </div>
        <div>
          <label className="label" htmlFor="c-msg">{t.contact.message}</label>
          <textarea id="c-msg" name="message" required rows={4} className="field resize-none" />
        </div>
        <input type="text" name="website" tabIndex={-1} autoComplete="off" className="hidden" aria-hidden="true" />
        {err && <p className="text-sm text-clay">{err}</p>}
        <button type="submit" disabled={state === "sending"} className="btn-primary w-full !py-4 disabled:opacity-60">
          {state === "sending" ? "..." : t.contact.send}
        </button>
      </div>
    </form>
  );
}
