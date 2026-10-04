import { clean } from "../salon";
import type { Dict, Lang } from "./dictionary";

export const serviceName = (t: Dict, id: string, fallback: string) => t.serviceNames[id] ?? fallback;
export const serviceDesc = (t: Dict, id: string, fallback: string) => t.serviceDescriptions[id] ?? clean(fallback);
export const categoryName = (t: Dict, c: string) => t.categories[c] ?? c;
export const roleName = (t: Dict, r: string) => t.roles[r] ?? clean(r);
export const staffBio = (t: Dict, id: string, fallback: string) => t.bios[id] ?? clean(fallback);
export const languageList = (t: Dict, langs: string[]) => langs.map((l) => t.languages[l] ?? l);

/** "10:00" as "10 am" in English, "10:00" otherwise. */
export function formatTime(hhmm: string, lang: Lang): string {
  const [h, m] = hhmm.split(":").map(Number);
  if (lang !== "en") return `${String(h).padStart(2, "0")}:${String(m).padStart(2, "0")}`;
  const suffix = h >= 12 ? "pm" : "am";
  const h12 = h % 12 === 0 ? 12 : h % 12;
  return m ? `${h12}:${String(m).padStart(2, "0")} ${suffix}` : `${h12} ${suffix}`;
}

export const LOCALE: Record<Lang, string> = { en: "en-CA", zh: "zh-CN", hk: "zh-HK", ko: "ko-KR" };

/** "45 min", "1 hr 30 min", "3 hr" in the visitor's language. */
export function formatDuration(t: Dict, minutes: number): string {
  const h = Math.floor(minutes / 60);
  const m = minutes % 60;
  const tpl = h === 0 ? t.common.durM : m === 0 ? t.common.durH : t.common.durHM;
  return tpl.replace("{h}", String(h)).replace("{m}", String(m));
}

/** "English, Mandarin, Cantonese and Korean", "英语、普通话、粤语和韩语". */
export function joinList(lang: Lang, items: string[]): string {
  try {
    return new Intl.ListFormat(LOCALE[lang], { style: "long", type: "conjunction" }).format(items);
  } catch {
    return items.join(", ");
  }
}

/** "$30" or "Free". */
export const formatPrice = (t: Dict, cad: number) => (cad > 0 ? `$${cad}` : t.common.free);
