/**
 * Proof sheet: one self-contained HTML page per run. Every card is shown as the
 * client will receive it (front, handwritten inside, addressed envelope) with
 * approve / skip toggles, inline edits and an "Export approved list" button.
 * The exported JSON is the only thing `send` accepts.
 */
import { loadSettings, providerSettings, salonReturnAddress } from "../config.js";
import type { RunManifest } from "../types.js";
import { DESIGNS, designFor } from "./designs.js";
import type { FontBundle } from "./fonts.js";

export interface ProofOptions {
  provider: string;
  costPerCardCAD: number;
  fonts: FontBundle;
}

function esc(s: string): string {
  return s.replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]!);
}

/** JSON safe to drop inside a <script> element. */
function scriptJson(v: unknown): string {
  return JSON.stringify(v).replace(/</g, "\\u003c").replace(/\u2028/g, "\\u2028").replace(/\u2029/g, "\\u2029");
}

const PAPER_NOISE = `url("data:image/svg+xml,${encodeURIComponent(
  `<svg xmlns='http://www.w3.org/2000/svg' width='240' height='240'><filter id='n'><feTurbulence type='fractalNoise' baseFrequency='.85' numOctaves='3' stitchTiles='stitch'/><feColorMatrix values='0 0 0 0 .42 0 0 0 0 .36 0 0 0 0 .27 0 0 0 .09 0'/></filter><rect width='100%' height='100%' filter='url(#n)'/></svg>`,
)}")`;
const PAPER_FIBRE = `url("data:image/svg+xml,${encodeURIComponent(
  `<svg xmlns='http://www.w3.org/2000/svg' width='300' height='300'><filter id='f'><feTurbulence type='fractalNoise' baseFrequency='.012 .35' numOctaves='2' seed='7'/><feColorMatrix values='0 0 0 0 .5 0 0 0 0 .45 0 0 0 0 .35 0 0 0 .05 0'/></filter><rect width='100%' height='100%' filter='url(#f)'/></svg>`,
)}")`;
const LINEN = `url("data:image/svg+xml,${encodeURIComponent(
  `<svg xmlns='http://www.w3.org/2000/svg' width='160' height='160'><filter id='l'><feTurbulence type='fractalNoise' baseFrequency='.9 .06' numOctaves='2' seed='3'/><feColorMatrix values='0 0 0 0 .35 0 0 0 0 .3 0 0 0 0 .24 0 0 0 .07 0'/></filter><rect width='100%' height='100%' filter='url(#l)'/></svg>`,
)}")`;

