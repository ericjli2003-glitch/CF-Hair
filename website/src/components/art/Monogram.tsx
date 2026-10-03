export function Monogram({ className = "", tone = "ink" }: { className?: string; tone?: "ink" | "paper" }) {
  const c = tone === "ink" ? "var(--color-ink)" : "var(--color-paper)";
  return (
    <svg viewBox="0 0 48 48" className={className} aria-hidden="true">
      <circle cx="24" cy="24" r="22.5" fill="none" stroke={c} strokeWidth="1" opacity="0.55" />
      <circle cx="24" cy="24" r="19.5" fill="none" stroke="var(--color-clay)" strokeWidth="0.6" opacity="0.8" />
      <text
        x="24"
        y="30.5"
        textAnchor="middle"
        fontFamily="var(--font-cormorant), serif"
        fontStyle="italic"
        fontSize="20"
        fill={c}
        letterSpacing="-0.5"
      >
        CF
      </text>
    </svg>
  );
}

export function Logo({ tone = "ink" }: { tone?: "ink" | "paper" }) {
  return (
    <span className="flex items-center gap-2.5">
      <Monogram className="h-10 w-10" tone={tone} />
      <span className="leading-none">
        <span className={`display block text-[1.35rem] ${tone === "ink" ? "text-ink" : "text-paper"}`}>CF Hair</span>
        <span className={`block text-[0.58rem] uppercase tracking-[0.32em] ${tone === "ink" ? "text-mute" : "text-paper/60"}`}>
          Salon · Coquitlam
        </span>
      </span>
    </span>
  );
}

export function Sparkle({ className = "" }: { className?: string }) {
  return (
    <svg viewBox="0 0 24 24" className={className} aria-hidden="true">
      <path d="M12 0c.8 6.6 5.4 11.2 12 12-6.6.8-11.2 5.4-12 12-.8-6.6-5.4-11.2-12-12C6.6 11.2 11.2 6.6 12 0z" fill="currentColor" />
    </svg>
  );
}

export function Arrow({ className = "" }: { className?: string }) {
  return (
    <svg viewBox="0 0 24 24" className={className} fill="none" stroke="currentColor" strokeWidth="1.4" aria-hidden="true">
      <path d="M4 12h15M13 6l6 6-6 6" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}
