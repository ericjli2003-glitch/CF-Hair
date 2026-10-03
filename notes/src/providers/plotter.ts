/**
 * In-house pen plotter adapter (AxiDraw or any SVG-driven plotter).
 *
 * "Sending" writes two single-stroke SVGs per card, sized in millimetres:
 *   <noteId>-inside.svg    A2 card inside panel, 108 x 140 mm (4.25 x 5.5 in)
 *   <noteId>-envelope.svg  A2 envelope, 146 x 111 mm (5.75 x 4.375 in)
 * Plot with Evil Mad Scientist's CLI, e.g. `axicli <file>.svg`, or open in Inkscape.
 * Stamp with a Canada Post Permanent stamp and drop in the mailbox.
 *
 * Chinese and Korean cannot be plotted with Hershey fonts; those cards are listed in
 * hand-finish.txt for a team member to add the second-language lines by hand.
 */
import { appendFileSync, mkdirSync, writeFileSync } from "node:fs";
import path from "node:path";
import { providerSettings, salonReturnAddress } from "../config.js";
import { ALT_LABEL } from "../language.js";
import { charCount } from "../text.js";
import { layoutText, type PlotterFontName } from "./hershey.js";
import type { ProviderAdapter, SendContext, SendItem, SendResult } from "./types.js";

export const CARD_MM = { w: 108, h: 140 };
export const ENVELOPE_MM = { w: 146, h: 111 };
const MARGIN = 11;

export interface PlotterOptions {
  outDir: string;
  font?: PlotterFontName;
}

function svgDoc(w: number, h: number, title: string, paths: string[], penMm = 0.4): string {
  return `<?xml version="1.0" encoding="UTF-8"?>
<svg xmlns="http://www.w3.org/2000/svg" width="${w}mm" height="${h}mm" viewBox="0 0 ${w} ${h}">
  <title>${title.replace(/[<&>]/g, "")}</title>
  <g fill="none" stroke="#1d2a5c" stroke-width="${penMm}" stroke-linecap="round" stroke-linejoin="round">
${paths.map((d) => `    <path d="${d}"/>`).join("\n")}
  </g>
</svg>
`;
}

export interface CardLayout {
  inside: string;
  envelope: string;
  fits: boolean;
  problems: string[];
  capHeightMm: number;
}

/** Lay out a card, shrinking the writing a little if needed (like a person writing smaller near the edge). */
export function layoutCard(item: SendItem, font: PlotterFontName = "ems-felix", envelopeFont: PlotterFontName = "ems-readability-italic"): CardLayout {
  const problems: string[] = [];
  const width = CARD_MM.w - 2 * MARGIN;
  let chosen: ReturnType<typeof layoutText> | undefined;
  let sig: ReturnType<typeof layoutText> | undefined;
  let cap = 3.6;
  for (; cap >= 2.7; cap -= 0.15) {
    const body = layoutText(item.message, {
      font,
      capHeightMm: cap,
      maxWidthMm: width,
      originMm: { x: MARGIN, y: MARGIN + 6 },
      seed: item.note.noteId,
    });
    const sigTop = MARGIN + 6 + body.heightMm + cap * 1.6;
    const signature = layoutText(item.signature, {
      font,
      capHeightMm: cap,
      maxWidthMm: width * 0.55,
      originMm: { x: MARGIN + width * 0.42, y: sigTop },
      seed: `${item.note.noteId}-sig`,
    });
    const bottom = sigTop + signature.heightMm;
    chosen = body;
    sig = signature;
    if (body.fits && signature.fits && bottom <= CARD_MM.h - MARGIN) break;
  }
  const bodyFits = !!chosen && !!sig && chosen.fits && sig.fits;
  const bottom = chosen && sig ? MARGIN + 6 + chosen.heightMm + cap * 1.6 + sig.heightMm : Infinity;
  const fits = bodyFits && bottom <= CARD_MM.h - MARGIN;
  if (!fits) problems.push("message does not fit on the card at the smallest legible size");
  const missing = new Set([...(chosen?.missing ?? []), ...(sig?.missing ?? [])]);
  if (missing.size) problems.push(`plotter font has no glyph for: ${[...missing].join(" ")}`);

  // Envelope: return address top-left (small), recipient centred-left (larger).
  const from = salonReturnAddress();
  const ret = layoutText(`${from.name}\n${from.line1}\n${from.city} ${from.province}  ${from.postalCode}`, {
    font: envelopeFont,
    capHeightMm: 2.2,
    lineSpacing: 2.5,
    maxWidthMm: 70,
    originMm: { x: 8, y: 7 },
    seed: `${item.note.noteId}-ret`,
  });
  const a = item.address;
  const recipientLines = [
    `${item.note.recipient.firstName} ${item.note.recipient.lastName}`.trim(),
    a.line2 ? `${a.line2}` : "",
    a.line1,
    `${a.city} ${a.province}  ${a.postalCode}`,
  ].filter(Boolean);
  const to = layoutText(recipientLines.join("\n"), {
    font: envelopeFont,
    capHeightMm: 3.8,
    lineSpacing: 2.0,
    maxWidthMm: 80,
    originMm: { x: 50, y: 50 },
    seed: `${item.note.noteId}-to`,
  });
  if (!to.fits) problems.push("address too wide for the envelope");

  return {
    inside: svgDoc(CARD_MM.w, CARD_MM.h, `Inside: ${item.note.noteId}`, [...(chosen?.paths ?? []), ...(sig?.paths ?? [])]),
    envelope: svgDoc(ENVELOPE_MM.w, ENVELOPE_MM.h, `Envelope: ${item.note.noteId}`, [...ret.paths, ...to.paths]),
    fits: fits && to.fits,
    problems,
    capHeightMm: Math.round(cap * 100) / 100,
  };
}

