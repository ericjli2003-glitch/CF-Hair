import fs from "node:fs";

/**
 * OpenAI credentials for the speech-to-speech line: a static API key, or workload identity
 * federation (no key). With federation, Render's managed OIDC writes a short-lived token for this
 * service to OPENAI_IDENTITY_TOKEN_FILE and rotates it; it is exchanged for an OpenAI access token,
 * cached, and exchanged again before it expires.
 *
 * Exchange (as in the official openai SDK, auth/workload-identity-auth): POST
 * https://auth.openai.com/oauth/token, JSON {grant_type: token-exchange, subject_token,
 * subject_token_type: jwt, identity_provider_id, service_account_id} -> {access_token, expires_in}.
 */

export interface OpenAiAuthOptions {
  apiKey: string;
  identityProviderId: string;
  serviceAccountId: string;
  tokenFile: string;
  tokenUrl: string;
}

const GRANT = "urn:ietf:params:oauth:grant-type:token-exchange";
const JWT = "urn:ietf:params:oauth:token-type:jwt";

export class OpenAiAuth {
  private cached: { token: string; expiresAt: number; refreshAt: number } | null = null;
  private inflight: Promise<string> | null = null;

  constructor(private readonly opts: OpenAiAuthOptions) {}

  /** Federation wins when it is fully set up, so a leftover key cannot quietly take over. */
  mode(): "federation" | "api-key" | "none" {
    const o = this.opts;
    if (o.identityProviderId && o.serviceAccountId && o.tokenFile) return "federation";
    return o.apiKey ? "api-key" : "none";
  }

  /** What is missing for federation, for the startup log. */
  missing(): string[] {
    const o = this.opts;
    const set = [o.identityProviderId, o.serviceAccountId, o.tokenFile].some(Boolean);
    if (!set) return [];
    return [
      ["OPENAI_IDENTITY_PROVIDER_ID", o.identityProviderId],
      ["OPENAI_SERVICE_ACCOUNT_ID", o.serviceAccountId],
      ["OPENAI_IDENTITY_TOKEN_FILE (set by Render)", o.tokenFile],
    ]
      .filter(([, v]) => !v)
      .map(([k]) => k);
  }

  /** The value for `Authorization: Bearer`. */
  async bearer(): Promise<string> {
    const mode = this.mode();
    if (mode === "api-key") return this.opts.apiKey;
    if (mode === "none") throw new Error("no OpenAI credentials (set OPENAI_API_KEY, or workload identity)");
    const now = Date.now();
    if (this.cached && now < this.cached.expiresAt) {
      if (now >= this.cached.refreshAt && !this.inflight) void this.exchange().catch(() => {});
      return this.cached.token;
    }
    return this.exchange();
  }

  private exchange(): Promise<string> {
    this.inflight ??= this.doExchange().finally(() => {
      this.inflight = null;
    });
    return this.inflight;
  }

  private async doExchange(): Promise<string> {
    // Read the file each time: Render rotates the token in place.
    const subject = fs.readFileSync(this.opts.tokenFile, "utf8").trim();
    const started = Date.now();
    const r = await fetch(this.opts.tokenUrl, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        grant_type: GRANT,
        subject_token: subject,
        subject_token_type: JWT,
        identity_provider_id: this.opts.identityProviderId,
        service_account_id: this.opts.serviceAccountId,
      }),
      redirect: "manual",
    });
    if (!r.ok) {
      const body = (await r.text().catch(() => "")).slice(0, 300);
      throw new Error(`OpenAI token exchange failed: ${r.status} ${body}`);
    }
    const j = (await r.json()) as { access_token?: unknown; expires_in?: unknown };
    if (typeof j.access_token !== "string" || !j.access_token.trim()) throw new Error("OpenAI token exchange returned no access_token");
    const lifetime = typeof j.expires_in === "number" && j.expires_in > 0 ? j.expires_in : 3600;
    const expiresAt = started + lifetime * 1000;
    // Refresh 20 minutes early, or halfway through a short-lived token.
    const refreshAt = expiresAt - Math.min(1200_000, lifetime * 500);
    this.cached = { token: j.access_token, expiresAt, refreshAt };
    return j.access_token;
  }
}

export function openAiAuthFromConfig(cfg: {
  openAiApiKey: string;
  openAiIdentityProviderId: string;
  openAiServiceAccountId: string;
  openAiIdentityTokenFile: string;
  openAiTokenUrl: string;
}): OpenAiAuth {
  return new OpenAiAuth({
    apiKey: cfg.openAiApiKey,
    identityProviderId: cfg.openAiIdentityProviderId,
    serviceAccountId: cfg.openAiServiceAccountId,
    tokenFile: cfg.openAiIdentityTokenFile,
    tokenUrl: cfg.openAiTokenUrl,
  });
}
