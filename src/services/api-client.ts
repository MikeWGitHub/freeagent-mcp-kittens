/**
 * FreeAgent API Client Service
 */

import axios, { AxiosError, AxiosInstance, AxiosRequestConfig } from "axios";
import { API_BASE_URL, SANDBOX_API_BASE_URL, API_VERSION, SERVER_VERSION, ALLOWED_FA_HOSTS } from "../constants.js";
import type { FreeAgentApiError, FreeAgentApiErrorItem } from "../types.js";

export interface ApiResponse<T> {
  data: T;
  headers: Record<string, string>;
}

export interface RefreshConfig {
  clientId: string;
  clientSecret: string;
  refreshToken: string;
}

/** How many times a 429-rejected request is retried before giving up. */
export const RATE_LIMIT_MAX_RETRIES = 2;
/** Upper bound on a single rate-limit wait, whatever Retry-After says. */
export const RATE_LIMIT_MAX_WAIT_MS = 65_000;
/** Wait used when a 429 arrives without a usable Retry-After header. */
export const RATE_LIMIT_DEFAULT_WAIT_MS = 30_000;

/** Default per-request timeout; overridable via FREEAGENT_TIMEOUT_MS. */
export const DEFAULT_TIMEOUT_MS = 30_000;

/** Message for a FreeAgent 404, kept stable for callers and tests. */
export const NOT_FOUND_MESSAGE =
  "Resource not found. The requested item may have been deleted or the URL is incorrect.";

/**
 * An API error that keeps the HTTP status, so callers can branch on it
 * instead of matching message text. Raised for 404s and for statuses without
 * a dedicated message.
 */
export class ApiRequestError extends Error {
  constructor(message: string, readonly status: number) {
    super(message);
    this.name = "ApiRequestError";
  }
}

export function isNotFoundError(error: unknown): boolean {
  return error instanceof ApiRequestError && error.status === 404;
}

export function errorStatus(error: unknown): number | undefined {
  return error instanceof ApiRequestError ? error.status : undefined;
}

function requestTimeoutMs(): number {
  const raw = Number(process.env.FREEAGENT_TIMEOUT_MS);
  return Number.isFinite(raw) && raw > 0 ? raw : DEFAULT_TIMEOUT_MS;
}

/**
 * Parse a Retry-After header (delta-seconds or HTTP-date) into a wait in ms,
 * clamped to [1s, RATE_LIMIT_MAX_WAIT_MS]. Missing/garbage input falls back
 * to RATE_LIMIT_DEFAULT_WAIT_MS.
 */
export function parseRetryAfterMs(headerValue: unknown): number {
  let ms: number | undefined;

  if (typeof headerValue === "string" || typeof headerValue === "number") {
    const asNumber = Number(headerValue);
    if (Number.isFinite(asNumber)) {
      ms = asNumber * 1000;
    } else if (typeof headerValue === "string") {
      const asDate = Date.parse(headerValue);
      if (!Number.isNaN(asDate)) ms = asDate - Date.now();
    }
  }

  if (ms === undefined || !Number.isFinite(ms)) ms = RATE_LIMIT_DEFAULT_WAIT_MS;
  return Math.min(Math.max(ms, 1000), RATE_LIMIT_MAX_WAIT_MS);
}

// Structured stderr logging: stderr is safe on a stdio MCP transport and ends
// up in Claude Desktop's mcp-server-*.log, which is where hangs get diagnosed.
function logWarn(message: string, data?: Record<string, unknown>) {
  console.error(JSON.stringify({ timestamp: new Date().toISOString(), level: "warn", message, ...(data && { data }) }));
}

export class FreeAgentApiClient {
  private axiosInstance: AxiosInstance;
  private accessToken: string;
  private useSandbox: boolean;
  private refreshConfig?: RefreshConfig;
  private refreshInFlight?: Promise<string>;

