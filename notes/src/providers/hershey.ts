/**
 * Single-stroke (Hershey / EMS) SVG font renderer for pen plotters.
 *
 * Plotters draw centre-lines, so outline fonts would be traced twice. These fonts
 * are single-line glyphs, the same family the AxiDraw "Hershey Text" Inkscape
 * extension uses. We lay text out in millimetres and add small, seeded
 * irregularities (baseline drift, glyph tilt, size and spacing variation) so the
 * result does not look machine-perfect.
 */
import { readFileSync } from "node:fs";
import path from "node:path";
import { NOTES_ROOT } from "../config.js";

export const PLOTTER_FONTS = {
  "ems-readability-italic": "EMSReadabilityItalic.svg",
  "ems-readability": "EMSReadability.svg",
  "ems-allure": "EMSAllure.svg",
  "ems-felix": "EMSFelix.svg",
  "hershey-script": "HersheyScript1.svg",
} as const;
export type PlotterFontName = keyof typeof PLOTTER_FONTS;

interface Glyph {
  adv: number;
  /** Polylines/curves in font units, y up. Each command: [op, ...coords]. */
  cmds: Array<[string, ...number[]]>;
}

export interface StrokeFont {
  name: string;
  unitsPerEm: number;
  capHeight: number;
  xHeight: number;
  defaultAdv: number;
  glyphs: Map<string, Glyph>;
}

const fontCache = new Map<string, StrokeFont>();

function decodeEntities(s: string): string {
  return s
    .replace(/&#x([0-9a-f]+);/gi, (_, h) => String.fromCodePoint(parseInt(h, 16)))
    .replace(/&#(\d+);/g, (_, d) => String.fromCodePoint(parseInt(d, 10)))
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&amp;/g, "&");
}

function parsePath(d: string): Glyph["cmds"] {
  const tokens = d.match(/[MLC]|-?\d*\.?\d+(?:e-?\d+)?/gi) ?? [];
  const cmds: Glyph["cmds"] = [];
  let op = "";
  let nums: number[] = [];
  const flush = () => {
    if (!op) return;
    const per = op === "C" ? 6 : 2;
    for (let i = 0; i + per <= nums.length; i += per) {
      // Implicit repeats after M are line-tos.
      cmds.push([i > 0 && op === "M" ? "L" : op, ...nums.slice(i, i + per)]);
    }
    nums = [];
  };
  for (const t of tokens) {
    if (/^[MLC]$/i.test(t)) {
      flush();
      op = t.toUpperCase();
    } else nums.push(parseFloat(t));
  }
  flush();
  return cmds;
}

export function loadStrokeFont(name: PlotterFontName = "ems-readability-italic"): StrokeFont {
  const hit = fontCache.get(name);
  if (hit) return hit;
  const file = path.join(NOTES_ROOT, "assets", "plotter-fonts", PLOTTER_FONTS[name]);
  const svg = readFileSync(file, "utf8");
  const num = (re: RegExp, dflt: number) => {
    const m = re.exec(svg);
    return m ? parseFloat(m[1]) : dflt;
  };
  const font: StrokeFont = {
    name,
    unitsPerEm: num(/units-per-em="([\d.]+)"/, 1000),
    capHeight: num(/cap-height="([\d.]+)"/, 500),
    xHeight: num(/x-height="([\d.]+)"/, 300),
    defaultAdv: num(/<font[^>]*horiz-adv-x="([\d.]+)"/, 378),
    glyphs: new Map(),
  };
  const glyphRe = /<glyph\b([^>]*)\/?>/g;
  let m: RegExpExecArray | null;
  while ((m = glyphRe.exec(svg))) {
    const attrs = m[1];
    const uni = /unicode="([^"]*)"/.exec(attrs);
    if (!uni) continue;
    const ch = decodeEntities(uni[1]);
    const adv = /horiz-adv-x="([\d.]+)"/.exec(attrs);
    const d = /\sd="([^"]*)"/.exec(attrs);
    font.glyphs.set(ch, { adv: adv ? parseFloat(adv[1]) : font.defaultAdv, cmds: d ? parsePath(d[1]) : [] });
  }
  fontCache.set(name, font);
  return font;
}

