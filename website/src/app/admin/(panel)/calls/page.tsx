import Link from "next/link";
import { CallDrawer, type CallDetail } from "@/components/admin/calls/CallDrawer";
import { LangChip, OUTCOME_LABEL, OutcomeChip, callerNumber, duration } from "@/components/admin/calls/ui";
import { Tile } from "@/components/admin/promo/ui";
import { dayLabel, time12 } from "@/lib/admin-format";
import { CALL_OUTCOMES, getCall, listCalls, transcriptDays, type CallView } from "@/lib/calls";
import { prisma } from "@/lib/db";
import { DAY_KEYS, SALON_TZ } from "@/lib/salon";
import { addDays, dateKeyOf, isDateKey, toZonedISO, weekdayOf, zonedTime } from "@/lib/time";

export const dynamic = "force-dynamic";

type SP = Record<string, string | string[] | undefined>;
const one = (v: string | string[] | undefined) => (typeof v === "string" ? v : undefined);

export default async function CallsPage(props: PageProps<"/admin/calls">) {
  const sp = (await props.searchParams) as SP;
  const outcome = one(sp.outcome) && (CALL_OUTCOMES as readonly string[]).includes(one(sp.outcome)!) ? one(sp.outcome)! : "";
  const from = one(sp.from) && isDateKey(one(sp.from)) ? one(sp.from)! : "";
  const to = one(sp.to) && isDateKey(one(sp.to)) ? one(sp.to)! : "";
  const phone = (one(sp.phone) ?? "").trim().slice(0, 30);
  const cursor = one(sp.cursor) ?? "";
  const selectedId = one(sp.call);

  const now = new Date();
  const today = dateKeyOf(now, SALON_TZ);
  const weekStart = addDays(today, -((DAY_KEYS.indexOf(weekdayOf(today)) + 7) % 7));
  const z = (d: string) => zonedTime(d, 0, SALON_TZ);

  let list: { calls: CallView[]; nextCursor: string | null } = { calls: [], nextCursor: null };
  let filterError = "";
  try {
    list = await listCalls({ outcome, from, to, phone, cursor: cursor || null, limit: 50 });
  } catch {
    filterError = "Check the phone number: type at least a few digits.";
  }

  const [total, todayCount, bookedWeek, messagesWeek, selected] = await Promise.all([
    prisma.call.count(),
    prisma.call.count({ where: { startedAt: { gte: z(today), lt: z(addDays(today, 1)) } } }),
    prisma.call.count({ where: { outcome: "booked", startedAt: { gte: z(weekStart) } } }),
    prisma.call.count({ where: { outcome: "message", startedAt: { gte: z(weekStart) } } }),
    selectedId ? getCall(selectedId) : Promise.resolve(null),
  ]);

  // Names for callers who are not clients but told the phone assistant their name.
  const phones = [...new Set([...list.calls, ...(selected ? [selected] : [])].filter((c) => !c.customer && c.from).map((c) => c.from!))];
  const profiles = phones.length ? await prisma.callerProfile.findMany({ where: { phone: { in: phones } } }) : [];
  const profileName = new Map(profiles.filter((p) => p.name).map((p) => [p.phone, p.name!]));
  const nameOf = (c: CallView) => c.customer?.name ?? (c.from ? profileName.get(c.from) : undefined) ?? null;

  let detail: CallDetail | null = null;
  if (selected) {
    const [booking, message] = await Promise.all([
      selected.bookingId ? prisma.booking.findUnique({ where: { id: selected.bookingId }, include: { service: true, staff: true } }) : null,
      selected.messageId ? prisma.message.findUnique({ where: { id: selected.messageId } }) : null,
    ]);
    detail = {
      ...selected,
      name: nameOf(selected),
      transcriptDays: transcriptDays(),
      booking: booking
        ? { id: booking.id, start: toZonedISO(booking.start, SALON_TZ), serviceName: booking.service.name, staffName: booking.staff.name, status: booking.status }
        : null,
      message: message ? { id: message.id, status: message.status, text: message.message } : null,
    };
  }

  const params = (over: Record<string, string>) => {
    const q = new URLSearchParams();
    const all = { outcome, from, to, phone, ...over };
    for (const [k, v] of Object.entries(all)) if (v) q.set(k, v);
    const s = q.toString();
    return s ? `/admin/calls?${s}` : "/admin/calls";
  };
  const filtered = !!(outcome || from || to || phone);
  const closeHref = params({ cursor });

  return (
    <div>
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <p className="text-xs uppercase tracking-[0.2em] text-mute">Phone receptionist</p>
          <h1 className="display mt-1 text-[2.8rem] leading-none">Calls</h1>
          <p className="mt-2 max-w-2xl text-ink-soft">
            Every call the phone assistant answered, with what happened and what was said. Transcripts are kept for {transcriptDays()} days; summaries stay.
          </p>
        </div>
      </div>

      <div className="mt-6 grid grid-cols-1 gap-3 sm:grid-cols-3">
        <Tile label="Calls today" value={String(todayCount)} sub={dayLabel(today, { weekday: "long", month: "long", day: "numeric" })} />
        <Tile label="Booked by phone this week" value={String(bookedWeek)} sub={`Since ${dayLabel(weekStart, { weekday: "long" })}`} accent={bookedWeek ? "moss" : undefined} />
        <Tile label="Missed-call messages this week" value={String(messagesWeek)} sub="Callback requests, also in Messages" accent={messagesWeek ? "clay" : undefined} />
      </div>

      <div className="mt-8 flex flex-wrap items-end justify-between gap-4">
        <nav aria-label="Outcome" className="no-scrollbar -mx-1 flex max-w-full gap-2 overflow-x-auto px-1 py-1">
          {["", ...CALL_OUTCOMES].map((o) => (
            <Link
              key={o || "all"}
              href={params({ outcome: o })}
              aria-current={outcome === o ? "page" : undefined}
              className={`shrink-0 rounded-full px-4 py-2 text-sm ring-1 ${outcome === o ? "bg-ink text-paper ring-ink" : "bg-paper text-ink-soft ring-line hover:text-ink"}`}
            >
              {o ? OUTCOME_LABEL[o] : "All"}
            </Link>
          ))}
        </nav>
        <form action="/admin/calls" className="flex flex-wrap items-end gap-2">
          {outcome && <input type="hidden" name="outcome" value={outcome} />}
          <label className="text-xs text-mute">
            <span className="mb-1 block">From</span>
            <input type="date" name="from" defaultValue={from} max={today} className="field !w-[9.5rem] !rounded-full !px-3.5 !py-2 text-sm" />
          </label>
          <label className="text-xs text-mute">
            <span className="mb-1 block">To</span>
            <input type="date" name="to" defaultValue={to} max={today} className="field !w-[9.5rem] !rounded-full !px-3.5 !py-2 text-sm" />
          </label>
          <label className="text-xs text-mute">
            <span className="mb-1 block">Phone</span>
            <input type="search" name="phone" defaultValue={phone} inputMode="tel" placeholder="604 555 0142" className="field !w-[10.5rem] !rounded-full !px-3.5 !py-2 text-sm" />
          </label>
          <button className="rounded-full bg-ink px-4 py-2 text-sm text-paper hover:bg-clay">Search</button>
          {filtered && (
            <Link href="/admin/calls" className="px-2 py-2 text-sm text-ink-soft underline-offset-4 hover:text-ink hover:underline">
              Clear
            </Link>
          )}
        </form>
      </div>

      {filterError ? (
        <p className="mt-6 rounded-2xl bg-paper p-8 text-center text-ink-soft ring-1 ring-line">{filterError}</p>
      ) : total === 0 ? (
        <div className="mt-6 rounded-2xl bg-paper px-6 py-12 text-center ring-1 ring-line">
          <p className="text-lg font-medium">No calls yet.</p>
          <p className="mx-auto mt-1 max-w-md text-ink-soft">
            Calls appear here after the phone receptionist answers. Each one shows who called, in which language, what they needed and the full conversation.
          </p>
        </div>
      ) : list.calls.length === 0 ? (
        <div className="mt-6 rounded-2xl bg-paper px-6 py-10 text-center ring-1 ring-line">
          <p className="text-ink-soft">No calls match these filters.</p>
          <Link href="/admin/calls" className="mt-2 inline-block text-sm text-clay underline underline-offset-4">
            Show all calls
          </Link>
        </div>
      ) : (
        <div className="mt-4 overflow-hidden rounded-2xl bg-paper ring-1 ring-line">
          {list.calls.map((c, i) => {
            const day = c.startedAt.slice(0, 10);
            const header = i === 0 || list.calls[i - 1].startedAt.slice(0, 10) !== day;
            const name = nameOf(c);
            const active = c.id === selectedId;
            return (
              <div key={c.id}>
                {header && (
                  <div className="border-b border-line bg-[#f3eee7] px-5 py-2 text-xs font-medium uppercase tracking-[0.14em] text-ink-soft">
                    {day === today ? "Today · " : day === addDays(today, -1) ? "Yesterday · " : ""}
                    {dayLabel(day, { weekday: "long", month: "long", day: "numeric" })}
                  </div>
                )}
                <Link
                  href={params({ cursor, call: c.id })}
                  scroll={false}
                  className={`grid grid-cols-[4.75rem_1fr_auto] gap-x-4 gap-y-1.5 border-b border-line px-5 py-3.5 transition last:border-0 hover:bg-[#f6f1ea] lg:grid-cols-[5.5rem_minmax(11rem,15rem)_7.5rem_1fr] lg:items-center ${
                    active ? "bg-[#f3ece2]" : ""
                  } ${c.outcome === "spam" || c.outcome === "abandoned" ? "text-ink-soft" : ""}`}
                >
                  <div className="row-span-2 tabular-nums lg:row-span-1">
                    <p className="font-medium text-ink">{time12(c.startedAt)}</p>
                    <p className="text-xs text-mute">{duration(c.durationSec)}</p>
                  </div>
                  <div className="min-w-0">
                    <p className={`truncate font-medium ${name ? "text-ink" : "text-ink-soft"}`}>{name ?? callerNumber(c.from)}</p>
                    <div className="mt-0.5 flex items-center gap-2">
                      <LangChip lang={c.language} />
                      {name && c.from && <span className="hidden truncate text-xs text-mute sm:inline">{callerNumber(c.from)}</span>}
                    </div>
                  </div>
                  <div className="justify-self-end lg:justify-self-start">
                    <OutcomeChip outcome={c.outcome} />
                  </div>
                  <p className="col-span-2 line-clamp-2 text-sm leading-snug text-ink-soft lg:col-span-1 lg:line-clamp-1">{c.summary}</p>
                </Link>
              </div>
            );
          })}
        </div>
      )}

      {(cursor || list.nextCursor) && (
        <div className="mt-4 flex justify-between text-sm">
          {cursor ? (
            <Link href={params({})} className="rounded-full px-4 py-2 ring-1 ring-line hover:ring-ink">
              Newest calls
            </Link>
          ) : (
            <span />
          )}
          {list.nextCursor && (
            <Link href={params({ cursor: list.nextCursor })} className="rounded-full px-4 py-2 ring-1 ring-line hover:ring-ink">
              Older calls
            </Link>
          )}
        </div>
      )}

      {selectedId && <CallDrawer call={detail} closeHref={closeHref} />}
    </div>
  );
}
