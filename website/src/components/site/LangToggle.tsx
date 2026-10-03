"use client";

import { useRouter } from "next/navigation";
import { useTransition } from "react";
import { LANGS, LANG_LABELS, type Lang } from "@/lib/i18n/dictionary";
import { useI18n } from "../LangProvider";

function writeLangCookie(l: Lang) {
  document.cookie = `lang=${l}; path=/; max-age=31536000; samesite=lax`;
}

export function LangToggle({ tone = "dark" }: { tone?: "dark" | "light" }) {
  const { lang } = useI18n();
  const router = useRouter();
  const [pending, start] = useTransition();
  const set = (l: Lang) => {
    writeLangCookie(l);
    start(() => router.refresh());
  };
  return (
    <div
      role="group"
      aria-label="Language"
      className={`flex items-center rounded-full border p-0.5 text-[0.72rem] ${
        tone === "light" ? "border-paper/25 text-paper" : "border-ink/15 text-ink"
      } ${pending ? "opacity-60" : ""}`}
    >
      {LANGS.map((l) => (
        <button
          key={l}
          type="button"
          onClick={() => set(l)}
          aria-pressed={lang === l}
          className={`rounded-full px-2.5 py-1 font-medium tracking-wide transition ${
            lang === l
              ? tone === "light"
                ? "bg-paper text-espresso"
                : "bg-ink text-paper"
              : "opacity-70 hover:opacity-100"
          }`}
        >
          {LANG_LABELS[l]}
        </button>
      ))}
    </div>
  );
}
