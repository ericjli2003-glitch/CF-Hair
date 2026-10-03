import type { Metadata } from "next";
import Link from "next/link";
import { Arrow } from "@/components/art/Monogram";
import { PhotoSlot } from "@/components/art/PhotoSlot";
import { Strands } from "@/components/art/Strands";
import { Reveal } from "@/components/Reveal";
import { getCatalog } from "@/lib/catalog";
import { categoryName, roleName, serviceName, staffBio } from "@/lib/i18n/localize";
import { getI18n } from "@/lib/i18n/server";

export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: "Team" };

export default async function TeamPage() {
  const { t } = await getI18n();
  const { services, staff, categories } = await getCatalog();

  return (
    <>
      <section className="container-x pb-10 pt-14 md:pt-20">
        <Reveal>
          <p className="eyebrow">{t.team.eyebrow}</p>
          <h1 className="display mt-6 text-[clamp(3.4rem,9vw,7rem)]">{t.team.title}</h1>
          <p className="mt-6 max-w-xl leading-relaxed text-ink-soft">{t.team.lead}</p>
        </Reveal>
      </section>
      <div className="container-x pb-24">
        {staff.map((s, i) => {
          const offered = services.filter((x) => s.serviceIds.includes(x.id));
          const cats = categories.filter((c) => offered.some((x) => x.category === c));
          return (
            <section key={s.id} className="grid items-center gap-10 border-t border-line py-16 md:grid-cols-12 md:gap-14">
              <Reveal className={`md:col-span-5 ${i % 2 ? "md:order-2" : ""}`}>
                <PhotoSlot slot={s.id} label={t.team.portrait} palette={i + 1} className="arch mx-auto aspect-[3/4] w-full max-w-[420px]">
                  <Strands className="absolute inset-0 h-full w-full opacity-70" count={16} seed={i * 3 + 1} animate={false} />
                  <div className="absolute inset-0 grid place-items-center">
                    <span className="display text-[9rem] italic text-paper/85">{s.name.replace(/^Stylist\s+/i, "").charAt(0)}</span>
                  </div>
                </PhotoSlot>
              </Reveal>
              <Reveal delay={100} className={`md:col-span-7 ${i % 2 ? "md:order-1" : ""}`}>
                <p className="eyebrow">{roleName(t, s.role)}</p>
                <h2 className="display mt-4 text-[clamp(3rem,6vw,4.8rem)]">{s.name}</h2>
                <p className="mt-5 max-w-lg text-[1.05rem] leading-relaxed text-ink-soft">{staffBio(t, s.id, s.bio)}</p>
                <div className="mt-8">
                  <p className="label">{t.team.specialties}</p>
                  <div className="mt-3 flex flex-wrap gap-2">
                    {cats.map((c) => (
                      <span key={c} className="rounded-full bg-paper px-3.5 py-1.5 text-[0.78rem] text-ink-soft ring-1 ring-line">
                        {categoryName(t, c)}
                      </span>
                    ))}
                  </div>
                  <p className="mt-4 max-w-lg text-[0.85rem] leading-relaxed text-mute">
                    {offered.map((x) => serviceName(t, x.id, x.name)).join(" · ")}
                  </p>
                </div>
                <Link href={`/book?staff=${s.id}`} className="btn-primary group mt-9">
                  {t.team.bookWith} {s.name}
                  <Arrow className="h-4 w-4 transition-transform group-hover:translate-x-1" />
                </Link>
              </Reveal>
            </section>
          );
        })}
      </div>
    </>
  );
}
