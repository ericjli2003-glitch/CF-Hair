import { CustomerTable } from "@/components/admin/CustomerTable";
import { listCustomers } from "@/lib/customers";
import { prisma } from "@/lib/db";

export const dynamic = "force-dynamic";

export default async function CustomersPage(props: PageProps<"/admin/customers">) {
  const sp = await props.searchParams;
  const q = typeof sp.q === "string" ? sp.q : "";
  const tag = typeof sp.tag === "string" ? sp.tag : "";
  const [all, staff] = await Promise.all([listCustomers(), prisma.staff.findMany({ orderBy: { sortOrder: "asc" } })]);
  const tags = [...new Set(all.flatMap((c) => c.tags))].sort();
  const rows = await listCustomers({ q: q || null, tag: tag || null });
  const totalVisits = all.reduce((s, c) => s + c.visitCount, 0);

  return (
    <div>
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <h1 className="display text-[2.8rem] leading-none">Clients</h1>
          <p className="mt-2 text-ink-soft">
            {all.length} clients · {totalVisits} completed visits
          </p>
        </div>
        <a href="/api/customers/export" className="btn-primary !px-5 !py-2.5 !normal-case !tracking-normal !text-sm" download>
          Export CSV
        </a>
      </div>
      <CustomerTable rows={rows} staff={staff.map((s) => ({ id: s.id, name: s.name }))} tags={tags} q={q} tag={tag} />
    </div>
  );
}
