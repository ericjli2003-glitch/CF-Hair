"use client";

import { useState } from "react";
import { useI18n } from "../LangProvider";

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
              <input id="c-phone" name="phone" required type="tel" autoComplete="tel" placeholder="(604) 555-0123" className="s-field" />
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
            <button type="submit" disabled={state === "sending"} className="s-btn w-full">
              {state === "sending" ? t.contact.sending : t.contact.send}
            </button>
          </div>
        </form>
      )}
    </section>
  );
}
