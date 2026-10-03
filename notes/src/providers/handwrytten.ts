/**
 * Handwrytten adapter (https://www.handwrytten.com/api/, API v2).
 *
 * Request shapes follow the official TypeScript SDK (github.com/handwrytten/handwrytten-js-sdk,
 * v1.7.0, src/resources/basket.ts and orders.ts):
 *   POST orders/placeBasket  { card_id, message, wishes, font, addresses:[{to_*, from_*}], client_metadata }
 *   POST basket/send         { test_mode?: 1 }
 *   GET  basket/count, cards/list, fonts/list
 * Auth: the API key goes in the Authorization header with no "Bearer" prefix.
 *
 * Each card is its own basket (place, then send) so a failure never mails a
 * half-built batch, and the idempotency key travels as client_metadata and as an
 * Idempotency-Key header. The local history ledger is the real guarantee.
 */
import { loadSettings, providerSettings, salonReturnAddress } from "../config.js";
import { charCount } from "../text.js";
import type { ProviderAdapter, SendContext, SendItem, SendResult } from "./types.js";

export const HANDWRYTTEN_BASE_URL = "https://api.handwrytten.com/v2/";

export interface HandwryttenOptions {
  apiKey?: string;
  baseUrl?: string;
  defaultCardId?: string;
  defaultFont?: string;
  fetchImpl?: typeof fetch;
}

export class HandwryttenError extends Error {
  constructor(
    message: string,
    readonly status?: number,
    readonly body?: unknown,
  ) {
    super(message);
  }
}

export class HandwryttenAdapter implements ProviderAdapter {
  readonly name = "handwrytten";
  readonly maxMessageChars: number;
  readonly maxSignatureChars: number;
  private readonly apiKey?: string;
  private readonly baseUrl: string;
  private readonly defaultCardId?: string;
  private readonly defaultFont?: string;
  private readonly fetchImpl: typeof fetch;

  constructor(opts: HandwryttenOptions = {}) {
    const p = providerSettings("handwrytten");
    this.maxMessageChars = p.maxMessageChars;
    this.maxSignatureChars = p.maxSignatureChars;
    this.apiKey = opts.apiKey ?? process.env.HANDWRYTTEN_API_KEY;
    this.baseUrl = opts.baseUrl ?? process.env.HANDWRYTTEN_BASE_URL ?? HANDWRYTTEN_BASE_URL;
    this.defaultCardId = opts.defaultCardId ?? process.env.HANDWRYTTEN_CARD_ID;
    this.defaultFont = opts.defaultFont ?? process.env.HANDWRYTTEN_FONT;
    this.fetchImpl = opts.fetchImpl ?? fetch;
  }

  costPerCardCAD(): number {
    const p = providerSettings("handwrytten").pricingUSD!;
    return (p.cardPayAsYouGo + p.internationalStamp + p.internationalSurcharge) * loadSettings().fxUsdToCad;
  }

  private cardId(item: SendItem): string | undefined {
    const v = item.campaign.handwrytten?.cardId;
    return v != null && v !== "" ? String(v) : this.defaultCardId;
  }

  private font(item: SendItem): string | undefined {
    return item.campaign.handwrytten?.font || this.defaultFont;
  }

  validate(item: SendItem): string[] {
    const problems: string[] = [];
    const n = charCount(item.message);
    if (n > this.maxMessageChars) problems.push(`message is ${n} characters; Handwrytten limit here is ${this.maxMessageChars}`);
    const s = charCount(item.signature);
    if (s > this.maxSignatureChars) problems.push(`signature is ${s} characters; Handwrytten "wishes" limit is ${this.maxSignatureChars}`);
    const a = item.address;
    if (!a.line1 || !a.city || !a.province || !a.postalCode) problems.push("incomplete address");
    return problems;
  }

