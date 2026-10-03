"use client";

import { createContext, useContext } from "react";
import { dictionaries, type Dict, type Lang } from "@/lib/i18n/dictionary";

const Ctx = createContext<{ lang: Lang; t: Dict }>({ lang: "en", t: dictionaries.en });

export function LangProvider({ lang, children }: { lang: Lang; children: React.ReactNode }) {
  return <Ctx.Provider value={{ lang, t: dictionaries[lang] }}>{children}</Ctx.Provider>;
}

export const useI18n = () => useContext(Ctx);
