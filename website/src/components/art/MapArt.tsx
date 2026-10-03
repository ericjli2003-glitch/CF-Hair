/** Stylised (not to scale) neighbourhood sketch for the Visit section. */
export function MapArt({ className = "", dark = false }: { className?: string; dark?: boolean }) {
  const road = dark ? "rgba(251,248,243,0.22)" : "rgba(29,25,21,0.16)";
  const roadStrong = dark ? "rgba(251,248,243,0.4)" : "rgba(29,25,21,0.3)";
  const text = dark ? "rgba(251,248,243,0.6)" : "rgba(29,25,21,0.55)";
  return (
    <svg viewBox="0 0 400 300" className={className} aria-hidden="true">
      <defs>
        <pattern id="mapDots" width="14" height="14" patternUnits="userSpaceOnUse">
          <circle cx="1" cy="1" r="0.9" fill={road} />
        </pattern>
      </defs>
      <rect width="400" height="300" fill="url(#mapDots)" />
      <path d="M0 210 C 90 200, 160 185, 400 150" stroke={road} strokeWidth="10" fill="none" />
      <path d="M0 95 L 400 70" stroke={road} strokeWidth="6" fill="none" />
      <path d="M210 0 C 205 90, 200 180, 190 300" stroke={roadStrong} strokeWidth="9" fill="none" />
      <path d="M320 0 L 300 300" stroke={road} strokeWidth="5" fill="none" />
      <path d="M40 300 C 120 230, 240 140, 400 110" stroke="var(--color-champagne)" strokeWidth="2.5" strokeDasharray="7 6" fill="none" />
      <rect x="226" y="100" width="88" height="40" rx="6" fill={dark ? "rgba(251,248,243,0.08)" : "rgba(29,25,21,0.05)"} stroke={road} />
      <text x="270" y="123" textAnchor="middle" fontSize="7" fill={text} letterSpacing="1.2" style={{ fontFamily: "var(--font-sans)", textTransform: "uppercase" }}>
        Coquitlam Centre
      </text>
      <text x="218" y="22" fontSize="9" fill={text} letterSpacing="1.5" transform="rotate(88 218 22)" style={{ fontFamily: "var(--font-sans)", textTransform: "uppercase" }}>
        Pinetree Way
      </text>
      <circle cx="146" cy="203" r="6" fill={dark ? "var(--color-espresso)" : "var(--color-paper)"} stroke="var(--color-champagne)" strokeWidth="2.5" />
      <text x="96" y="232" fontSize="9" fill={text} letterSpacing="1.5" style={{ fontFamily: "var(--font-sans)", textTransform: "uppercase" }}>
        Lincoln Stn
      </text>
      <g transform="translate(174 150)">
        <circle r="26" fill="var(--color-clay)" opacity="0.18" />
        <circle r="14" fill="var(--color-clay)" opacity="0.28" />
        <path d="M0 -18 C 10 -18, 14 -10, 14 -5 C 14 5, 0 16, 0 16 C 0 16, -14 5, -14 -5 C -14 -10, -10 -18, 0 -18 Z" fill="var(--color-clay)" />
        <circle cy="-5" r="4.5" fill="var(--color-paper)" />
      </g>
      <text x="122" y="132" fontSize="12" fill={dark ? "var(--color-paper)" : "var(--color-ink)"} style={{ fontFamily: "var(--font-cormorant), serif", fontStyle: "italic" }}>
        Henderson Place
      </text>
    </svg>
  );
}