  /** placeBasket body for one card. */
  buildOrder(item: SendItem): Record<string, unknown> {
    const from = salonReturnAddress();
    const a = item.address;
    const cardId = this.cardId(item);
    return {
      card_id: cardId ? Number(cardId) : "<HANDWRYTTEN_CARD_ID>",
      font: this.font(item) ?? "<HANDWRYTTEN_FONT>",
      message: item.message,
      wishes: item.signature,
      client_metadata: item.note.idempotencyKey,
      addresses: [
        {
          to_first_name: item.note.recipient.firstName,
          to_last_name: item.note.recipient.lastName,
          to_address1: a.line1,
          ...(a.line2 ? { to_address2: a.line2 } : {}),
          to_city: a.city,
          to_state: a.province,
          to_zip: a.postalCode,
          to_country: a.country || "CA",
          from_business_name: from.name,
          from_first_name: "CF Hair",
          from_last_name: "Salon",
          from_address1: from.line1,
          from_city: from.city,
          from_state: from.province,
          from_zip: from.postalCode,
          from_country: from.country,
        },
      ],
    };
  }

  preview(item: SendItem): unknown {
    return { endpoint: `${this.baseUrl}orders/placeBasket then basket/send`, body: this.buildOrder(item) };
  }

  private async request(method: "GET" | "POST", path: string, body?: unknown, idempotencyKey?: string): Promise<unknown> {
    if (!this.apiKey) throw new HandwryttenError("HANDWRYTTEN_API_KEY is not set");
    const url = new URL(path, this.baseUrl);
    const res = await this.fetchImpl(url, {
      method,
      headers: {
        Accept: "application/json",
        Authorization: this.apiKey,
        "User-Agent": "cf-hair-notes/0.1",
        ...(body ? { "Content-Type": "application/json" } : {}),
        ...(idempotencyKey ? { "Idempotency-Key": idempotencyKey } : {}),
      },
      body: body ? JSON.stringify(body) : undefined,
    });
    const text = await res.text();
    let parsed: unknown = text;
    try {
      parsed = text ? JSON.parse(text) : null;
    } catch {
      /* keep raw text */
    }
    const statusField = (parsed as { status?: unknown } | null)?.status;
    if (!res.ok || statusField === "error") {
      const msg = (parsed as { message?: string; error?: string } | null)?.message ?? (parsed as { error?: string } | null)?.error ?? text.slice(0, 200);
      throw new HandwryttenError(`Handwrytten ${method} ${path} failed (${res.status}): ${msg}`, res.status, parsed);
    }
    return parsed;
  }

  async preflight(): Promise<void> {
    const data = (await this.request("GET", "basket/count")) as { count?: number } | null;
    const count = Number(data?.count ?? 0);
    if (count > 0) {
      throw new HandwryttenError(
        `The Handwrytten basket already holds ${count} item(s). Sending now would mail those too. Review or clear the basket in the Handwrytten dashboard first.`,
      );
    }
  }

  async send(item: SendItem, ctx: SendContext): Promise<SendResult> {
    const order = this.buildOrder(item);
    if (typeof order.card_id !== "number" || Number.isNaN(order.card_id)) {
      throw new HandwryttenError("No Handwrytten card id. Set HANDWRYTTEN_CARD_ID or campaign.handwrytten.cardId (list them with `npm run notes -- catalog`).");
    }
    if (order.font === "<HANDWRYTTEN_FONT>") throw new HandwryttenError("No Handwrytten font. Set HANDWRYTTEN_FONT or campaign.handwrytten.font.");
    await this.request("POST", "orders/placeBasket", order, item.note.idempotencyKey);
    const sent = await this.request("POST", "basket/send", ctx.testMode ? { test_mode: 1 } : {}, item.note.idempotencyKey);
    return { providerRef: pickRef(sent), detail: ctx.testMode ? "test mode, not mailed" : "submitted" };
  }

  async catalog(): Promise<{ cards: unknown; fonts: unknown }> {
    const [cards, fonts] = await Promise.all([this.request("GET", "cards/list"), this.request("GET", "fonts/list")]);
    return { cards, fonts };
  }
}

/** Best-effort order reference from a basket/send response. */
export function pickRef(resp: unknown): string {
  if (resp && typeof resp === "object") {
    const o = resp as Record<string, unknown>;
    for (const k of ["order_id", "orderId", "id", "basket_id", "grand_order_id"]) {
      if (o[k] != null) return `${k}:${String(o[k])}`;
    }
    if (Array.isArray(o.orders) && o.orders.length) return `orders:${JSON.stringify(o.orders).slice(0, 120)}`;
  }
  return "submitted (no id in response)";
}
