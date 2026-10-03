/**
 * Card front designs, drawn as inline SVG on a 108 x 140 mm A2 card (viewBox units = mm).
 * These are proof mock-ups of the printed card stock; the real fronts are uploaded
 * once to the provider as custom cards (or bought blank for the plotter).
 */

export interface Design {
  id: string;
  label: string;
  paper: string;
  svg: string;
}

const GOLD = `<linearGradient id="gold" x1="0" y1="0" x2="1" y2="1">
  <stop offset="0" stop-color="#a77d43"/><stop offset=".35" stop-color="#e6cf98"/>
  <stop offset=".6" stop-color="#b8904f"/><stop offset="1" stop-color="#d9bd80"/>
</linearGradient>`;

function leaf(x: number, y: number, len: number, angle: number, fill: string, opacity = 1): string {
  const w = len * 0.42;
  return `<path transform="translate(${x} ${y}) rotate(${angle})" d="M0 0 C ${w} ${-len * 0.25}, ${w} ${-len * 0.75}, 0 ${-len} C ${-w} ${-len * 0.75}, ${-w} ${-len * 0.25}, 0 0 Z" fill="${fill}" opacity="${opacity}"/>
  <path transform="translate(${x} ${y}) rotate(${angle})" d="M0 0 L0 ${-len * 0.92}" stroke="rgba(255,255,255,.35)" stroke-width=".25" fill="none"/>`;
}

function sprig(x: number, y: number, scale: number, colour: string, flip = false): string {
  const leaves: string[] = [];
  const pts: Array<[number, number, number, number]> = [
    [0, 0, 9, -35], [1.5, -6, 8, 40], [2, -12, 8, -40], [3, -18, 7, 38], [3.2, -24, 7, -42], [3, -30, 6, 34], [2.5, -35, 5, -20],
  ];
  for (const [lx, ly, l, a] of pts) leaves.push(leaf(lx, ly, l, a, colour, 0.92));
  return `<g transform="translate(${x} ${y}) scale(${flip ? -scale : scale} ${scale})">
    <path d="M0 6 C 1 -6, 3.5 -20, 2.5 -38" stroke="${colour}" stroke-width=".7" fill="none" stroke-linecap="round"/>
    ${leaves.join("\n")}
  </g>`;
}

function eucalyptus(x: number, y: number, scale: number, colour: string): string {
  const dots: string[] = [];
  const stem: Array<[number, number, number]> = [
    [0, 0, 4.2], [3.2, -6, 3.9], [-2.6, -11, 3.6], [3, -16.5, 3.3], [-2.2, -21.5, 3], [2.4, -26, 2.6], [-1.4, -30, 2.2], [1, -33.5, 1.8],
  ];
  for (const [dx, dy, r] of stem) {
    dots.push(`<ellipse cx="${dx}" cy="${dy}" rx="${r}" ry="${r * 0.86}" fill="none" stroke="${colour}" stroke-width=".55"/>`);
  }
  return `<g transform="translate(${x} ${y}) scale(${scale})">
    <path d="M0 8 C 0.5 -6, 0.8 -22, 0.4 -36" stroke="${colour}" stroke-width=".6" fill="none" stroke-linecap="round"/>
    ${dots.join("\n")}
  </g>`;
}

function blossom(x: number, y: number, r: number, fill: string, centre: string): string {
  const petals = [0, 72, 144, 216, 288]
    .map((a) => `<ellipse cx="0" cy="${-r * 0.62}" rx="${r * 0.5}" ry="${r * 0.62}" transform="rotate(${a})" fill="${fill}"/>`)
    .join("");
  return `<g transform="translate(${x} ${y})">${petals}<circle r="${r * 0.28}" fill="${centre}"/></g>`;
}

function snowflake(x: number, y: number, r: number, colour: string): string {
  const arms = [0, 60, 120, 180, 240, 300]
    .map(
      (a) => `<g transform="rotate(${a})"><path d="M0 0 L0 ${-r}" /><path d="M0 ${-r * 0.55} L${r * 0.22} ${-r * 0.78} M0 ${-r * 0.55} L${-r * 0.22} ${-r * 0.78}"/></g>`,
    )
    .join("");
  return `<g transform="translate(${x} ${y})" stroke="${colour}" stroke-width=".45" stroke-linecap="round" fill="none">${arms}</g>`;
}

const wordmark = (colour: string, y = 128) =>
  `<text x="54" y="${y}" text-anchor="middle" font-family="Jost, 'Helvetica Neue', Arial, sans-serif" font-size="3.1" letter-spacing="1.6" fill="${colour}">CF HAIR SALON</text>
   <text x="54" y="${y + 4.6}" text-anchor="middle" font-family="Jost, 'Helvetica Neue', Arial, sans-serif" font-size="2" letter-spacing="1" fill="${colour}" opacity=".75">COQUITLAM</text>`;

const script = (text: string, y: number, size: number, fill: string, x = 54) =>
  `<text x="${x}" y="${y}" text-anchor="middle" font-family="'Pinyon Script', 'Great Vibes', cursive" font-size="${size}" fill="${fill}">${text}</text>`;

