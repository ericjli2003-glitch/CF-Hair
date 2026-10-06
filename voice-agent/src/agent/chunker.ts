/**
 * Turns a stream of text deltas into speakable sentences, so text-to-speech can start
 * on the first sentence while the model is still writing the rest.
 */
export class SentenceChunker {
  private buf = "";
  private emitted = false;

  /**
   * `earlyFirstChunk`: the first piece of a reply may end at a comma ("OK," "Sure,"), so the voice
   * starts while the model is still writing the rest of that sentence. Later pieces stay whole
   * sentences, which sound more natural.
   */
  constructor(
    private readonly maxChars = 220,
    private readonly earlyFirstChunk = true,
  ) {}

  /** Add a delta; returns zero or more complete sentences ready to speak. */
  push(delta: string): string[] {
    this.buf += delta;
    const out: string[] = [];
    if (this.earlyFirstChunk && !this.emitted) {
      const m = /^[^.!?。！？；\n]{1,40}?[,，、](\s+|(?=\S))/u.exec(this.buf);
      // Only when something follows the comma, so "4,500" style numbers never split.
      if (m && this.buf.length > m[0].length && !/\d[,，]$/.test(m[0].trimEnd().slice(-2))) {
        out.push(m[0]);
        this.buf = this.buf.slice(m[0].length);
        this.emitted = true;
      }
    }
    for (;;) {
      const idx = this.findBoundary();
      if (idx < 0) break;
      const sentence = this.buf.slice(0, idx);
      this.buf = this.buf.slice(idx);
      if (sentence.trim()) {
        out.push(sentence);
        this.emitted = true;
      }
    }
    if (this.buf.length > this.maxChars) {
      // Very long run-on sentence: break at the last comma or space.
      const cut = Math.max(this.buf.lastIndexOf(", "), this.buf.lastIndexOf("，"), this.buf.lastIndexOf(" "));
      if (cut > 40) {
        out.push(this.buf.slice(0, cut + 1));
        this.buf = this.buf.slice(cut + 1);
      }
    }
    return out;
  }

  /** Whatever is left at the end of the stream. */
  flush(): string {
    const rest = this.buf;
    this.buf = "";
    return rest.trim() ? rest : "";
  }

  /** Index just after a sentence boundary (including trailing whitespace), or -1. */
  private findBoundary(): number {
    const s = this.buf;
    for (let i = 0; i < s.length; i++) {
      const c = s[i];
      if ("。！？；".includes(c)) {
        let j = i + 1;
        while (j < s.length && /[\s」』”"）)]/.test(s[j])) j++;
        return j;
      }
      if (c === "\n") return i + 1;
      if (".!?".includes(c)) {
        const next = s[i + 1];
        if (next === undefined) return -1; // wait: could be "4.5" or "..." still streaming
        if (/[\s"')\]”]/.test(next)) {
          // Avoid splitting very short fragments like "Mr." or "a.m."
          const before = s.slice(0, i + 1).trim();
          if (before.length < 3 || /\b(?:Mr|Mrs|Ms|Dr|St|a\.m|p\.m)\.$/i.test(before)) continue;
          let j = i + 1;
          while (j < s.length && /[\s"')\]”]/.test(s[j])) j++;
          return j;
        }
      }
    }
    return -1;
  }
}
