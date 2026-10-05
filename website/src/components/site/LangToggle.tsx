"use client";

import { useRouter } from "next/navigation";
import { useTransition } from "react";
import { HTML_LANG, LANGS, LANG_LABELS, LANG_NAMES, type Lang } from "@/lib/i18n/dictionary";
import { useI18n } from "../LangProvider";

function writeLangCookie(l: Lang) {
  document.cookie = `lang=${l}; path=/; max-age=31536000; samesite=lax`;
}

export function LangToggle({ wide = false }: { wide?: boolean }) {
  const { lang } = useI18n();
  const router = useRouter();
  const [pending, start] = useTransition();
  const set = (l: Lang) => {
    if (l === lang) return;
    writeLangCookie(l);
    start(() => router.refresh());
  };
  return (
    <div
      role="group"
      aria-label="Language"
      aria-busy={pending || undefined}
      className={`${wide ? "grid w-full grid-cols-4" : "inline-flex"} rounded-md border-[1.5px] border-primary bg-board p-0.5 ${
        pending ? "opacity-70" : ""
      }`}
    >
      {LANGS.map((l) => {
        const { native, english } = LANG_NAMES[l];
        const name = native === english ? native : `${native}, ${english}`;
        const on = lang === l;
        return (
          <button
            key={l}
            type="button"
            onClick={() => set(l)}
            aria-pressed={on}
            aria-label={name}
            title={name}
            lang={HTML_LANG[l]}
            className={`min-h-11 min-w-11 whitespace-nowrap rounded-[4px] px-2.5 text-[0.92rem] font-medium leading-none transition-colors ${
              on ? "bg-primary text-white" : "text-ink hover:bg-tile"
            }`}
          >
            {LANG_LABELS[l]}
          </button>
        );
      })}
    </div>
  );
}
