// The admin's few icons, drawn as SVG in one stroke weight. They are always
// decorative: the control around them carries the accessible name.
const base = { viewBox: "0 0 24 24", fill: "none", stroke: "currentColor", strokeWidth: 2, strokeLinecap: "round", strokeLinejoin: "round" } as const;

export function ChevronIcon({ dir, className = "h-5 w-5" }: { dir: "left" | "right"; className?: string }) {
  return (
    <svg {...base} className={className} aria-hidden="true" focusable="false">
      <path d={dir === "left" ? "M15 5l-7 7 7 7" : "M9 5l7 7-7 7"} />
    </svg>
  );
}

export function CloseIcon({ className = "h-5 w-5" }: { className?: string }) {
  return (
    <svg {...base} className={className} aria-hidden="true" focusable="false">
      <path d="M6 6l12 12M18 6L6 18" />
    </svg>
  );
}
