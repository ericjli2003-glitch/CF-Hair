import { Sparkle } from "./Monogram";

/** Slowly rotating circular text badge. */
export function RotatingBadge({ text, className = "" }: { text: string; className?: string }) {
  const repeated = text.repeat(2);
  return (
    <div className={`relative grid place-items-center rounded-full bg-paper shadow-[0_20px_50px_-20px_rgba(37,28,22,0.45)] ${className}`}>
      <svg viewBox="0 0 200 200" className="absolute inset-0 h-full w-full animate-spin-slow" aria-hidden="true">
        <defs>
          <path id="badgeCircle" d="M100,100 m-74,0 a74,74 0 1,1 148,0 a74,74 0 1,1 -148,0" />
        </defs>
        <text fontSize="14.5" letterSpacing="3.2" fill="var(--color-ink)" style={{ textTransform: "uppercase", fontFamily: "var(--font-sans)" }}>
          <textPath href="#badgeCircle">{repeated}</textPath>
        </text>
      </svg>
      <Sparkle className="h-7 w-7 text-clay" />
    </div>
  );
}
