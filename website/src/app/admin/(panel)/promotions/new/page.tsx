import Link from "next/link";
import { Composer } from "@/components/admin/promo/Composer";
import { getCatalog } from "@/lib/catalog";
import { draftingEnabled } from "@/lib/sms/draft";
import { getSmsSettings } from "@/lib/sms/settings";
import { smsMode } from "@/lib/sms/twilio";
import { ChevronIcon } from "@/components/admin/icons";

export const dynamic = "force-dynamic";

export default async function NewCampaignPage() {
  const [{ staff, categories }, settings] = await Promise.all([getCatalog(), getSmsSettings()]);
  return (
    <div>
      <Link href="/admin/promotions" className="-ml-2 inline-flex min-h-11 items-center gap-1 rounded-md px-2 text-[0.95rem] text-ink-soft hover:text-ink">
        <ChevronIcon dir="left" className="h-4 w-4" />
        Promotions
      </Link>
      <h1 className="display mt-2 text-[2.8rem] leading-none">New campaign</h1>
      <Composer
        staff={staff.map((s) => ({ id: s.id, name: s.name }))}
        categories={categories}
        drafting={draftingEnabled()}
        ownerPhone={settings.ownerPhone}
        mode={smsMode()}
        cap={settings.frequencyCap}
      />
    </div>
  );
}
