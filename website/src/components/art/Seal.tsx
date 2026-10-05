import { useId } from "react";

/*
 * The salon's seal (印章): a square chop in the logo red with "CF" cut into it, the
 * way a 白文 (intaglio, 阴刻) seal prints. The letters are knocked out of the
 * square, so whatever is under the seal shows through them, like paper under a
 * stamp. The edge wobbles very slightly and has two small nicks, as a carved
 * stone does; there is no texture, so it stays crisp from 24px to 64px.
 *
 * Not the logo (that is Logo.tsx, from the storefront sign). The seal is used
 * only as a stamp: on the booking confirmation and on the handwritten card
 * mock-ups in the admin. Its ink is the logo red, as red seal ink is.
 *
 * TODO(owner): the salon's Chinese name is not confirmed. Once the owner gives
 * it, the seal can carry those characters (two or four, read top to bottom,
 * right to left) in place of the Latin "CF". Until then it holds no Chinese
 * characters. See "Cultural details" in docs/design-plan.md.
 */

/** viewBox units (0 to 100). */
export const SEAL_EDGE =
  "M9.4 4.6Q30 3.7 52 4.4T90.8 4.9Q95.6 5 95.5 9.6L95.9 31L94.5 32.6L95.9 34.2Q96.3 52 95.8 70T95.1 90.4Q94.9 95.3 90 95.4L33.4 95.9L31.8 94.6L30.2 95.9Q18 96 9.8 95.6Q4.5 95.3 4.6 90.6Q3.8 70 4.2 48T4.9 9.6Q5.1 4.8 9.4 4.6Z";
/** "C" and "F" as monoline strokes, as wide as the border around them (10.5 units), on a 70-unit field. */
export const SEAL_LETTERS = "M47 20.25H26.25Q20.25 20.25 20.25 26.25V73.75Q20.25 79.75 26.25 79.75H47M58.25 85V20.25H85M58.25 50H80";
export const SEAL_STROKE = 10.5;

export function Seal({
  size = 40,
  paper,
  decorative = false,
  className = "",
  style,
}: {
  /** Rendered size in px (the seal is square). */
  size?: number;
  /** Fill the cut letters with this colour instead of letting the background show (use on dark areas). */
  paper?: string;
  /** True when the salon's name is already written next to the seal, so it is not read twice. */
  decorative?: boolean;
  className?: string;
  style?: React.CSSProperties;
}) {
  const id = `seal-${useId().replace(/[^a-zA-Z0-9_-]/g, "")}`;
  const a11y = decorative ? { "aria-hidden": true as const } : { role: "img", "aria-label": "CF Hair Salon" };
  return (
    <svg
      viewBox="0 0 100 100"
      width={size}
      height={size}
      className={`shrink-0 ${className}`}
      style={style}
      focusable="false"
      {...a11y}
    >
      <mask id={id} maskUnits="userSpaceOnUse" x="0" y="0" width="100" height="100">
        <rect width="100" height="100" fill="#fff" />
        <path d={SEAL_LETTERS} fill="none" stroke="#000" strokeWidth={SEAL_STROKE} strokeLinejoin="miter" />
      </mask>
      {paper && <path d={SEAL_LETTERS} fill="none" stroke={paper} strokeWidth={SEAL_STROKE - 0.5} />}
      <path d={SEAL_EDGE} fill="var(--color-logo, #9B2226)" mask={`url(#${id})`} />
    </svg>
  );
}
