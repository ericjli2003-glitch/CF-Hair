"use client";

import { useState } from "react";
import { useI18n } from "../LangProvider";

export function ContactForm() {
  const { t } = useI18n();
  const [state, setState] = useState<"idle" | "sending" | "sent" | "error">("idle");
  const [err, setErr] = useState("");
  const [phoneErr, setPhoneErr] = useState(false);

  async function onSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const fd = new FormData(e.currentTarget);
    setState("sending");
    setErr("");
    setPhoneErr(false);
    const res = await fetch("/api/contact", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(Object.fromEntries(fd)),
    }).catch(() => null);
    if (res?.ok) return setState("sent");
    const body = await res?.json().catch(() => null);
    if (body?.error === "INVALID_PHONE") {
      // Next to the field it is about, and focus goes there.
      setPhoneErr(true);
      document.getElementById("c-phone")?.focus();
    } else setErr(t.contact.error);
    setState("error");
  }

  return (
    <section aria-labelledby="ask" className="rounded-xl bg-white p-5 sm:p-7">
      <h2 id="ask" className="display text-[1.75rem]">
        {t.contact.formTitle}
      </h2>
      {state === "sent" ? (
        <p role="status" className="mt-4 text-[1.1rem] leading-snug">
          {t.contact.sent}
        </p>
      ) : (
        <form onSubmit={onSubmit}>
          <p className="mt-1.5 text-slate">{t.contact.formLead}</p>
          <div className="mt-6 space-y-5">
            <div>
              <label className="s-label" htmlFor="c-name">{t.contact.name}</label>
              <input id="c-name" name="name" required autoComplete="name" className="s-field" />
            </div>
            <div>
              <label className="s-label" htmlFor="c-phone">{t.contact.phoneField}</label>
              <input
                id="c-phone"
                name="phone"
                required
                type="tel"
                autoComplete="tel"
                placeholder="(604) 555-0123"
                className="s-field"
                aria-invalid={phoneErr || undefined}
                aria-describedby={phoneErr ? "c-phone-err" : undefined}
                onChange={() => phoneErr && setPhoneErr(false)}
              />
              {phoneErr && (
                <p id="c-phone-err" className="mt-1.5 text-[0.92rem] font-medium text-alert">
                  {t.book.errPhone}
                </p>
              )}
            </div>
            <div>
              <label className="s-label" htmlFor="c-msg">{t.contact.message}</label>
              <textarea id="c-msg" name="message" required rows={4} className="s-field resize-y" />
            </div>
            <input type="text" name="website" tabIndex={-1} autoComplete="off" className="hidden" aria-hidden="true" />
            {err && (
              <p role="alert" className="text-alert">
                {err}
              </p>
            )}
            <button type="submit" disabled={state === "sending"} aria-busy={state === "sending" || undefined} className="s-btn w-full">
              {state === "sending" ? t.contact.sending : t.contact.send}
            </button>
          </div>
        </form>
      )}
    </section>
  );
}
