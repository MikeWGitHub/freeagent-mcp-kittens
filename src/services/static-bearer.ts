/**
 * Static bearer auth for hosted (Vercel) deployments.
 *
 * Clients such as Grok Bot present a shared secret as a Bearer token and
 * cannot complete the OAuth/JWT flow. When MCP_STATIC_BEARER is set, a
 * matching Authorization header is accepted, a FreeAgent access token is
 * obtained via the refresh-token grant, and the token is cached in module
 * scope until shortly before expiry. Cold starts simply re-refresh.
 *
 * If MCP_STATIC_BEARER is unset this module is inert. A set bearer with a
 * missing FREEAGENT_REFRESH_TOKEN fails closed, matching JWT_SECRET on Vercel.
 *
 * The module-scope access-token cache is one FreeAgent identity per process
 * (not multi-tenant). Rotating MCP_STATIC_BEARER or FREEAGENT_REFRESH_TOKEN
 * is the only revocation.
 */

import crypto from "crypto";
import axios from "axios";
import {
  API_BASE_URL,
  SANDBOX_API_BASE_URL,
  API_VERSION,
  ALLOWED_FA_HOSTS,
} from "../constants.js";

export type McpStaticScope = "read" | "read_draft" | "full";

const SCOPES = new Set<McpStaticScope>(["read", "read_draft", "full"]);

/** Refresh this many ms before the access token's stated expiry. */
const EXPIRY_SKEW_MS = 30_000;

export interface CachedFreeAgentToken {
  accessToken: string;
  expiresAtMs: number;
}

let cached: CachedFreeAgentToken | undefined;
let refreshInFlight: Promise<string> | undefined;

export interface TokenEndpointResponse {
  access_token?: string;
  expires_in?: number;
}

export type TokenRefresher = () => Promise<TokenEndpointResponse>;

/**
 * Fail closed when static bearer is configured without the refresh token
 * (and the OAuth client credentials the grant needs). No-op when unset.
 */
export function assertStaticBearerConfig(env: NodeJS.ProcessEnv = process.env): void {
  if (!env.MCP_STATIC_BEARER) return;
  if (!env.FREEAGENT_REFRESH_TOKEN) {
    throw new Error(
      "FREEAGENT_REFRESH_TOKEN must be set when MCP_STATIC_BEARER is set. " +
      "The hosted static-bearer path refreshes a FreeAgent access token server-side."
    );
  }
  if (!env.FREEAGENT_CLIENT_ID || !env.FREEAGENT_CLIENT_SECRET) {
    throw new Error(
      "FREEAGENT_CLIENT_ID and FREEAGENT_CLIENT_SECRET must be set when MCP_STATIC_BEARER is set."
    );
  }
  parseStaticScope(env.MCP_STATIC_SCOPE);
}

export function parseStaticScope(raw: string | undefined): McpStaticScope {
  const value = raw ?? "read";
  if (SCOPES.has(value as McpStaticScope)) return value as McpStaticScope;
  throw new Error("MCP_STATIC_SCOPE must be one of: read, read_draft, full.");
}

export function isStaticBearerConfigured(env: NodeJS.ProcessEnv = process.env): boolean {
  return Boolean(env.MCP_STATIC_BEARER);
}

/**
 * Timing-safe comparison of the presented bearer against MCP_STATIC_BEARER.
 * Returns false when static bearer is unset, or when lengths/contents differ.
 */
export function staticBearerMatches(
  presented: string,
  expected: string | undefined = process.env.MCP_STATIC_BEARER
): boolean {
  if (!expected) return false;
  const presentedBuf = Buffer.from(presented);
  const expectedBuf = Buffer.from(expected);
  if (presentedBuf.length !== expectedBuf.length) {
    crypto.timingSafeEqual(expectedBuf, expectedBuf);
    return false;
  }
  return crypto.timingSafeEqual(presentedBuf, expectedBuf);
}

export function extractBearerToken(authorizationHeader: string | undefined): string | undefined {
  if (!authorizationHeader) return undefined;
  const match = /^Bearer\s+(\S+)/i.exec(authorizationHeader);
  return match?.[1];
}

