"use client";

import { useRouter } from "next/navigation";
import { useTransition } from "react";
import { HTML_LANG, LANGS, LANG_LABELS, LANG_NAMES, type Lang } from "@/lib/i18n/dictionary";
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
      {LANGS.map((l) => {
        const { native, english } = LANG_NAMES[l];
        const name = native === english ? native : `${native}, ${english}`;
        return (
          <button
            key={l}
            type="button"
            onClick={() => set(l)}
            aria-pressed={lang === l}
            aria-label={name}
            title={name}
            lang={HTML_LANG[l]}
            className={`whitespace-nowrap rounded-full px-2 py-1 font-medium tracking-wide transition sm:px-2.5 ${
              lang === l
                ? tone === "light"
                  ? "bg-paper text-espresso"
                  : "bg-ink text-paper"
                : "opacity-70 hover:opacity-100"
            }`}
          >
            {LANG_LABELS[l]}
          </button>
        );
      })}
    </div>
  );
}
