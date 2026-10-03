/**
 * Fonts for the proof sheet, embedded so the page renders identically offline
 * (e.g. on a laptop at a sales meeting).
 * - Latin fonts are vendored in assets/web-fonts (all SIL Open Font License, from Google Fonts).
 * - Korean uses Nanum Pen Script (a pen handwriting face) the same way.
 * - Chinese fonts (LXGW WenKai for pen-style handwriting; it draws Simplified forms correctly,
 *   unlike Long Cang which writes 时 as 時) are large, so we ask Google Fonts for a subset containing only the
 *   characters this proof uses (the css2 `text=` parameter) and cache it under out/.fontcache.
 *   If that fails (offline), the page falls back to a normal Google Fonts <link>.
 */
import { createHash } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { NOTES_ROOT, OUT_DIR } from "../config.js";

const LATIN: Array<{ family: string; file: string; weight: string; style?: string }> = [
  { family: "Caveat", file: "caveat-latin.woff2", weight: "400 700" },
  { family: "Pinyon Script", file: "pinyon-script-latin.woff2", weight: "400" },
  { family: "Jost", file: "jost-latin.woff2", weight: "300 600" },
  { family: "Cormorant Garamond", file: "cormorant-garamond-500-latin.woff2", weight: "500" },
  { family: "Cormorant Garamond", file: "cormorant-garamond-500i-latin.woff2", weight: "500", style: "italic" },
];

// Han fonts get the Chinese characters; Nanum Pen Script (a real-pen Korean hand) gets Hangul.
const HAN_FAMILIES = ["LXGW WenKai TC", "Ma Shan Zheng", "Noto Sans SC"];
const HANGUL_FAMILIES = ["Nanum Pen Script"];
const UA = "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/140.0 Safari/537.36";

export function latinFontFaces(): string {
  return LATIN.map((f) => {
    const data = readFileSync(path.join(NOTES_ROOT, "assets", "web-fonts", f.file)).toString("base64");
    return `@font-face { font-family: "${f.family}"; font-style: ${f.style ?? "normal"}; font-weight: ${f.weight}; font-display: block; src: url(data:font/woff2;base64,${data}) format("woff2"); }`;
  }).join("\n");
}

function charsMatching(text: string, re: RegExp): string {
  const set = new Set<string>();
  for (const ch of text) if (re.test(ch)) set.add(ch);
  return [...set].sort().join("");
}
const HAN_RE = /[\u2E80-\u9FFF\uF900-\uFAFF\uFF00-\uFFEF\u3000-\u303F]/;
const HANGUL_RE = /[\uAC00-\uD7AF\u1100-\u11FF\u3130-\u318F]/;

async function fetchSubset(family: string, chars: string): Promise<string> {
  const key = createHash("sha1").update(`${family}|${chars}`).digest("hex").slice(0, 16);
  const cacheDir = path.join(OUT_DIR, ".fontcache");
  const cacheFile = path.join(cacheDir, `${key}.css`);
  if (existsSync(cacheFile)) return readFileSync(cacheFile, "utf8");
  const cssUrl = `https://fonts.googleapis.com/css2?family=${encodeURIComponent(family).replace(/%20/g, "+")}&text=${encodeURIComponent(chars)}`;
  const css = await (await fetch(cssUrl, { headers: { "User-Agent": UA }, signal: AbortSignal.timeout(8000) })).text();
  const faces: string[] = [];
  for (const block of css.match(/@font-face\s*{[^}]*}/g) ?? []) {
    const url = /url\((https:[^)]+)\)/.exec(block)?.[1];
    if (!url) continue;
    const res = await fetch(url, { headers: { "User-Agent": UA }, signal: AbortSignal.timeout(8000) });
    if (!res.ok) throw new Error(`font download ${res.status}`);
    const b64 = Buffer.from(await res.arrayBuffer()).toString("base64");
    faces.push(block.replace(/url\([^)]+\)/, `url(data:font/woff2;base64,${b64})`).replace(/font-display:[^;]+;/, "").replace("{", "{ font-display: block;"));
  }
  if (!faces.length) throw new Error("no font faces returned");
  const out = faces.join("\n");
  mkdirSync(cacheDir, { recursive: true });
  writeFileSync(cacheFile, out);
  return out;
}

export interface FontBundle {
  css: string;
  /** <link> fallback when Chinese subsets could not be embedded. */
  fallbackLink?: string;
}

export async function buildFonts(textForAlt: string): Promise<FontBundle> {
  const css = [latinFontFaces()];
  // Tag labels and the Lunar New Year card front are always on the page.
  const sample = `${textForAlt}\u4E2D\u6587\u7B80\u4F53\u7E41\u9AD4\u65B0\u5E74\u5FEB\u4E50\uD55C\uAD6D\uC5B4`;
  const jobs: Array<[string, string]> = [
    ...HAN_FAMILIES.map((f): [string, string] => [f, charsMatching(sample, HAN_RE)]),
    ...HANGUL_FAMILIES.map((f): [string, string] => [f, charsMatching(sample, HANGUL_RE)]),
  ];
  let failed = false;
  for (const [family, chars] of jobs) {
    if (!chars) continue;
    try {
      css.push(await fetchSubset(family, chars));
    } catch {
      failed = true;
    }
  }
  return {
    css: css.join("\n"),
    fallbackLink: failed
      ? `<link href="https://fonts.googleapis.com/css2?family=LXGW+WenKai+TC&family=Ma+Shan+Zheng&family=Noto+Sans+SC:wght@400;500&family=Nanum+Pen+Script&display=block" rel="stylesheet">`
      : undefined,
  };
}