export function renderProof(run: RunManifest, opts: ProofOptions): string {
  const design = designFor(run.design);
  const ret = salonReturnAddress();
  const prov = providerSettings(opts.provider);
  const okCount = run.notes.filter((n) => n.status === "ok").length;
  const total = run.notes.length;
  const writerLabel = run.mock ? "Mock copy (templates)" : `Written by Claude (${run.writer.replace(/^claude:/, "")})`;
  const data = {
    runId: run.runId,
    campaignId: run.campaignId,
    provider: opts.provider,
    countryLine: prov.envelopeCountryLine,
    maxSignatureChars: prov.maxSignatureChars,
    returnAddress: ret,
    designSvg: design.svg,
    designPaper: design.paper,
    darkFront: ["cf-lunar-new-year", "cf-holiday"].includes(design.id),
    notes: run.notes,
  };

  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Card Proofs: ${esc(run.campaignName)}</title>
${opts.fonts.fallbackLink ?? ""}
<style>
${opts.fonts.css}
</style>
<style>
:root {
  --ink: #1d2a5c;
  --desk: #e7e1d7;
  --text: #2b2723;
  --muted: #7a7166;
  --line: #d9d0c3;
  --panel: #fbf8f3;
  --accent: #3f5843;
  --accent-soft: #e3eadf;
  --warn: #9a4b18;
  --warn-soft: #f6e2d2;
  --danger: #a12f2f;
  --mock: #8a5a00;
  --mock-soft: #fbedc9;
  --card-w: 270px;
  --card-h: 350px;
  --env-w: 365px;
  --env-h: 278px;
}
* { box-sizing: border-box; }
html, body { margin: 0; }
body {
  background: var(--desk) ${LINEN};
  color: var(--text);
  font-family: Jost, "Helvetica Neue", Arial, sans-serif;
  font-size: 15px;
  line-height: 1.45;
}
header.top {
  padding: 28px 32px 18px;
  display: flex; flex-wrap: wrap; gap: 18px 32px; align-items: flex-end; justify-content: space-between;
  max-width: 1180px; margin: 0 auto;
}
.brand { display: flex; gap: 14px; align-items: center; }
.mono {
  width: 46px; height: 46px; border-radius: 50%; border: 1px solid #b8904f; color: #8a6a35;
  display: grid; place-items: center; font-family: "Cormorant Garamond", serif; font-size: 20px; letter-spacing: 1px; background: #f7f1e6;
}
.brand small { display: block; color: var(--muted); letter-spacing: .14em; text-transform: uppercase; font-size: 11px; }
.brand h1 { margin: 2px 0 0; font-family: "Cormorant Garamond", serif; font-weight: 500; font-size: 30px; line-height: 1.1; }
.facts { display: flex; flex-wrap: wrap; gap: 8px; }
.chip { background: var(--panel); border: 1px solid var(--line); border-radius: 999px; padding: 4px 11px; font-size: 13px; color: var(--muted); max-width: 100%; }
.chip b { color: var(--text); font-weight: 500; }
.chip.mock { background: var(--mock-soft); border-color: #e7cf8f; color: var(--mock); }
.chip.claude { background: var(--accent-soft); border-color: #c5d3c0; color: var(--accent); }
.banner { max-width: 1180px; margin: 0 auto 14px; padding: 0 32px; }
.banner div { background: var(--mock-soft); border: 1px solid #e7cf8f; color: #5c3d00; border-radius: 10px; padding: 10px 14px; font-size: 14px; }
.toolbar {
  position: sticky; top: 0; z-index: 10; background: rgba(247, 243, 236, .94); backdrop-filter: blur(6px);
  border-top: 1px solid var(--line); border-bottom: 1px solid var(--line);
}
.toolbar .in { max-width: 1180px; margin: 0 auto; padding: 10px 32px; display: flex; flex-wrap: wrap; gap: 10px 16px; align-items: center; }
.counts { font-size: 14px; color: var(--muted); margin-right: auto; }
.counts b { color: var(--text); font-weight: 600; }
.seg { display: inline-flex; border: 1px solid var(--line); border-radius: 8px; overflow: hidden; background: #fff; }
.seg button { border: 0; background: transparent; padding: 6px 11px; font: inherit; font-size: 13px; color: var(--muted); cursor: pointer; }
.seg button[aria-pressed="true"] { background: var(--text); color: #fff; }
.btn { border: 1px solid var(--line); background: #fff; color: var(--text); border-radius: 8px; padding: 7px 13px; font: inherit; font-size: 14px; cursor: pointer; }
.btn:hover { border-color: #b9ad9c; }
.btn.primary { background: var(--accent); color: #fff; border-color: var(--accent); }
.btn.primary:hover { background: #344a38; }
.reviewer { border: 1px solid var(--line); border-radius: 8px; padding: 7px 10px; font: inherit; font-size: 14px; width: 150px; background: #fff; }
main { max-width: 1180px; margin: 0 auto; padding: 18px 32px 64px; }
.row { margin: 0 0 26px; background: rgba(251, 248, 243, .55); border: 1px solid rgba(217, 208, 195, .7); border-radius: 16px; padding: 16px 18px 14px; }
.row.skipped { opacity: .55; }
.row.skipped .stage { filter: grayscale(.5); }
.row-head { display: flex; flex-wrap: wrap; align-items: center; gap: 6px 12px; margin-bottom: 12px; }
.row-head h2 { font-family: "Cormorant Garamond", serif; font-weight: 500; font-size: 22px; margin: 0; }
.tags { display: flex; flex-wrap: wrap; gap: 6px; align-items: center; }
.tag { font-size: 12px; line-height: 18px; color: var(--muted); background: #fff; border: 1px solid var(--line); border-radius: 6px; padding: 1px 7px; }
.tag.lang-zh { font-family: Jost, "Noto Sans SC", sans-serif; color: #8c1d1d; border-color: #e7c2bd; background: #fbefed; }
.stage { display: flex; gap: 22px; align-items: flex-start; flex-wrap: wrap; padding: 6px 2px 4px; }
.panel-label { font-size: 11px; letter-spacing: .14em; text-transform: uppercase; color: var(--muted); margin: 0 0 6px 2px; }
.paper {
  position: relative; overflow: hidden; border-radius: 2px;
  box-shadow: 0 1px 1px rgba(60, 40, 20, .08), 0 6px 14px rgba(60, 40, 20, .10), 0 22px 40px -18px rgba(60, 40, 20, .35);
}
.paper::after { content: ""; position: absolute; inset: 0; background: ${PAPER_NOISE}, ${PAPER_FIBRE}; pointer-events: none; mix-blend-mode: multiply; }
.front { width: var(--card-w); height: var(--card-h); transform: rotate(-.8deg); }
.front svg { width: 100%; height: 100%; display: block; }
.inside { width: var(--card-w); height: var(--card-h); background: #fbf8f1; transform: rotate(.5deg); }
.inside::before { content: ""; position: absolute; left: 0; top: 0; bottom: 0; width: 10px; background: linear-gradient(90deg, rgba(90, 70, 40, .10), rgba(90, 70, 40, 0)); }
.hand-wrap { position: absolute; inset: 30px 26px 22px 28px; display: flex; flex-direction: column; }
.hand {
  font-family: Caveat, "Segoe Print", "Bradley Hand", cursive; color: var(--ink); font-size: 21px; line-height: 1.32;
  text-shadow: 0 0 .5px rgba(29, 42, 92, .55); transform: rotate(-.5deg); transform-origin: 0 0;
}
.w { display: inline-block; white-space: nowrap; margin-right: .14em; }
.zh .w { margin-right: 0; }
.c { display: inline-block; }
.br { display: block; height: 0; }
.sig { margin-top: .55em; margin-left: 38%; }
.zh { font-family: "LXGW WenKai TC", "Ma Shan Zheng", Caveat, cursive; font-size: 17px; line-height: 1.45; margin-top: .7em; color: #24306a; }
.zh-note { position: absolute; right: 8px; bottom: 6px; font: 10px Jost, sans-serif; color: #a3352f; letter-spacing: .04em; opacity: .75; }
.mock-stamp { position: absolute; left: 10px; bottom: 7px; font: 600 9px Jost, sans-serif; letter-spacing: .12em; color: var(--mock); background: var(--mock-soft); padding: 1px 5px; border-radius: 3px; }
.envelope { width: var(--env-w); height: var(--env-h); background: #fcfaf6; transform: rotate(.9deg); }
.envelope .ret { position: absolute; left: 18px; top: 16px; font-family: Caveat, cursive; color: var(--ink); font-size: 14.5px; line-height: 1.12; }
.envelope .to { position: absolute; left: 112px; top: 118px; right: 18px; font-family: Caveat, cursive; color: var(--ink); font-size: 22px; line-height: 1.12; }
.stamp { position: absolute; right: 16px; top: 14px; width: 46px; height: 56px; transform: rotate(2.4deg); filter: drop-shadow(0 1px 1px rgba(0, 0, 0, .15)); }
.meta { display: flex; flex-wrap: wrap; align-items: center; gap: 10px 18px; margin-top: 14px; padding-top: 12px; border-top: 1px dashed var(--line); }
.meter { display: flex; align-items: center; gap: 8px; font-size: 13px; color: var(--muted); min-width: 220px; }
.meter .bar { width: 120px; height: 6px; background: #ebe4d8; border-radius: 4px; overflow: hidden; }
.meter .bar i { display: block; height: 100%; background: var(--accent); border-radius: 4px; }
.meter.over .bar i { background: var(--danger); }
.meter.over { color: var(--danger); }
.issues { margin: 0; padding: 0; list-style: none; font-size: 13px; color: var(--warn); }
.issues li::before { content: "! "; font-weight: 700; }
.decide { margin-left: auto; display: flex; gap: 8px; align-items: center; }
.decide .seg button[data-v="approve"][aria-pressed="true"] { background: var(--accent); }
.decide .seg button[data-v="skip"][aria-pressed="true"] { background: #6b6259; }
.editor { display: none; width: 100%; margin-top: 10px; gap: 8px; flex-direction: column; }
.editor.open { display: flex; }
.editor textarea, .editor input { width: 100%; font: 15px/1.45 Jost, sans-serif; border: 1px solid var(--line); border-radius: 8px; padding: 8px 10px; background: #fff; }
.editor textarea { min-height: 92px; }
.editor .hint { font-size: 12px; color: var(--muted); }
.cmd { max-width: 1180px; margin: 0 auto; padding: 0 32px 40px; color: var(--muted); font-size: 13px; }
.cmd code { background: #fff; border: 1px solid var(--line); border-radius: 6px; padding: 2px 6px; color: var(--text); }
.hidden { display: none !important; }
@media (max-width: 760px) {
  header.top, .toolbar .in, main, .banner, .cmd { padding-left: 16px; padding-right: 16px; }
  :root { --card-w: 250px; --card-h: 324px; --env-w: 300px; --env-h: 228px; }
  .envelope .to { left: 80px; top: 96px; font-size: 19px; }
  .decide { margin-left: 0; }
  .chip { border-radius: 12px; }
  .stage { justify-content: center; }
}
@media print {
  .toolbar, .editor, .decide, .banner { display: none !important; }
  body { background: #fff; }
  .row { break-inside: avoid; }
}
</style>
</head>
<body>
<header class="top">
  <div class="brand">
    <div class="mono">CF</div>
    <div>
      <small>CF Hair Salon &middot; card proofs</small>
      <h1>${esc(run.campaignName)}</h1>
    </div>
  </div>
  <div class="facts">
    <span class="chip">Run <b>${esc(run.today)}</b></span>
    <span class="chip"><b>${total}</b> card${total === 1 ? "" : "s"}</span>
    <span class="chip ${run.mock ? "mock" : "claude"}">${esc(writerLabel)}</span>
    <span class="chip">Design <b>${esc(design.label)}</b></span>
    <span class="chip">${esc(prov.label)}: <b>~CAD ${(opts.costPerCardCAD * total).toFixed(2)}</b> (${opts.costPerCardCAD.toFixed(2)}/card)</span>
    ${run.offer ? `<span class="chip">Offer <b>${esc(run.offer.code)}</b></span>` : ""}
  </div>
</header>
${
  run.mock
    ? `<div class="banner"><div><b>Mock copy.</b> These notes were filled in from templates because ANTHROPIC_API_KEY was not set. Set it and run <code>generate</code> again to have Claude write each card individually.</div></div>`
    : ""
}
<div class="toolbar">
  <div class="in">
    <div class="counts" id="counts"></div>
    <div class="seg" role="group" aria-label="Filter">
      <button type="button" data-filter="all" aria-pressed="true">All</button>
      <button type="button" data-filter="attention" aria-pressed="false">Needs attention</button>
      <button type="button" data-filter="zh" aria-pressed="false">Chinese</button>
    </div>
    <input class="reviewer" id="reviewer" placeholder="Reviewed by" aria-label="Reviewed by">
    <button type="button" class="btn" id="approve-all">Approve all valid</button>
    <button type="button" class="btn primary" id="export">Export approved list</button>
  </div>
</div>
<main id="cards"></main>
<p class="cmd">Nothing is mailed from this page. Export the approved list, then run
<code>npm run notes -- send --approved path/to/approved-${esc(run.runId)}.json</code> (a dry run) and add <code>--send</code> when it looks right.
Run <b>${esc(run.runId)}</b> &middot; generated ${esc(run.generatedAt)} &middot; ${okCount} of ${total} passed every check.</p>

<script id="data" type="application/json">${scriptJson(data)}</script>
<script>
(() => {
  const DATA = JSON.parse(document.getElementById("data").textContent);
  const KEY = "cf-notes-proof:" + DATA.runId;
  let state = { decisions: {}, edits: {}, reviewer: "" };
  try { const saved = JSON.parse(localStorage.getItem(KEY) || "null"); if (saved) state = Object.assign(state, saved); } catch (e) {}
  const save = () => { try { localStorage.setItem(KEY, JSON.stringify(state)); } catch (e) {} };

  // Seeded PRNG so each card always looks the same.
  function rng(seed) {
    let a = 0;
    for (let i = 0; i < seed.length; i++) a = (Math.imul(a ^ seed.charCodeAt(i), 2654435761) + i) >>> 0;
    return () => {
      a = (a + 0x6d2b79f5) >>> 0; let t = a;
      t = Math.imul(t ^ (t >>> 15), t | 1); t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  }
  const graphemes = (s) => {
    try { return Array.from(new Intl.Segmenter("en", { granularity: "grapheme" }).segment(s), (x) => x.segment); }
    catch (e) { return Array.from(s); }
  };

  // Hand-written look: each word drifts off the baseline a little, each letter
  // tilts, shifts and varies in ink pressure, like a real ballpoint.
  function hand(el, text, seed, opts) {
    opts = opts || {};
    const r = rng(seed); const j = (amp) => (r() * 2 - 1) * amp;
    el.textContent = "";
    let drift = 0;
    text.split("\\n").forEach((line, li) => {
      if (li > 0) { const br = document.createElement("span"); br.className = "br"; el.appendChild(br); }
      const words = opts.cjk ? cjkUnits(line) : line.split(/ +/);
      words.forEach((word, wi) => {
        if (!word) return;
        drift = Math.max(-2.2, Math.min(2.2, drift + j(0.9)));
        const w = document.createElement("span");
        w.className = "w";
        w.style.transform = "translateY(" + drift.toFixed(2) + "px) rotate(" + j(1.1).toFixed(2) + "deg)";
        w.style.fontWeight = String(Math.round(470 + j(opts.cjk ? 0 : 60)));
        for (const ch of graphemes(word)) {
          const c = document.createElement("span");
          c.className = "c";
          c.textContent = ch;
          c.style.transform = "translateY(" + j(0.9).toFixed(2) + "px) rotate(" + j(opts.cjk ? 2.5 : 3.4).toFixed(2) + "deg) scale(" + (1 + j(0.035)).toFixed(3) + ")";
          c.style.opacity = (0.82 + r() * 0.18).toFixed(2);
          if (!opts.cjk) c.style.marginRight = j(0.5).toFixed(2) + "px";
          w.appendChild(c);
        }
        el.appendChild(w);
        if (wi < words.length - 1) el.appendChild(document.createTextNode(opts.cjk ? "" : " "));
        if (opts.cjk) w.style.fontWeight = "400";
      });
    });
  }

  // Chinese line breaking: closing punctuation never starts a line, Latin runs stay together.
  function cjkUnits(line) {
    const units = [];
    for (const g of graphemes(line)) {
      const prev = units[units.length - 1];
      if (prev !== undefined && (/^[\uFF0C\u3002\uFF01\uFF1F\uFF1A\uFF1B\u3001\uFF09\u300D\u300F,.!?:;)]$/.test(g) || (/^[A-Za-z0-9%]$/.test(g) && /[A-Za-z0-9%]$/.test(prev)))) units[units.length - 1] = prev + g;
      else units.push(g);
    }
    return units;
  }

  // Shrink writing until it fits the card, the way a person writes smaller near the edge.
  function fit(wrap) {
    const hands = wrap.querySelectorAll(".hand");
    let size = 21;
    for (const h of hands) h.style.fontSize = "";
    for (let i = 0; i < 14 && wrap.scrollHeight > wrap.clientHeight + 1; i++) {
      size -= 0.75;
      for (const h of hands) h.style.fontSize = (h.classList.contains("zh") ? size * 0.9 : size) + "px";
    }
  }

  const BAD_DASH = /[\\u2012-\\u2015\\u2212\\u2E3A\\u2E3B]/;
  const EMOJI = /\\p{Extended_Pictographic}/u;
  function liveIssues(n, msg, zh, sig) {
    const out = [];
    const len = graphemes(msg).length;
    if (!msg.trim()) out.push("Message is empty.");
    if (len > n.maxChars) out.push("Message is " + len + " characters; the limit is " + n.maxChars + ".");
    if (BAD_DASH.test(msg) || (zh && BAD_DASH.test(zh))) out.push("Contains an em or en dash.");
    if (EMOJI.test(msg) || (zh && EMOJI.test(zh))) out.push("Contains an emoji.");
    if (/[^\\x20-\\x7E\\n\\u00C0-\\u00FF]/.test(msg)) out.push("Has characters the pen font cannot write.");
    if (!msg.toLowerCase().includes(n.recipient.firstName.toLowerCase())) out.push("Does not use " + n.recipient.firstName + "'s name.");
    if (zh && graphemes(zh).length > n.maxCharsZh) out.push("Chinese version is over " + n.maxCharsZh + " characters.");
    if (graphemes(sig).length > DATA.maxSignatureChars) out.push("Signature over " + DATA.maxSignatureChars + " characters.");
    return out;
  }

  const current = (n) => state.edits[n.noteId] || { message: n.message, messageZh: n.messageZh || "", signature: n.signature };
  const decision = (n) => state.decisions[n.noteId] || (n.status === "ok" ? "approve" : "skip");
  const issuesFor = (n) => {
    const e = state.edits[n.noteId];
    return e ? liveIssues(n, e.message, e.messageZh, e.signature) : n.issues.map((i) => i.message);
  };

  const STAMP = '<svg class="stamp" viewBox="0 0 46 56" aria-hidden="true"><defs><mask id="perf"><rect width="46" height="56" fill="#fff"/>' +
    Array.from({ length: 9 }, (_, i) => '<circle cx="' + (2 + i * 5.25) + '" cy="0" r="1.6" fill="#000"/><circle cx="' + (2 + i * 5.25) + '" cy="56" r="1.6" fill="#000"/>').join("") +
    Array.from({ length: 11 }, (_, i) => '<circle cx="0" cy="' + (2 + i * 5.2) + '" r="1.6" fill="#000"/><circle cx="46" cy="' + (2 + i * 5.2) + '" r="1.6" fill="#000"/>').join("") +
    '</mask></defs><rect width="46" height="56" fill="#f4efe4" mask="url(#perf)"/><rect x="4" y="4" width="38" height="48" fill="#2f5a4a"/>' +
    '<g transform="translate(23 25)"><ellipse rx="5" ry="9" fill="#e9d7a8" transform="rotate(-28)"/><ellipse rx="4" ry="8" fill="#d8b874" transform="rotate(30) translate(2 1)"/><path d="M0 -6 L0 14" stroke="#e9d7a8" stroke-width=".8"/></g>' +
    '<text x="23" y="48" text-anchor="middle" font-family="Jost, sans-serif" font-size="5" fill="#f4efe4" letter-spacing=".6">POSTAGE</text></svg>';

  function cardEl(n) {
    const row = document.createElement("article");
    row.className = "row";
    row.dataset.id = n.noteId;
    const tags = [];
    tags.push(...n.reasons);
    if (n.stylistName) tags.push("Stylist " + n.stylistName);
    if (n.lastServiceName) tags.push(n.lastServiceName);
    if (n.attempts > 1) tags.push("rewritten " + (n.attempts - 1) + "x");
    row.innerHTML =
      '<div class="row-head"><h2></h2><div class="tags"></div></div>' +
      '<div class="stage">' +
        '<div><p class="panel-label">Front</p><div class="paper front" style="background:' + DATA.designPaper + '"><svg viewBox="0 0 108 140" preserveAspectRatio="xMidYMid slice">' + DATA.designSvg + '</svg></div></div>' +
        '<div><p class="panel-label">Inside</p><div class="paper inside"><div class="hand-wrap"><div class="hand msg"></div><div class="hand zh hidden"></div><div class="hand sig"></div></div></div></div>' +
        '<div><p class="panel-label">Envelope</p><div class="paper envelope"><div class="ret"></div><div class="to"></div>' + STAMP + '</div></div>' +
      '</div>' +
      '<div class="meta"><div class="meter"><span class="bar"><i></i></span><span class="count"></span></div><ul class="issues"></ul>' +
        '<div class="decide"><button type="button" class="btn edit">Edit</button><div class="seg" role="group" aria-label="Decision"><button type="button" data-v="approve">Approve</button><button type="button" data-v="skip">Skip</button></div></div>' +
        '<div class="editor"><label class="hint">Message</label><textarea class="e-msg"></textarea><label class="hint e-zh-label">Chinese version (added by hand)</label><textarea class="e-zh"></textarea><label class="hint">Signature</label><input class="e-sig"><div><button type="button" class="btn primary e-save">Save edit</button> <button type="button" class="btn e-reset">Restore original</button></div></div>' +
      '</div>';
    row.querySelector("h2").textContent = n.recipient.firstName + " " + n.recipient.lastName;
    const tagBox = row.querySelector(".tags");
    for (const t of tags) { const s = document.createElement("span"); s.className = "tag"; s.textContent = t; tagBox.appendChild(s); }
    if (n.preferredLanguage === "zh") { const s = document.createElement("span"); s.className = "tag lang-zh"; s.textContent = "中文 version"; tagBox.appendChild(s); }

    const a = n.recipient.address || {};
    hand(row.querySelector(".ret"), [DATA.returnAddress.name, DATA.returnAddress.line1, DATA.returnAddress.city + " " + DATA.returnAddress.province + "  " + DATA.returnAddress.postalCode].join("\\n"), n.noteId + "r");
    const toLines = [n.recipient.firstName + " " + n.recipient.lastName, a.line2, a.line1, (a.city || "") + " " + (a.province || "") + "  " + (a.postalCode || "")];
    if (DATA.countryLine) toLines.push("CANADA");
    hand(row.querySelector(".to"), toLines.filter(Boolean).join("\\n"), n.noteId + "t");
    if (n.writer === "mock") { const m = document.createElement("span"); m.className = "mock-stamp"; m.textContent = "MOCK COPY"; row.querySelector(".inside").appendChild(m); }

    const ed = row.querySelector(".editor");
    row.querySelector(".edit").addEventListener("click", () => {
      const c = current(n);
      ed.querySelector(".e-msg").value = c.message;
      ed.querySelector(".e-zh").value = c.messageZh || "";
      ed.querySelector(".e-zh").classList.toggle("hidden", n.preferredLanguage !== "zh");
      ed.querySelector(".e-zh-label").classList.toggle("hidden", n.preferredLanguage !== "zh");
      ed.querySelector(".e-sig").value = c.signature;
      ed.classList.toggle("open");
    });
    ed.querySelector(".e-save").addEventListener("click", () => {
      state.edits[n.noteId] = { message: ed.querySelector(".e-msg").value.trim(), messageZh: ed.querySelector(".e-zh").value.trim(), signature: ed.querySelector(".e-sig").value.trim() };
      if (issuesFor(n).length === 0) state.decisions[n.noteId] = "approve";
      save(); paint(row, n); ed.classList.remove("open");
    });
    ed.querySelector(".e-reset").addEventListener("click", () => { delete state.edits[n.noteId]; delete state.decisions[n.noteId]; save(); paint(row, n); ed.classList.remove("open"); });
    row.querySelectorAll(".decide .seg button").forEach((b) => b.addEventListener("click", () => {
      if (b.dataset.v === "approve" && issuesFor(n).length) return;
      state.decisions[n.noteId] = b.dataset.v; save(); paint(row, n);
    }));
    return row;
  }

  function paint(row, n) {
    const c = current(n);
    const wrap = row.querySelector(".hand-wrap");
    hand(row.querySelector(".msg"), c.message, n.noteId);
    const zhEl = row.querySelector(".hand.zh");
    zhEl.classList.toggle("hidden", !c.messageZh);
    if (c.messageZh) hand(zhEl, c.messageZh, n.noteId + "zh", { cjk: true });
    hand(row.querySelector(".sig"), c.signature, n.noteId + "s");
    let note = row.querySelector(".zh-note");
    if (c.messageZh && !note) { note = document.createElement("span"); note.className = "zh-note"; note.textContent = "Chinese lines added by hand"; row.querySelector(".inside").appendChild(note); }
    if (!c.messageZh && note) note.remove();
    fit(wrap);
    const len = graphemes(c.message).length;
    const meter = row.querySelector(".meter");
    meter.classList.toggle("over", len > n.maxChars);
    meter.querySelector("i").style.width = Math.min(100, (len / n.maxChars) * 100).toFixed(1) + "%";
    meter.querySelector(".count").textContent = len + " / " + n.maxChars + " characters" + (c.messageZh ? " · 中文 " + graphemes(c.messageZh).length + " / " + n.maxCharsZh : "") + (state.edits[n.noteId] ? " · edited" : "");
    const list = row.querySelector(".issues");
    list.textContent = "";
    for (const msg of issuesFor(n)) { const li = document.createElement("li"); li.textContent = msg; list.appendChild(li); }
    const d = issuesFor(n).length ? "skip" : decision(n);
    row.querySelectorAll(".decide .seg button").forEach((b) => b.setAttribute("aria-pressed", String(b.dataset.v === d)));
    const ap = row.querySelector('.decide .seg button[data-v="approve"]');
    ap.disabled = issuesFor(n).length > 0;
    ap.title = ap.disabled ? "Fix the issues (Edit) before approving" : "";
    row.classList.toggle("skipped", d === "skip");
    row.dataset.attention = String(issuesFor(n).length > 0);
    row.dataset.zh = String(n.preferredLanguage === "zh");
    counts();
  }

  function approvedNotes() { return DATA.notes.filter((n) => issuesFor(n).length === 0 && decision(n) === "approve"); }
  function counts() {
    const ap = approvedNotes().length;
    const att = DATA.notes.filter((n) => issuesFor(n).length).length;
    document.getElementById("counts").innerHTML = "<b>" + ap + "</b> approved · " + (DATA.notes.length - ap) + " skipped" + (att ? " · <b>" + att + "</b> need attention" : "");
  }

  const box = document.getElementById("cards");
  const rows = DATA.notes.map((n) => { const el = cardEl(n); box.appendChild(el); return [el, n]; });
  const paintAll = () => rows.forEach(([el, n]) => paint(el, n));
  paintAll();
  if (document.fonts && document.fonts.ready) document.fonts.ready.then(paintAll);

  document.querySelectorAll("[data-filter]").forEach((b) => b.addEventListener("click", () => {
    document.querySelectorAll("[data-filter]").forEach((x) => x.setAttribute("aria-pressed", String(x === b)));
    for (const [el] of rows) {
      const f = b.dataset.filter;
      el.classList.toggle("hidden", (f === "attention" && el.dataset.attention !== "true") || (f === "zh" && el.dataset.zh !== "true"));
    }
  }));
  document.getElementById("approve-all").addEventListener("click", () => {
    for (const n of DATA.notes) if (!issuesFor(n).length) state.decisions[n.noteId] = "approve";
    save(); paintAll();
  });
  const reviewer = document.getElementById("reviewer");
  reviewer.value = state.reviewer || "";
  reviewer.addEventListener("input", () => { state.reviewer = reviewer.value; save(); });
  document.getElementById("export").addEventListener("click", () => {
    const approved = approvedNotes().map((n) => {
      const c = current(n);
      return { noteId: n.noteId, idempotencyKey: n.idempotencyKey, message: c.message, messageZh: c.messageZh || undefined, signature: c.signature, edited: !!state.edits[n.noteId] };
    });
    const file = { runId: DATA.runId, campaignId: DATA.campaignId, exportedAt: new Date().toISOString(), approvedBy: reviewer.value || undefined, approved };
    const blob = new Blob([JSON.stringify(file, null, 2)], { type: "application/json" });
    const a = document.createElement("a");
    a.href = URL.createObjectURL(blob);
    a.download = "approved-" + DATA.runId + ".json";
    document.body.appendChild(a); a.click(); a.remove();
    setTimeout(() => URL.revokeObjectURL(a.href), 1000);
  });
})();
</script>
</body>
</html>
`;
}

export { DESIGNS };
export const PROOF_DEFAULTS = () => ({ provider: loadSettings().defaultProvider });
