// The booking form's promotional SMS checkbox. The wording stored as proof is
// rebuilt on the server from the same dictionary the form rendered, so the record
// always holds exactly what the visitor saw in their language.
import { dictionaries, fill, isLang, type Lang } from "../i18n/dictionary";
import { SITE_LANG_TO_LANGUAGE } from "../languages";
import { formatPhoneDisplay, fullAddress, salon } from "../salon";
import { recordConsent } from "./consent";

export function webOptInWording(lang: Lang): { label: string; fine: string; full: string } {
  const t = dictionaries[lang].book;
  const vars = { salon: salon.name, address: fullAddress(), phone: formatPhoneDisplay(salon.phone) };
  const label = fill(t.smsOptIn, vars);
  const fine = fill(t.smsOptInFine, vars);
  return { label, fine, full: `${label} ${fine}` };
}

export async function recordWebOptIn(phone: string, langInput: unknown, detail: Record<string, unknown>) {
  const lang: Lang = isLang(langInput) ? langInput : "en";
  return recordConsent({
    phone,
    status: "express",
    source: "web",
    wording: webOptInWording(lang).full,
    language: SITE_LANG_TO_LANGUAGE[lang],
    actor: "customer",
    detail: { ...detail, form: "online booking", checkbox: "unchecked by default, ticked by the visitor" },
  });
}