  constructor(accessToken: string, useSandbox: boolean = false, refreshConfig?: RefreshConfig) {
    this.accessToken = accessToken;
    this.useSandbox = useSandbox;
    this.refreshConfig = refreshConfig;

    const baseURL = useSandbox ? SANDBOX_API_BASE_URL : API_BASE_URL;

    this.axiosInstance = axios.create({
      baseURL: `${baseURL}/${API_VERSION}`,
      headers: {
        "User-Agent": `FreeAgent-MCP-Server/${SERVER_VERSION}`,
        "Accept": "application/json",
        "Content-Type": "application/json"
      },
      timeout: requestTimeoutMs(),
      // Never follow redirects: the bearer is attached per request after the
      // host allowlist check, so a 3xx to another host would carry it (v1.2.3).
      maxRedirects: 0
    });

    // Attach the current token per request rather than freezing it at construction,
    // so a refreshed token is picked up by subsequent calls.
    this.axiosInstance.interceptors.request.use(async (config) => {
      // SSRF guard (audit S-HIGH-1): tools accept "ID or full URL" arguments
      // and many pass absolute URLs straight through. Axios ignores baseURL
      // for absolute URLs, and this interceptor attaches the FreeAgent bearer
      // token — so an injected URL would ship credentials to an arbitrary
      // host. Normalize every absolute URL to a relative /v2 path against an
      // allowlisted FreeAgent host before the request leaves the process.
      if (config.url && /^https?:\/\//i.test(config.url)) {
        config.url = this.toRelativePath(config.url);
      }
      if (!this.accessToken && this.refreshConfig) {
        await this.refreshAccessToken();
      }
      config.headers.set("Authorization", `Bearer ${this.accessToken}`);
      return config;
    });

    // FreeAgent access tokens expire after roughly an hour. Without this, a
    // long-running stdio session dies mid-task and needs a manual re-mint.
    // 429s are retried with backoff because the sandbox allows only 5
    // requests/min (production 15/min) and several tools make 2-3 API calls.
    this.axiosInstance.interceptors.response.use(
      (response) => response,
      async (error: AxiosError) => {
        const original = error.config as
          | (AxiosRequestConfig & { _retried?: boolean; _rateLimitRetries?: number })
          | undefined;

        if (
          error.response?.status === 401 &&
          this.refreshConfig &&
          original &&
          !original._retried
        ) {
          original._retried = true;
          await this.refreshAccessToken();
          return this.axiosInstance.request(original);
        }

        if (error.response?.status === 429 && original) {
          const attempts = original._rateLimitRetries ?? 0;
          if (attempts < RATE_LIMIT_MAX_RETRIES) {
            original._rateLimitRetries = attempts + 1;
            // Full jitter (audit R-HIGH-1) so parallel tool calls don't
            // stampede FreeAgent in lockstep after a shared 429. On Vercel
            // the function budget is 60s, so cap the sleep well below it
            // (audit R-CRIT-4) — better a clean rate-limit error than a 504.
            let waitMs = parseRetryAfterMs(error.response.headers?.["retry-after"]);
            waitMs += Math.floor(Math.random() * 1000);
            if (process.env.VERCEL) waitMs = Math.min(waitMs, 20_000);
            logWarn("FreeAgent rate limit hit (429); backing off before retrying", {
              url: original.url,
              attempt: original._rateLimitRetries,
              maxRetries: RATE_LIMIT_MAX_RETRIES,
              waitMs,
              environment: this.useSandbox ? "sandbox" : "production",
            });
            await this.sleep(waitMs);
            return this.axiosInstance.request(original);
          }
          logWarn("FreeAgent rate limit hit (429); retries exhausted", {
            url: original.url,
            attempts,
          });
        }

        return Promise.reject(error);
      }
    );
  }

  /** Wrapped so tests can stub the wait without faking global timers. */
  private sleep(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }

