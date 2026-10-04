"use client";

import { useI18n } from "@/components/LangProvider";

/**
 * Shown the moment a Book button or link is tapped, while the booking page
 * renders on the server: the page title, the step bar and the board's shape,
 * so the tap gets an answer straight away and nothing jumps when the page lands.
 */
export default function BookLoading() {
  const { t } = useI18n();
  return (
    <div className="frame pb-16 pt-4 md:pt-8" aria-busy="true">
      <h1 className="display text-[clamp(2.25rem,5vw,3.25rem)]">{t.book.title}</h1>
      <p role="status" className="sr-only">
        {t.common.loading}
      </p>
      <div aria-hidden="true">
        <div className="mt-6 flex gap-1.5 sm:grid sm:grid-cols-4 sm:gap-3">
          {t.book.steps.map((label, i) => (
            <div key={label} className={`flex min-h-11 items-center gap-2 border-b-[3px] border-rule py-2 ${i === 0 ? "flex-1" : "w-12 shrink-0 sm:w-auto"}`}>
              <span className="h-6 w-6 rounded-full border-[1.5px] border-edge" />
            </div>
          ))}
        </div>
        <div className="mt-8 grid grid-cols-[minmax(0,1fr)] gap-8 lg:grid-cols-[minmax(0,8fr)_minmax(0,4fr)] lg:gap-10">
          <div>
            <div className="h-9 w-56 animate-pulse rounded-md bg-white/70" />
            <div className="mt-6 space-y-2 rounded-xl bg-white p-4">
              {Array.from({ length: 6 }).map((_, i) => (
                <div key={i} className="h-12 animate-pulse rounded-md bg-tile" />
              ))}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