/** Mulberry32: tiny seeded PRNG so the same note always plots identically. */
export function rng(seed: string): () => number {
  let a = 0;
  for (let i = 0; i < seed.length; i++) a = (Math.imul(a ^ seed.charCodeAt(i), 2654435761) + i) >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export interface LayoutOptions {
  font?: PlotterFontName;
  /** Cap height in mm. 3.2 to 4 mm reads like ballpoint handwriting on an A2 card. */
  capHeightMm: number;
  /** Line pitch as a multiple of cap height. */
  lineSpacing?: number;
  maxWidthMm: number;
  maxHeightMm?: number;
  originMm: { x: number; y: number };
  seed: string;
  /** 0 = machine perfect, 1 = default human wobble. */
  jitter?: number;
}

export interface LayoutResult {
  paths: string[];
  lines: number;
  widthMm: number;
  heightMm: number;
  fits: boolean;
  missing: string[];
}

function advanceOf(font: StrokeFont, ch: string): number {
  return (font.glyphs.get(ch) ?? font.glyphs.get("?"))?.adv ?? font.defaultAdv;
}

/** Greedy word wrap using glyph advances, honouring explicit newlines. */
export function wrapText(text: string, font: StrokeFont, scale: number, maxWidthMm: number): string[] {
  const lines: string[] = [];
  const spaceW = advanceOf(font, " ") * scale;
  for (const para of text.split("\n")) {
    const words = para.split(/\s+/).filter(Boolean);
    if (words.length === 0) {
      lines.push("");
      continue;
    }
    let line = "";
    let width = 0;
    for (const w of words) {
      const ww = [...w].reduce((s, ch) => s + advanceOf(font, ch) * scale, 0);
      if (line && width + spaceW + ww > maxWidthMm) {
        lines.push(line);
        line = w;
        width = ww;
      } else {
        line = line ? `${line} ${w}` : w;
        width = line === w ? ww : width + spaceW + ww;
      }
    }
    lines.push(line);
  }
  return lines;
}

const f2 = (n: number) => (Math.round(n * 100) / 100).toString();

/** Lay out text as SVG path data in millimetres (y down). */
export function layoutText(text: string, opts: LayoutOptions): LayoutResult {
  const font = loadStrokeFont(opts.font);
  const scale = opts.capHeightMm / font.capHeight;
  const pitch = opts.capHeightMm * (opts.lineSpacing ?? 2.3);
  const jitter = opts.jitter ?? 1;
  const rand = rng(opts.seed);
  const r = (amp: number) => (rand() * 2 - 1) * amp * jitter;
  const lines = wrapText(text, font, scale, opts.maxWidthMm);
  const paths: string[] = [];
  const missing = new Set<string>();
  let maxW = 0;

  lines.forEach((line, li) => {
    const slope = (r(0.6) * Math.PI) / 180; // whole-line tilt
    const indent = r(0.8);
    let x = opts.originMm.x + Math.max(0, indent);
    const baseY = opts.originMm.y + opts.capHeightMm + li * pitch + r(0.35);
    let drift = 0;
    const segs: string[] = [];
    for (const ch of line) {
      const g = font.glyphs.get(ch);
      if (!g) {
        missing.add(ch);
        x += font.defaultAdv * scale;
        continue;
      }
      drift += r(0.08);
      drift = Math.max(-0.35, Math.min(0.35, drift));
      const s = scale * (1 + r(0.035));
      const rot = (r(1.6) * Math.PI) / 180;
      const cos = Math.cos(rot);
      const sin = Math.sin(rot);
      const y0 = baseY + (x - opts.originMm.x) * Math.tan(slope) + drift;
      const tx = (px: number, py: number): [number, number] => {
        const gx = px * s;
        const gy = -py * s; // font y-up to SVG y-down
        return [x + gx * cos - gy * sin, y0 + gx * sin + gy * cos];
      };
      for (const [op, ...c] of g.cmds) {
        if (op === "C") {
          const [a, b] = tx(c[0], c[1]);
          const [d, e] = tx(c[2], c[3]);
          const [f, h] = tx(c[4], c[5]);
          segs.push(`C${f2(a)} ${f2(b)} ${f2(d)} ${f2(e)} ${f2(f)} ${f2(h)}`);
        } else {
          const [px, py] = tx(c[0], c[1]);
          segs.push(`${op}${f2(px)} ${f2(py)}`);
        }
      }
      x += g.adv * s * (1 + r(0.04));
    }
    if (segs.length) paths.push(segs.join(""));
    maxW = Math.max(maxW, x - opts.originMm.x);
  });

  const heightMm = lines.length ? opts.capHeightMm + (lines.length - 1) * pitch + opts.capHeightMm * 0.6 : 0;
  return {
    paths,
    lines: lines.length,
    widthMm: maxW,
    heightMm,
    fits: maxW <= opts.maxWidthMm + 0.5 && (opts.maxHeightMm == null || heightMm <= opts.maxHeightMm),
    missing: [...missing],
  };
}