  /**
   * Convert an absolute FreeAgent URL to a relative /v2 path, rejecting any
   * host outside the allowlist. A cross-environment URL (production URL while
   * running against sandbox, or vice versa) is accepted but logged: IDs are
   * environment-local, so the caller almost certainly meant the active one.
   */
  private toRelativePath(absoluteUrl: string): string {
    let parsed: URL;
    try {
      parsed = new URL(absoluteUrl);
    } catch {
      throw new Error(`Invalid resource URL: ${absoluteUrl}`);
    }
    if (!ALLOWED_FA_HOSTS.has(parsed.hostname)) {
      throw new Error(
        `Refusing to call non-FreeAgent host "${parsed.hostname}". ` +
        `Resource URLs must point at api.freeagent.com or api.sandbox.freeagent.com.`
      );
    }
    const activeHost = new URL(this.useSandbox ? SANDBOX_API_BASE_URL : API_BASE_URL).hostname;
    if (parsed.hostname !== activeHost) {
      logWarn("Cross-environment FreeAgent URL normalised to the active environment", {
        given: parsed.hostname,
        active: activeHost,
      });
    }
    const path = parsed.pathname.replace(new RegExp(`^/${API_VERSION}`), "");
    return `${path}${parsed.search}`;
  }

  /**
   * Build a full resource URL in the ACTIVE environment from an ID or URL.
   * Use this instead of hardcoding https://api.freeagent.com/... in payload
   * and query builders — hardcoded production hosts silently point sandbox
   * sessions at production resources (audit B-HIGH-1).
   */
  resourceUrl(resource: string, idOrUrl: string): string {
    const base = this.useSandbox ? SANDBOX_API_BASE_URL : API_BASE_URL;
    if (/^https?:\/\//i.test(idOrUrl)) {
      // Validate + re-home to the active environment.
      return `${base}/${API_VERSION}${this.toRelativePath(idOrUrl).split("?")[0]}`;
    }
    return `${base}/${API_VERSION}/${resource}/${idOrUrl}`;
  }


  /**
   * Exchange the refresh token for a new access token.
   * Concurrent callers share a single in-flight refresh so a burst of parallel
   * tool calls does not trigger several redundant token exchanges.
   */
  private async refreshAccessToken(): Promise<string> {
    if (!this.refreshConfig) {
      throw new Error(
        "Access token expired and no refresh credentials are configured. " +
        "Set FREEAGENT_CLIENT_ID, FREEAGENT_CLIENT_SECRET and FREEAGENT_REFRESH_TOKEN."
      );
    }

    if (this.refreshInFlight) return this.refreshInFlight;

    const baseURL = this.useSandbox ? SANDBOX_API_BASE_URL : API_BASE_URL;
    const { clientId, clientSecret, refreshToken } = this.refreshConfig;

    this.refreshInFlight = (async () => {
      try {
        // Plain axios, not the instance, to avoid re-entering the interceptors.
        const response = await axios.post<{ access_token: string }>(
          `${baseURL}/${API_VERSION}/token_endpoint`,
          new URLSearchParams({
            grant_type: "refresh_token",
            refresh_token: refreshToken
          }).toString(),
          {
            auth: { username: clientId, password: clientSecret },
            headers: { "Content-Type": "application/x-www-form-urlencoded" },
            // Bounded so a stalled token endpoint can never wedge the shared
            // in-flight refresh promise (and with it every queued request).
            timeout: requestTimeoutMs()
          }
        );

        if (!response.data?.access_token) {
          throw new Error("Token endpoint returned no access_token.");
        }

        this.accessToken = response.data.access_token;
        return this.accessToken;
      } catch (err) {
        const detail = axios.isAxiosError(err)
          ? `${err.response?.status ?? "network error"}`
          : String(err);
        throw new Error(
          `Failed to refresh the FreeAgent access token (${detail}). ` +
          "The refresh token may have been revoked; re-run the OAuth flow."
        );
      } finally {
        this.refreshInFlight = undefined;
      }
    })();

    return this.refreshInFlight;
  }

