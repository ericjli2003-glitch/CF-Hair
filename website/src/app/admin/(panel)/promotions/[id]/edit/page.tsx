import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { Composer } from "@/components/admin/promo/Composer";
import { getCatalog } from "@/lib/catalog";
import { prisma } from "@/lib/db";
import { serializeCampaign } from "@/lib/sms/campaigns";
import { draftingEnabled } from "@/lib/sms/draft";
import { getSmsSettings } from "@/lib/sms/settings";
import { smsMode } from "@/lib/sms/twilio";
import { ChevronIcon } from "@/components/admin/icons";

export const dynamic = "force-dynamic";

export default async function EditCampaignPage(props: PageProps<"/admin/promotions/[id]/edit">) {
  const { id } = await props.params;
  const row = await prisma.campaign.findUnique({ where: { id } });
  if (!row) notFound();
  if (row.status !== "draft" && row.status !== "scheduled") redirect(`/admin/promotions/${id}`);
  const c = serializeCampaign(row);
  const [{ staff, categories }, settings] = await Promise.all([getCatalog(), getSmsSettings()]);
  return (
    <div>
      <Link href={c.status === "scheduled" ? `/admin/promotions/${id}` : "/admin/promotions"} className="-ml-2 inline-flex min-h-11 items-center gap-1 rounded-md px-2 text-[0.95rem] text-ink-soft hover:text-ink">
        <ChevronIcon dir="left" className="h-4 w-4" />
        {c.status === "scheduled" ? c.name : "Promotions"}
      </Link>
      <h1 className="display mt-2 text-[2.8rem] leading-none">{c.status === "scheduled" ? "Edit scheduled campaign" : "Edit draft"}</h1>
      <Composer
        campaignId={id}
        initial={{ name: c.name, bodies: c.bodies, audience: c.audience, includeImplied: c.includeImplied, scheduledAt: c.status === "scheduled" ? c.scheduledAt : null }}
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
