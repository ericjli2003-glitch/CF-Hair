"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";

const SCRIPTS: Record<string, string> = {
  "en-US": "Can CF Hair Salon text you occasional specials and offers? You can reply STOP any time to opt out.",
  "zh-CN": "CF Hair Salon可以偶尔给您发送优惠短信吗？您随时可以回复STOP退订。",
  "zh-HK": "CF Hair Salon可唔可以間中短訊通知你優惠？你隨時可以回覆STOP取消。",
  "ko-KR": "CF Hair Salon이 가끔 할인 소식을 문자로 보내드려도 될까요? 언제든지 STOP으로 회신하면 수신이 중단됩니다.",
};

const HOW = [
  { key: "front desk", label: "In person at the front desk" },
  { key: "phone call", label: "On a phone call with staff" },
  { key: "paper form", label: "Signed a paper form" },
];

export function ConsentForm({ phone, status, language }: { phone: string; status: string; language: string }) {
  const router = useRouter();
  const [mode, setMode] = useState<"yes" | "no" | null>(null);
  const [how, setHow] = useState(HOW[0].key);
  const [lang, setLang] = useState(SCRIPTS[language] ? language : "en-US");
  const [wording, setWording] = useState(SCRIPTS[SCRIPTS[language] ? language : "en-US"]);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");

  async function submit(kind: "express" | "withdrawn") {
    setBusy(true);
    setErr("");
    const res = await fetch("/api/customers/consent", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        phone,
        status: kind,
        source: "admin",
        wording: kind === "express" ? wording : `Owner recorded an opt-out (${how}).`,
        language: lang,
        detail: { method: how },
      }),
    });
    const body = await res.json().catch(() => ({}));
    setBusy(false);
    if (!res.ok) return setErr(body.message ?? body.error ?? "Could not save");
    setMode(null);
    router.refresh();
  }

  if (!mode) {
    return (
      <div className="flex flex-wrap gap-2">
        {status !== "express" && (
          <button onClick={() => setMode("yes")} className="rounded-full bg-ink px-4 py-2.5 text-sm text-paper hover:bg-clay">
            Record a yes
          </button>
        )}
        {status !== "withdrawn" && (
          <button onClick={() => setMode("no")} className="rounded-full px-4 py-2.5 text-sm text-rose-700 ring-1 ring-rose-200 hover:bg-rose-50">
            Record an opt-out
          </button>
        )}
      </div>
    );
  }

  return (
    <div className="rounded-2xl bg-[#f3eee7] p-4">
      <p className="font-medium">{mode === "yes" ? "They said yes to promotional texts" : "They asked to stop promotional texts"}</p>
      <label className="label mt-3" htmlFor="cf-how">How</label>
      <select id="cf-how" value={how} onChange={(e) => setHow(e.target.value)} className="field !bg-white !py-2.5">
        {HOW.map((h) => (
          <option key={h.key} value={h.key}>
            {h.label}
          </option>
        ))}
      </select>
      {mode === "yes" && (
        <>
          <div className="mt-3 flex items-end justify-between gap-2">
            <label className="label !mb-1" htmlFor="cf-wording">Exactly what you asked them</label>
            <select
              aria-label="Language of the question"
              value={lang}
              onChange={(e) => {
                setLang(e.target.value);
                setWording(SCRIPTS[e.target.value]);
              }}
              className="rounded-lg border border-line bg-white px-2 py-1 text-xs"
            >
              <option value="en-US">English</option>
              <option value="zh-CN">普通话</option>
              <option value="zh-HK">粵語</option>
              <option value="ko-KR">한국어</option>
            </select>
          </div>
          <textarea id="cf-wording" rows={3} value={wording} onChange={(e) => setWording(e.target.value)} className="field !bg-white resize-none text-sm" />
          <p className="mt-1.5 text-xs text-mute">Saved word for word as proof of consent. It should name the salon and say they can reply STOP.</p>
        </>
      )}
      {err && <p className="mt-2 text-sm text-rose-700">{err}</p>}
      <div className="mt-3 flex gap-2">
        <button
          disabled={busy || (mode === "yes" && !wording.trim())}
          onClick={() => submit(mode === "yes" ? "express" : "withdrawn")}
          className={`rounded-full px-4 py-2.5 text-sm text-paper disabled:opacity-50 ${mode === "yes" ? "bg-moss hover:bg-ink" : "bg-rose-700 hover:bg-rose-800"}`}
        >
          {busy ? "Saving..." : mode === "yes" ? "Save consent" : "Save opt-out"}
        </button>
        <button onClick={() => setMode(null)} className="rounded-full px-4 py-2.5 text-sm text-ink-soft">
          Cancel
        </button>
      </div>
    </div>
  );
}
