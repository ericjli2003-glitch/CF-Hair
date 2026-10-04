import { fill, type Dict } from "@/lib/i18n/dictionary";
import { buildingAddress, salon, unitNumber } from "@/lib/salon";

type Kind = "station" | "mall" | "salon";

function Marker({ kind }: { kind: Kind }) {
  return (
    <svg viewBox="0 0 28 28" className="h-7 w-7 shrink-0" aria-hidden="true" focusable="false">
      {kind === "station" && <circle cx="14" cy="14" r="10.5" fill="#fff" stroke="#000" strokeWidth="3" />}
      {kind === "mall" && <rect x="3.5" y="3.5" width="21" height="21" rx="3" fill="#fff" stroke="#000" strokeWidth="3" />}
      {kind === "salon" && (
        <>
          <circle cx="14" cy="14" r="12" fill="#000" />
          <circle cx="14" cy="14" r="4.5" fill="#fff" />
        </>
      )}
    </svg>
  );
}

/**
 * Lincoln Station, then Henderson Place, then the salon's unit, drawn as a
 * schematic route. It shows the order of places only: no distances, floors or
 * turns that have not been checked on site.
 */
export function Wayfinding({ t }: { t: Dict }) {
  const unit = unitNumber();
  const stops: { kind: Kind; title: string; sub: string; leg?: string; dashed?: boolean }[] = [
    { kind: "station", title: t.way.station, sub: t.way.stationSub, leg: t.way.walk, dashed: true },
    { kind: "mall", title: t.way.mall, sub: fill(t.way.mallSub, { street: buildingAddress() }), leg: t.way.inside },
    { kind: "salon", title: fill(t.way.salon, { unit }), sub: fill(t.way.salonSub, { salon: salon.name }) },
  ];
  const label = (s: (typeof stops)[number]) => (
    <>
      <p className="font-cond text-[1.4rem] font-semibold leading-tight">{s.title}</p>
      <p className="mt-0.5 text-[0.92rem] leading-snug text-slate">{s.sub}</p>
    </>
  );

  return (
    <figure>
      {/* Phones: top to bottom. */}
      <ol className="md:hidden">
        {stops.map((s) => (
          <li key={s.kind} className="grid grid-cols-[1.75rem_minmax(0,1fr)] gap-x-3">
            <Marker kind={s.kind} />
            <div className="pb-1 pt-0.5">{label(s)}</div>
            {s.leg && (
              <>
                <div className="flex justify-center py-1">
                  <span className={`block min-h-12 w-0 border-l-[3px] border-black ${s.dashed ? "border-dotted" : ""}`} />
                </div>
                <p className="self-center py-2 text-[0.92rem] text-slate">{s.leg}</p>
              </>
            )}
          </li>
        ))}
      </ol>

      {/* Wider screens: left to right. */}
      <ol className="hidden grid-cols-3 md:grid">
        {stops.map((s) => (
          <li key={s.kind} className="min-w-0">
            <div className="flex items-center">
              <Marker kind={s.kind} />
              {s.leg && (
                <div className="relative mx-1 flex-1">
                  <span className={`block h-0 border-t-[3px] border-black ${s.dashed ? "border-dotted" : ""}`} />
                  <span className="absolute bottom-2 left-1/2 -translate-x-1/2 whitespace-nowrap bg-tile px-2 text-[0.92rem] text-slate">
                    {s.leg}
                  </span>
                </div>
              )}
            </div>
            <div className="mt-3 pr-6">{label(s)}</div>
          </li>
        ))}
      </ol>
      <figcaption className="mt-4 text-[0.85rem] text-slate">{t.way.schematic}</figcaption>
    </figure>
  );
}