export const DESIGNS: Record<string, Design> = {
  "cf-thank-you": {
    id: "cf-thank-you",
    label: "Thank you (olive botanical)",
    paper: "#f7f2e8",
    svg: `<defs>${GOLD}</defs>
      ${sprig(30, 70, 1.05, "#56653f")}
      ${sprig(78, 66, 0.85, "#7b8a5c", true)}
      ${script("Thank you", 92, 15, "url(#gold)")}
      <path d="M38 99 C 48 101, 60 101, 70 99" stroke="url(#gold)" stroke-width=".5" fill="none"/>
      ${wordmark("#56653f")}`,
  },
  "cf-birthday": {
    id: "cf-birthday",
    label: "Birthday (blush confetti)",
    paper: "#f6e4dc",
    svg: `<defs>${GOLD}</defs>
      ${Array.from({ length: 46 }, (_, i) => {
        const x = 8 + ((i * 37) % 92);
        const y = 8 + ((i * 53) % 60);
        const c = ["url(#gold)", "#c2714f", "#8fa184", "#e3a98f"][i % 4];
        return i % 3 === 0
          ? `<rect x="${x}" y="${y}" width="2.6" height="1.1" rx=".4" transform="rotate(${(i * 47) % 180} ${x} ${y})" fill="${c}"/>`
          : `<circle cx="${x}" cy="${y}" r="${0.7 + (i % 3) * 0.35}" fill="${c}"/>`;
      }).join("")}
      ${script("Happy", 86, 13, "#b0583a")}
      ${script("Birthday", 101, 15, "url(#gold)")}
      ${wordmark("#b0583a")}`,
  },
  "cf-thinking-of-you": {
    id: "cf-thinking-of-you",
    label: "Thinking of you (sage eucalyptus)",
    paper: "#e5eadf",
    svg: `<defs>${GOLD}</defs>
      ${eucalyptus(26, 60, 1.1, "#4f6a52")}
      ${eucalyptus(54, 52, 1.25, "#3f5843")}
      ${eucalyptus(82, 62, 1.0, "#5d7a60")}
      ${script("Thinking", 86, 13, "#3f5843")}
      ${script("of you", 100, 13, "#3f5843")}
      ${wordmark("#3f5843")}`,
  },
  "cf-gratitude": {
    id: "cf-gratitude",
    label: "With gratitude (champagne arch)",
    paper: "#f1e9da",
    svg: `<defs>${GOLD}</defs>
      <path d="M24 112 L24 52 A30 30 0 0 1 84 52 L84 112" stroke="url(#gold)" stroke-width=".8" fill="none"/>
      <path d="M27.5 112 L27.5 52.5 A26.5 26.5 0 0 1 80.5 52.5 L80.5 112" stroke="url(#gold)" stroke-width=".3" fill="none"/>
      ${sprig(42, 50, 0.6, "#8a7a55")}
      ${sprig(66, 50, 0.6, "#8a7a55", true)}
      ${script("with", 76, 10, "#6f5f3d")}
      ${script("gratitude", 92, 15, "url(#gold)")}
      ${wordmark("#6f5f3d")}`,
  },
  "cf-referral": {
    id: "cf-referral",
    label: "Thank you, friend (terracotta)",
    paper: "#f2dfd2",
    svg: `<defs>${GOLD}</defs>
      ${blossom(40, 48, 6, "#c97b5a", "#f2dfd2")}
      ${blossom(64, 44, 7.5, "#b3613f", "#f6e7dc")}
      ${blossom(54, 60, 4.5, "#d9997b", "#f2dfd2")}
      ${leaf(46, 64, 9, -50, "#7b8a5c")}
      ${leaf(62, 64, 9, 50, "#7b8a5c")}
      ${script("Thank you,", 88, 13, "#9b4f31")}
      ${script("friend", 103, 15, "url(#gold)")}
      ${wordmark("#9b4f31")}`,
  },
  "cf-lunar-new-year": {
    id: "cf-lunar-new-year",
    label: "Lunar New Year (red and gold)",
    paper: "#9f1d20",
    svg: `<defs>${GOLD}</defs>
      <rect x="6" y="6" width="96" height="128" fill="none" stroke="url(#gold)" stroke-width=".6"/>
      <path d="M14 30 C 30 26, 34 18, 46 16 M30 25 C 34 30, 40 31, 44 30" stroke="#5a1111" stroke-width="1" fill="none" stroke-linecap="round"/>
      ${blossom(22, 27, 3.2, "#f4c6c2", "url(#gold)")}${blossom(36, 21, 2.6, "#f9dcd8", "url(#gold)")}${blossom(46, 15.5, 2.2, "#f4c6c2", "url(#gold)")}
      ${blossom(42, 30, 2.4, "#f9dcd8", "url(#gold)")}
      <text x="54" y="74" text-anchor="middle" font-family="'Ma Shan Zheng', serif" font-size="20" fill="url(#gold)">新年快乐</text>
      ${script("Happy Lunar New Year", 92, 9.5, "#f3dfb0")}
      <text x="54" y="101" text-anchor="middle" font-family="Jost, Arial, sans-serif" font-size="2.6" letter-spacing="1.2" fill="#f3dfb0">YEAR OF THE GOAT</text>
      ${wordmark("#f3dfb0")}`,
  },
  "cf-holiday": {
    id: "cf-holiday",
    label: "Season's greetings (midnight)",
    paper: "#1f2a44",
    svg: `<defs>${GOLD}</defs>
      ${snowflake(28, 36, 7, "#e6cf98")}${snowflake(78, 30, 5, "#c9d3e6")}${snowflake(56, 52, 9, "#e6cf98")}
      ${snowflake(20, 60, 3.5, "#c9d3e6")}${snowflake(88, 56, 4, "#e6cf98")}
      ${script("Season's", 86, 13, "url(#gold)")}
      ${script("greetings", 101, 14, "url(#gold)")}
      ${wordmark("#c9d3e6")}`,
  },
};

export function designFor(id: string): Design {
  return DESIGNS[id] ?? DESIGNS["cf-thank-you"];
}
