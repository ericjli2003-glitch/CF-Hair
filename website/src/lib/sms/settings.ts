import { prisma } from "../db";
import { toE164 } from "../phone";
import { DEFAULT_FREQUENCY_CAP, type FrequencyCap } from "./rules";

export interface SmsSettings {
  frequencyCap: FrequencyCap;
  /** Where "Send test" goes. Defaults to SMS_OWNER_PHONE. */
  ownerPhone: string | null;
}

const num = (v: string | undefined | null, d: number) => {
  const n = Number(v);
  return Number.isInteger(n) && n > 0 ? n : d;
};

export async function getSmsSettings(): Promise<SmsSettings> {
  const rows = await prisma.appSetting.findMany({ where: { key: { in: ["sms.capMax", "sms.capDays", "sms.ownerPhone"] } } });
  const get = (k: string) => rows.find((r) => r.key === k)?.value;
  return {
    frequencyCap: {
      max: num(get("sms.capMax") ?? process.env.SMS_FREQUENCY_CAP_MAX, DEFAULT_FREQUENCY_CAP.max),
      days: num(get("sms.capDays") ?? process.env.SMS_FREQUENCY_CAP_DAYS, DEFAULT_FREQUENCY_CAP.days),
    },
    ownerPhone: toE164(get("sms.ownerPhone") ?? process.env.SMS_OWNER_PHONE ?? "") ?? null,
  };
}

export async function saveSmsSettings(input: { capMax?: number; capDays?: number; ownerPhone?: string | null }) {
  const ops = [];
  const put = (key: string, value: string) => prisma.appSetting.upsert({ where: { key }, create: { key, value }, update: { value } });
  if (input.capMax !== undefined) ops.push(put("sms.capMax", String(input.capMax)));
  if (input.capDays !== undefined) ops.push(put("sms.capDays", String(input.capDays)));
  if (input.ownerPhone !== undefined) ops.push(put("sms.ownerPhone", input.ownerPhone ?? ""));
  await prisma.$transaction(ops);
  return getSmsSettings();
}
