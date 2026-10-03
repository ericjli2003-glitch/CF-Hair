import { MessageList } from "@/components/admin/MessageList";
import { prisma } from "@/lib/db";
import { DEFAULT_LANGUAGE, isLanguageCode } from "@/lib/languages";

export const dynamic = "force-dynamic";

export default async function MessagesPage() {
  const rank: Record<string, number> = { high: 0, normal: 1, low: 2 };
  const rows = (await prisma.message.findMany({ orderBy: { createdAt: "desc" } })).sort(
    (a, b) =>
      Number(a.status === "done") - Number(b.status === "done") ||
      (a.status === "new" ? (rank[a.urgency] ?? 1) - (rank[b.urgency] ?? 1) : 0) ||
      +b.createdAt - +a.createdAt,
  );
  const phones = [...new Set(rows.map((r) => r.phone))];
  const [callers, customers] = await Promise.all([
    prisma.callerProfile.findMany({ where: { phone: { in: phones } } }),
    prisma.customer.findMany({ where: { phone: { in: phones } }, include: { _count: { select: { bookings: true } } } }),
  ]);
  const langOf = new Map<string, string>();
  for (const c of customers) langOf.set(c.phone, c.preferredLanguage);
  for (const c of callers) langOf.set(c.phone, c.preferredLanguage);
  const items = rows.map((m) => {
    const lang = langOf.get(m.phone);
    const cust = customers.find((c) => c.phone === m.phone);
    return {
      id: m.id,
      callerName: m.callerName,
      phone: m.phone,
      message: m.message,
      urgency: m.urgency,
      status: m.status,
      source: m.source,
      createdAt: m.createdAt.toISOString(),
      language: isLanguageCode(lang) ? lang : DEFAULT_LANGUAGE,
      isClient: !!cust,
      bookings: cust?._count.bookings ?? 0,
    };
  });
  const open = items.filter((i) => i.status === "new").length;
  return (
    <div className="mx-auto max-w-4xl">
      <h1 className="display text-[2.8rem] leading-none">Messages</h1>
      <p className="mt-2 text-ink-soft">
        Callback requests taken by the phone assistant and the website contact form. {open} waiting.
      </p>
      <MessageList items={items} />
    </div>
  );
}
