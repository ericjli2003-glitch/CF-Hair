import { cookies, headers } from "next/headers";
import { dictionaries, isLang, type Lang } from "./dictionary";

export const LANG_COOKIE = "lang";

export async function getLang(): Promise<Lang> {
  const jar = await cookies();
  const v = jar.get(LANG_COOKIE)?.value;
  if (isLang(v)) return v;
  const accept = (await headers()).get("accept-language") ?? "";
  const first = accept.split(",")[0]?.trim().toLowerCase() ?? "";
  if (first.startsWith("zh")) return "zh";
  if (first.startsWith("ko")) return "ko";
  return "en";
}

export async function getI18n() {
  const lang = await getLang();
  return { lang, t: dictionaries[lang] };
}
