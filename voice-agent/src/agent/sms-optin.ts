import type { LanguageCode } from "../languages.js";

/**
 * The one promotional-text question the phone assistant may ask, word for word,
 * per language. It is asked at most once per caller, only right after a booking,
 * and only when the website says the caller has given no answer yet. The exact
 * sentence spoken is stored as proof of consent (CASL), so it must not be paraphrased.
 */
export const SMS_OPTIN_QUESTION: Record<LanguageCode, string> = {
  "en-US": "Would you like the occasional text about specials? You can reply STOP any time.",
  "zh-CN": "您愿意偶尔收到我们优惠活动的短信吗？您随时可以回复STOP退订。",
  "zh-HK": "你想唔想間中收到我哋優惠嘅短訊？你隨時可以回覆STOP取消。",
  "ko-KR": "가끔 특별 할인 소식을 문자로 받아보시겠어요? 언제든지 STOP으로 회신하시면 수신이 중단됩니다.",
};

/** The consent record: who asked, in which language, the exact question, and the answer. */
export function smsOptInWording(salonName: string, language: LanguageCode, accepted: boolean): string {
  return `[Phone assistant, ${salonName}, ${language}] "${SMS_OPTIN_QUESTION[language]}" Caller said ${accepted ? "yes" : "no"}.`;
}
