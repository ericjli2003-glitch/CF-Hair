import Image from "next/image";
import { photos } from "@/data/photos";

/**
 * A place for one of the owner's photos. When photos[slot] is set the photo is
 * shown; until then a dashed frame says plainly that a photo goes here.
 *
 * frame="moon": a round photo inside a thin ring set a little away from it, like
 * a garden moon gate (月洞门). Used for the stylists on the home and team pages.
 */
export function PhotoSlot({
  slot,
  label,
  alt = "",
  className = "",
  sizes = "160px",
  frame = "rect",
}: {
  slot: string;
  label: string;
  alt?: string;
  className?: string;
  sizes?: string;
  frame?: "rect" | "moon";
}) {
  const src = photos[slot];
  const moon = frame === "moon";
  const inner = moon ? "aspect-square w-full rounded-full" : `rounded-lg ${className}`;
  const body = src ? (
    <div className={`relative overflow-hidden bg-board ${inner}`} data-photo-slot={slot}>
      <Image src={src} alt={alt} fill sizes={sizes} className="object-cover" />
    </div>
  ) : (
    <div
      className={`flex flex-col items-center justify-center border-2 border-dashed border-edge bg-white/50 text-center leading-tight text-slate ${
        moon ? "gap-1 overflow-hidden p-1 text-[0.78rem] [word-break:keep-all]" : "gap-1.5 p-2 text-[0.82rem]"
      } ${inner}`}
      data-photo-slot={slot}
    >
      <svg viewBox="0 0 24 24" className="h-5 w-5 shrink-0" fill="none" stroke="currentColor" strokeWidth="1.6" aria-hidden="true">
        <rect x="3" y="6" width="18" height="14" rx="2" />
        <circle cx="12" cy="13" r="3.5" />
        <path d="M8.5 6l1.5-2h4l1.5 2" />
      </svg>
      <span>{label}</span>
    </div>
  );
  if (!moon) return body;
  return <div className={`aspect-square rounded-full border border-primary/55 p-[8%] ${className}`}>{body}</div>;
}
