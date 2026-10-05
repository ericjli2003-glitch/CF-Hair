import { useId } from "react";

/*
 * A window-screen lattice (窗格): a square grid with a smaller square set in each
 * cell and tied to the grid at its midpoints, the plain straight-line pattern of
 * a garden window. Purely decorative, always aria-hidden, drawn in hairlines at
 * low contrast. Used in one place, the public footer's texture; the rules allow
 * one more thin band at most (see "Cultural details" in docs/design-plan.md).
 */
export function Lattice({
  cell = 24,
  stroke = "currentColor",
  opacity = 1,
  className = "",
}: {
  /** Size of one lattice cell in px. */
  cell?: number;
  stroke?: string;
  opacity?: number;
  className?: string;
}) {
  const id = `lattice-${useId().replace(/[^a-zA-Z0-9_-]/g, "")}`;
  const q = cell / 4;
  const h = cell / 2;
  // Lines on the cell's top and left edges (the next cell draws the others),
  // the inner square, and the four ties.
  const d = [
    `M0 0.5H${cell}M0.5 0V${cell}`,
    `M${q} ${q}H${cell - q}V${cell - q}H${q}Z`,
    `M${h} 0V${q}M${h} ${cell - q}V${cell}M0 ${h}H${q}M${cell - q} ${h}H${cell}`,
  ].join("");
  return (
    <svg aria-hidden="true" focusable="false" className={`pointer-events-none block ${className}`} width="100%" height="100%">
      <defs>
        <pattern id={id} width={cell} height={cell} patternUnits="userSpaceOnUse">
          <path d={d} fill="none" stroke={stroke} strokeWidth="1" strokeOpacity={opacity} shapeRendering="crispEdges" />
        </pattern>
      </defs>
      <rect width="100%" height="100%" fill={`url(#${id})`} />
    </svg>
  );
}
