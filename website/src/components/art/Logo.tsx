/*
 * The salon's logo, recreated from their storefront sign in Henderson Place: a
 * large Didone "CF" in brick red, set tight, with "Hair Salon" to its lower
 * right in widely spaced geometric capitals (H and S full height, the rest a
 * size smaller), where the O of SALON is a small solid red square.
 *
 * TODO(owner): this is a faithful recreation from a photo of the sign, not the
 * original artwork. When the owner sends their logo file (SVG, AI or a
 * high-resolution PNG), replace this component and the icons drawn from it
 * (src/app/icon.svg, apple-icon.png, favicon.ico). See "Logo" in
 * docs/design-plan.md.
 *
 * The logo red (--color-logo) is a brand colour for the logo and the seal only,
 * never for buttons, links or text in the interface.
 *
 * "CF" is a vector path, the outlines of Bodoni Moda ExtraBold (wght 800,
 * opsz 28, tracked -25/1000) converted with fontTools, so no serif webfont is
 * downloaded and the favicon uses the same drawing. "Hair Salon" is live text
 * in Jost Medium (next/font, layout.tsx).
 */

/** CF outlines, y down, in a 2490 x 1540 box. The baseline is at y 1520, the cap height 1500. */
export const CF_PATH =
  "M738.5 1540Q506.2 1540 341.1 1440.3Q176 1340.7 88 1166.7Q0 992.7 0 770Q0 547 88 373.2Q176 199.3 341.1 99.7Q506.2 0 738.5 0Q828.2 0 902.5 30.4Q976.8 60.8 1036.5 116.5L1240.4 20H1253.9V474.1H1236.1Q1186 343 1116.9 241Q1047.7 139.1 958.6 80.9Q869.5 22.8 758.5 22.8Q655.6 22.8 587 87.3Q518.5 151.9 479 259.9Q439.5 368 422.5 500.5Q405.6 633.1 405.6 770Q405.6 906 422.5 1039Q439.5 1172 479 1280.1Q518.5 1388.1 587 1452.7Q655.6 1517.2 758.5 1517.2Q859.2 1517.2 937.4 1482Q1015.6 1446.9 1075.8 1384.7Q1135.9 1322.5 1180.4 1240.7Q1224.9 1158.9 1257.4 1065.9H1274.1V1520H1260.2L1073.8 1413Q1010.3 1472.5 926.6 1506.3Q842.9 1540 738.5 1540ZM2204.4 1042.6Q2182.4 975.6 2142.2 915.8Q2101.9 856.1 2044.7 818.8Q1987.5 781.6 1915.4 781.6H1785V766.4H1915.2Q1987.5 766.4 2044.7 731.7Q2101.9 697 2142.2 640Q2182.4 583 2204.4 515.8H2219.5V1042.6ZM2490.4 20V430H2475.1Q2453.2 323 2399.9 233.2Q2346.6 143.3 2264 89.2Q2181.3 35 2071.6 35H1887.6V1505H2087.5V1520H1341.6V1505H1521.5V35H1341.6V20Z";
export const CF_W = 2490;
export const CF_H = 1540;



type Props = {
  /** Height of "CF" in px (about its cap height); the rest scales from it. */
  size?: number;
  /** "full": CF and Hair Salon. "compact": CF only. "responsive": CF only below 1024px, full above. */
  variant?: "full" | "compact" | "responsive";
  /** Light on deep green: CF and Hair Salon in board white, the square in light terracotta. */
  onDark?: boolean;
  /** True when the salon's name is already given nearby, so it is not read twice. */
  decorative?: boolean;
  className?: string;
};

export function Logo({ size = 30, variant = "full", onDark = false, decorative = false, className = "" }: Props) {
  const a11y = decorative ? { "aria-hidden": true as const } : { role: "img", "aria-label": "CF Hair Salon" };
  const words = variant === "compact" ? null : variant === "responsive" ? "hidden lg:block" : "block";
  return (
    <span {...a11y} className={`inline-flex shrink-0 items-start leading-none ${className}`}>
      <svg
        viewBox={`0 0 ${CF_W} ${CF_H}`}
        width={Math.round((size * CF_W) / CF_H)}
        height={size}
        className={`block shrink-0 ${onDark ? "text-board" : "text-logo"}`}
        aria-hidden="true"
        focusable="false"
      >
        <path d={CF_PATH} fill="currentColor" />
      </svg>
      {words && (
        <span
          className={`${words} whitespace-nowrap font-logo-sans font-medium uppercase ${onDark ? "text-board" : "text-ink"}`}
          // Lower right of CF, as on the sign: the capitals start a little above
          // CF's baseline and hang below it.
          style={{ fontSize: 0.43 * size, lineHeight: 1, letterSpacing: "0.34em", marginTop: 0.74 * size, marginLeft: 0.17 * size }}
        >
          H<SmallCaps>air</SmallCaps> S<SmallCaps>al</SmallCaps>
          <SmallCaps>
            <span className={`inline-block h-[0.68em] w-[0.68em] ${onDark ? "bg-logo-mark-dark" : "bg-logo"}`} style={{ marginRight: "0.34em" }} />
            n
          </SmallCaps>
        </span>
      )}
    </span>
  );
}

/** H and S are full capitals; the other letters are a size smaller, as on the sign. */
function SmallCaps({ children }: { children: React.ReactNode }) {
  return <span className="text-[0.8em]">{children}</span>;
}