  /**
   * Make a GET request to the FreeAgent API
   */
  async get<T>(endpoint: string, params?: Record<string, string | number | boolean | undefined>): Promise<ApiResponse<T>> {
    try {
      const config: AxiosRequestConfig = { params };
      const response = await this.axiosInstance.get<T>(endpoint, config);
      return { data: response.data, headers: response.headers as Record<string, string> };
    } catch (error) {
      throw this.handleError(error);
    }
  }

  /**
   * Make a POST request to the FreeAgent API
   */
  async post<T>(endpoint: string, data?: unknown): Promise<ApiResponse<T>> {
    try {
      const response = await this.axiosInstance.post<T>(endpoint, data);
      return { data: response.data, headers: response.headers as Record<string, string> };
    } catch (error) {
      throw this.handleError(error);
    }
  }

  /**
   * Make a PUT request to the FreeAgent API
   */
  async put<T>(endpoint: string, data?: unknown): Promise<ApiResponse<T>> {
    try {
      const response = await this.axiosInstance.put<T>(endpoint, data);
      return { data: response.data, headers: response.headers as Record<string, string> };
    } catch (error) {
      throw this.handleError(error);
    }
  }

  /**
   * Make a DELETE request to the FreeAgent API
   */
  async delete<T>(endpoint: string): Promise<ApiResponse<T>> {
    try {
      const response = await this.axiosInstance.delete<T>(endpoint);
      return { data: response.data, headers: response.headers as Record<string, string> };
    } catch (error) {
      throw this.handleError(error);
    }
  }

  /**
   * Handle API errors and convert them to user-friendly messages
   */
  private handleError(error: unknown): Error {
    if (axios.isAxiosError(error)) {
      const axiosError = error as AxiosError<FreeAgentApiError>;

      if (axiosError.response) {
        const status = axiosError.response.status;
        const data = axiosError.response.data;

        // Rate limiting (surfaced only after automatic retries are exhausted)
        if (status === 429) {
          // Parse the header the same way the retry path does, rather than
          // echoing it raw with a fallback that disagreed with the actual
          // default wait (audit finding, v1.1.1 pass).
          const waitSeconds = Math.ceil(
            parseRetryAfterMs(axiosError.response.headers["retry-after"]) / 1000
          );
          const limit = this.useSandbox
            ? "5 requests per 60 seconds (sandbox)"
            : "15 requests per 60 seconds";
          return new Error(
            `Rate limit exceeded and automatic retries (${RATE_LIMIT_MAX_RETRIES}) were exhausted. ` +
            `Wait ${waitSeconds} seconds before the next call. FreeAgent allows ${limit}.`
          );
        }

        // Authentication errors
        if (status === 401) {
          return new Error(
            "Authentication failed. Your access token may be expired or invalid. " +
            "Please refresh your OAuth token."
          );
        }

        // Authorization errors
        if (status === 403) {
          return new Error(
            "Access forbidden. Your account may not have permission to access this resource. " +
            "Check your FreeAgent account permissions."
          );
        }

        // Not found
        if (status === 404) {
          return new ApiRequestError(NOT_FOUND_MESSAGE, 404);
        }

        // Validation errors
        if (status === 422 && data && data.errors) {
          let errorMessages: string;

          // Check if errors is an array or object
          if (Array.isArray(data.errors)) {
            // Handle array of error objects
            errorMessages = data.errors
              .map((errorItem: string | FreeAgentApiErrorItem) => {
                if (typeof errorItem === 'string') return errorItem;
                if (errorItem && errorItem.message) return errorItem.message;
                return JSON.stringify(errorItem);
              })
              .join("; ");
          } else {
            // Handle object with field names as keys
            errorMessages = Object.entries(data.errors)
              .map(([field, messages]) => {
                // Handle different error message formats
                let messageStr: string;
                if (Array.isArray(messages)) {
                  messageStr = messages.join(", ");
                } else if (typeof messages === 'object' && messages !== null) {
                  // Handle nested error objects
                  if ('message' in messages) {
                    messageStr = String(messages.message);
                  } else {
                    messageStr = JSON.stringify(messages);
                  }
                } else {
                  messageStr = String(messages);
                }
                return `${field}: ${messageStr}`;
              })
              .join("; ");
          }

          return new Error(
            `Validation error: ${errorMessages}. Please check your input and try again.`
          );
        }

        // Generic error with message
        if (data && data.message) {
          return new ApiRequestError(`API error: ${data.message}`, status);
        }

        return new ApiRequestError(`API request failed with status ${status}`, status);
      }

      // Network or timeout errors
      if (axiosError.code === "ECONNABORTED") {
        return new Error(
          "Request timeout. The FreeAgent API took too long to respond. Please try again."
        );
      }

      if (axiosError.code === "ENOTFOUND" || axiosError.code === "ECONNREFUSED") {
        return new Error(
          "Network error. Unable to connect to FreeAgent API. Please check your internet connection."
        );
      }
    }

    // Unknown error
    return new Error(`Unexpected error: ${error instanceof Error ? error.message : String(error)}`);
  }

