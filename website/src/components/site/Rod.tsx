import { rodColour } from "@/lib/rods";

/**
 * A perm rod drawn small: a rounded rod in the category colour with a thin
 * outline and the elastic band across it. Decorative: the category name is
 * always written next to it.
 */
export function Rod({ category, className = "" }: { category: string; className?: string }) {
  return (
    <svg viewBox="0 0 40 14" className={`h-3.5 w-10 shrink-0 ${className}`} aria-hidden="true" focusable="false">
      <rect x="0.75" y="0.75" width="38.5" height="12.5" rx="6.25" fill={rodColour(category)} stroke="#000" strokeWidth="1.5" />
      <path d="M29 1.5v11" stroke="#000" strokeWidth="1.5" />
    </svg>
  );
}
