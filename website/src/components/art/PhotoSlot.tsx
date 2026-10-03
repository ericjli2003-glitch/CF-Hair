import Image from "next/image";
import { photos } from "@/data/photos";

const PALETTES = [
  "radial-gradient(120% 90% at 20% 10%, #f3d7c2 0%, #d79a74 38%, #9a4c2c 72%, #3a2419 100%)",
  "radial-gradient(120% 90% at 80% 0%, #efe2d0 0%, #c9a77f 40%, #6f5a43 78%, #2a211b 100%)",
  "radial-gradient(130% 100% at 30% 0%, #f1ddd0 0%, #c98f80 42%, #7c4a45 76%, #2c1d1c 100%)",
  "radial-gradient(130% 100% at 70% 10%, #e9e3d3 0%, #a9ae8f 42%, #5c664f 76%, #23261f 100%)",
];

/**
 * A place for one of the owner's photos. When photos[slot] is set, the real image
 * is shown; otherwise an abstract gradient artwork with a discreet label.
 */
export function PhotoSlot({
  slot,
  label,
  palette = 0,
  className = "",
  children,
  sizes = "(min-width: 1024px) 40vw, 90vw",
  priority = false,
  labelPos = "bl",
}: {
  slot: string;
  label: string;
  palette?: number;
  className?: string;
  children?: React.ReactNode;
  sizes?: string;
  priority?: boolean;
  labelPos?: "bl" | "br";
}) {
  const src = photos[slot];
  return (
    <div className={`relative isolate overflow-hidden ${className}`} data-photo-slot={slot}>
      {src ? (
        <Image src={src} alt="" fill sizes={sizes} priority={priority} className="object-cover" />
      ) : (
        <>
          <div className="absolute inset-0" style={{ background: PALETTES[palette % PALETTES.length] }} />
          <div
            className="absolute inset-0 opacity-[0.35] mix-blend-overlay"
            style={{ backgroundImage: "var(--grain)", backgroundSize: "180px" }}
          />
          {children}
          <span className={`absolute bottom-3 z-10 ${labelPos === "br" ? "right-3" : "left-3"} inline-flex items-center gap-1.5 rounded-full border border-white/30 bg-black/15 px-2.5 py-1 text-[0.6rem] font-medium uppercase tracking-[0.18em] text-white/85 backdrop-blur-sm`}>
            <svg viewBox="0 0 24 24" className="h-3 w-3" fill="none" stroke="currentColor" strokeWidth="1.6" aria-hidden="true">
              <rect x="3" y="6" width="18" height="14" rx="2" />
              <circle cx="12" cy="13" r="3.5" />
              <path d="M8 6l1.5-2h5L16 6" />
            </svg>
            {label}
          </span>
        </>
      )}
    </div>
  );
}