export type McpAuthMode = "static" | "jwt";

/**
 * Choose the hosted auth branch. A matching MCP_STATIC_BEARER wins; otherwise
 * the request falls through to the OAuth/JWT verifier. Does not log tokens.
 */
export function resolveMcpAuthMode(
  authorizationHeader: string | undefined,
  env: NodeJS.ProcessEnv = process.env
): McpAuthMode {
  const presented = extractBearerToken(authorizationHeader);
  if (presented && staticBearerMatches(presented, env.MCP_STATIC_BEARER)) {
    return "static";
  }
  return "jwt";
}

/** Test seam — clears the module-scope access-token cache. */
export function resetStaticTokenCache(): void {
  cached = undefined;
  refreshInFlight = undefined;
}

function tokenEndpointUrl(env: NodeJS.ProcessEnv = process.env): string {
  const useSandbox = env.FREEAGENT_USE_SANDBOX === "true";
  const base = useSandbox ? SANDBOX_API_BASE_URL : API_BASE_URL;
  const url = `${base}/${API_VERSION}/token_endpoint`;
  const host = new URL(url).hostname;
  if (!ALLOWED_FA_HOSTS.has(host)) {
    throw new Error(`Refusing to call non-FreeAgent host "${host}".`);
  }
  return url;
}

/**
 * Exchange FREEAGENT_REFRESH_TOKEN for a FreeAgent access token.
 * FreeAgent refresh tokens are long-lived and are not rotated on use.
 */
export async function refreshFreeAgentAccessToken(
  env: NodeJS.ProcessEnv = process.env,
  post: typeof axios.post = axios.post
): Promise<TokenEndpointResponse> {
  const refreshToken = env.FREEAGENT_REFRESH_TOKEN;
  const clientId = env.FREEAGENT_CLIENT_ID;
  const clientSecret = env.FREEAGENT_CLIENT_SECRET;
  if (!refreshToken || !clientId || !clientSecret) {
    throw new Error(
      "FREEAGENT_REFRESH_TOKEN, FREEAGENT_CLIENT_ID, and FREEAGENT_CLIENT_SECRET are required to refresh."
    );
  }

  try {
    const response = await post<TokenEndpointResponse>(
      tokenEndpointUrl(env),
      new URLSearchParams({
        grant_type: "refresh_token",
        refresh_token: refreshToken,
      }).toString(),
      {
        auth: { username: clientId, password: clientSecret },
        headers: { "Content-Type": "application/x-www-form-urlencoded" },
        timeout: 30_000,
      }
    );
    return response.data ?? {};
  } catch (err) {
    const detail = axios.isAxiosError(err)
      ? `${err.response?.status ?? "network error"}`
      : "error";
    throw new Error(`Failed to refresh the FreeAgent access token (${detail}).`);
  }
}

export async function getCachedFreeAgentAccessToken(opts?: {
  nowMs?: number;
  refresh?: TokenRefresher;
  env?: NodeJS.ProcessEnv;
}): Promise<string> {
  const now = opts?.nowMs ?? Date.now();
  if (cached && cached.expiresAtMs - EXPIRY_SKEW_MS > now) {
    return cached.accessToken;
  }

  if (refreshInFlight) return refreshInFlight;

  const refresh = opts?.refresh ?? (() => refreshFreeAgentAccessToken(opts?.env));

  refreshInFlight = (async () => {
    const tokens = await refresh();
    if (typeof tokens.access_token !== "string" || tokens.access_token.length === 0) {
      throw new Error("Token endpoint returned no access_token.");
    }
    const expiresIn = Number.isFinite(tokens.expires_in) && (tokens.expires_in ?? 0) > 0
      ? (tokens.expires_in as number)
      : 3600;
    cached = {
      accessToken: tokens.access_token,
      expiresAtMs: now + expiresIn * 1000,
    };
    return cached.accessToken;
  })();

  try {
    return await refreshInFlight;
  } finally {
    refreshInFlight = undefined;
  }
}
