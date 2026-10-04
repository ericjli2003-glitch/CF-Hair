import Image from "next/image";
import { photos } from "@/data/photos";

/**
 * A place for one of the owner's photos. When photos[slot] is set the photo is
 * shown; until then a dashed frame says plainly that a photo goes here.
 */
export function PhotoSlot({
  slot,
  label,
  alt = "",
  className = "",
  sizes = "160px",
}: {
  slot: string;
  label: string;
  alt?: string;
  className?: string;
  sizes?: string;
}) {
  const src = photos[slot];
  if (src) {
    return (
      <div className={`relative overflow-hidden rounded-lg bg-white ${className}`} data-photo-slot={slot}>
        <Image src={src} alt={alt} fill sizes={sizes} className="object-cover" />
      </div>
    );
  }
  return (
    <div
      className={`flex flex-col items-center justify-center gap-1.5 rounded-lg border-2 border-dashed border-edge bg-white/50 p-2 text-center text-[0.82rem] leading-tight text-slate ${className}`}
      data-photo-slot={slot}
    >
      <svg viewBox="0 0 24 24" className="h-5 w-5" fill="none" stroke="currentColor" strokeWidth="1.6" aria-hidden="true">
        <rect x="3" y="6" width="18" height="14" rx="2" />
        <circle cx="12" cy="13" r="3.5" />
        <path d="M8.5 6l1.5-2h4l1.5 2" />
      </svg>
      <span>{label}</span>
    </div>
  );
}
