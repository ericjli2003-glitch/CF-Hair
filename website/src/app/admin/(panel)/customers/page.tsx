import { CustomerTable } from "@/components/admin/CustomerTable";
import { listCustomers } from "@/lib/customers";
import { prisma } from "@/lib/db";
import { consentByCustomer } from "@/lib/sms/consent";

export const dynamic = "force-dynamic";

export default async function CustomersPage(props: PageProps<"/admin/customers">) {
  const sp = await props.searchParams;
  const q = typeof sp.q === "string" ? sp.q : "";
  const tag = typeof sp.tag === "string" ? sp.tag : "";
  const [all, staff] = await Promise.all([listCustomers(), prisma.staff.findMany({ orderBy: { sortOrder: "asc" } })]);
  const tags = [...new Set(all.flatMap((c) => c.tags))].sort();
  const rows = await listCustomers({ q: q || null, tag: tag || null });
  const totalVisits = all.reduce((s, c) => s + c.visitCount, 0);
  const consentMap = await consentByCustomer();
  const txnOff = new Set((await prisma.smsConsent.findMany({ where: { txnOptedOutAt: { not: null } }, select: { phone: true } })).map((r) => r.phone));
  const consent = Object.fromEntries(
    all.map((c) => {
      const v = consentMap.get(c.id);
      return [c.id, { status: v?.status ?? "none", expiresAt: v?.impliedExpiresAt ?? null, txnOptedOut: txnOff.has(c.phone) }];
    }),
  );
  const optedIn = [...consentMap.values()].filter((v) => v.status === "express").length;

  return (
    <div>
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <h1 className="display text-[2.8rem] leading-none">Clients</h1>
          <p className="mt-2 text-ink-soft">
            {all.length} clients · {totalVisits} completed visits · {optedIn} opted in to promotional texts
          </p>
        </div>
        <a href="/api/customers/export" className="btn-primary" download>
          Export CSV
        </a>
      </div>
      <CustomerTable consent={consent} rows={rows} staff={staff.map((s) => ({ id: s.id, name: s.name }))} tags={tags} q={q} tag={tag} />
    </div>
  );
}