export class PlotterAdapter implements ProviderAdapter {
  readonly name = "plotter";
  readonly maxMessageChars: number;
  readonly maxSignatureChars: number;
  private readonly font: PlotterFontName;

  constructor(private readonly opts: PlotterOptions) {
    const p = providerSettings("plotter");
    this.maxMessageChars = p.maxMessageChars;
    this.maxSignatureChars = p.maxSignatureChars;
    this.font = opts.font ?? "ems-felix";
  }

  costPerCardCAD(): number {
    const p = providerSettings("plotter").pricingCAD!;
    return p.cardAndEnvelope + p.stamp + p.inkAndWear + (p.labourMinutesPerCard / 60) * p.labourRatePerHour;
  }

  validate(item: SendItem): string[] {
    const problems: string[] = [];
    const n = charCount(item.message);
    if (n > this.maxMessageChars) problems.push(`message is ${n} characters; plotter limit is ${this.maxMessageChars}`);
    problems.push(...layoutCard(item, this.font).problems);
    return problems;
  }

  preview(item: SendItem): unknown {
    const l = layoutCard(item, this.font);
    return {
      files: [`${item.note.noteId}-inside.svg`, `${item.note.noteId}-envelope.svg`],
      capHeightMm: l.capHeightMm,
      fits: l.fits,
      handFinishSecondLanguage: item.messageAlt ? item.note.altScript : false,
    };
  }

  async send(item: SendItem, ctx: SendContext): Promise<SendResult> {
    const dir = ctx.testMode ? path.join(this.opts.outDir, "test") : this.opts.outDir;
    mkdirSync(dir, { recursive: true });
    const l = layoutCard(item, this.font);
    if (!l.fits) throw new Error(l.problems.join("; "));
    const inside = path.join(dir, `${item.note.noteId}-inside.svg`);
    const envelope = path.join(dir, `${item.note.noteId}-envelope.svg`);
    writeFileSync(inside, l.inside);
    writeFileSync(envelope, l.envelope);
    if (item.messageAlt) {
      const label = item.note.altScript ? ALT_LABEL[item.note.altScript] : "Second-language";
      appendFileSync(
        path.join(dir, "hand-finish.txt"),
        `${item.note.noteId} (${item.note.recipient.firstName} ${item.note.recipient.lastName}): add these ${label} lines by hand below the English message:\n${item.messageAlt}\n\n`,
      );
    }
    return { providerRef: `svg:${path.basename(inside)}`, detail: `${path.relative(process.cwd(), inside)}, ${path.relative(process.cwd(), envelope)}` };
  }
}