  /**
   * Parse pagination info from response headers
   */
  parsePaginationHeaders(
    headers: Record<string, string | undefined>,
    page?: number,
    perPage?: number
  ): {
    totalCount?: number;
    hasMore: boolean;
    nextPage?: number;
  } {
    const totalCount = headers["x-total-count"] 
      ? parseInt(headers["x-total-count"], 10) 
      : undefined;

    const linkHeader = headers["link"];
    let hasMore = false;
    let nextPage: number | undefined;

    if (linkHeader) {
      // Parse Link header: <url>; rel="next", <url>; rel="last"
      const links = linkHeader.split(",").map(link => link.trim());
      const nextLink = links.find(link => /rel\s*=\s*"?next"?/i.test(link));

      if (nextLink) {
        hasMore = true;
        const urlMatch = nextLink.match(/<([^>]+)>/);
        if (urlMatch) {
          try {
            // Tolerate relative links as well as absolute ones.
            const url = new URL(urlMatch[1], "https://api.freeagent.com");
            const pageParam = url.searchParams.get("page");
            if (pageParam) {
              nextPage = parseInt(pageParam, 10);
            }
          } catch {
            // Keep hasMore; leave nextPage for the caller to compute.
          }
        }
      }
    }

    // Fallback when no usable Link header arrives: live list calls were seen
    // reporting has_more: false on every page despite X-Total-Count showing
    // more rows. If the caller passes page/perPage, derive it from the count.
    if (!hasMore && totalCount !== undefined && page !== undefined && perPage !== undefined) {
      if (page * perPage < totalCount) {
        hasMore = true;
        nextPage = page + 1;
      }
    }

    return { totalCount, hasMore, nextPage };
  }
}

/**
 * Format error message for LLM consumption
 */
export function formatErrorForLLM(error: Error): string {
  return `Error: ${error.message}`;
}

/**
 * Fetch every page of a list endpoint (up to maxPages), concatenating the
 * items under `key`. Single-page reads silently truncate at 100 rows — which
 * live use showed corrupts reconciliation verdicts and resolver matches
 * (audit B-HIGH-2/3/4). Standalone function (not a client method) so tests
 * can keep mocking just get() + parsePaginationHeaders().
 */
export async function fetchAllPages<T>(
  client: Pick<FreeAgentApiClient, "get" | "parsePaginationHeaders">,
  endpoint: string,
  params: Record<string, string | number | boolean | undefined>,
  key: string,
  maxPages: number = 10
): Promise<{ items: T[]; pagesFetched: number; capped: boolean }> {
  const items: T[] = [];
  let page = 1;
  let capped = false;
  for (;;) {
    const response = await client.get<Record<string, T[]>>(endpoint, {
      ...params,
      page,
      per_page: 100,
    });
    items.push(...(response.data[key] ?? []));
    const pagination = client.parsePaginationHeaders(response.headers, page, 100);
    if (!pagination.hasMore) break;
    if (page >= maxPages) {
      capped = true;
      break;
    }
    page = pagination.nextPage ?? page + 1;
  }
  return { items, pagesFetched: page, capped };
}
