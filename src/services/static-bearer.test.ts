import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import {
  assertStaticBearerConfig,
  extractBearerToken,
  getCachedFreeAgentAccessToken,
  parseStaticScope,
  refreshFreeAgentAccessToken,
  resetStaticTokenCache,
  staticBearerMatches,
} from "./static-bearer.js";
import { toolDefinitions, toolsForScope } from "../tools/register.js";

const ENV_KEYS = [
  "MCP_STATIC_BEARER",
  "FREEAGENT_REFRESH_TOKEN",
  "FREEAGENT_CLIENT_ID",
  "FREEAGENT_CLIENT_SECRET",
  "MCP_STATIC_SCOPE",
  "FREEAGENT_USE_SANDBOX",
] as const;

const saved: Record<string, string | undefined> = {};

beforeEach(() => {
  for (const key of ENV_KEYS) saved[key] = process.env[key];
  resetStaticTokenCache();
});

afterEach(() => {
  for (const key of ENV_KEYS) {
    if (saved[key] === undefined) delete process.env[key];
    else process.env[key] = saved[key];
  }
  resetStaticTokenCache();
});

describe("staticBearerMatches", () => {
  it("returns false when MCP_STATIC_BEARER is unset", () => {
    expect(staticBearerMatches("anything", undefined)).toBe(false);
  });

  it("accepts an exact match via timingSafeEqual", () => {
    expect(staticBearerMatches("shared-secret", "shared-secret")).toBe(true);
  });

  it("rejects a same-length mismatch", () => {
    expect(staticBearerMatches("shared-secret", "shared-secreX")).toBe(false);
  });

  it("rejects a different-length mismatch without throwing", () => {
    expect(staticBearerMatches("short", "much-longer-secret")).toBe(false);
  });
});

describe("extractBearerToken", () => {
  it("reads a Bearer token case-insensitively", () => {
    expect(extractBearerToken("Bearer abc")).toBe("abc");
    expect(extractBearerToken("bearer abc")).toBe("abc");
  });

  it("returns undefined when the header is missing or malformed", () => {
    expect(extractBearerToken(undefined)).toBeUndefined();
    expect(extractBearerToken("Basic abc")).toBeUndefined();
  });
});

describe("assertStaticBearerConfig", () => {
  it("is a no-op when MCP_STATIC_BEARER is unset", () => {
    expect(() => assertStaticBearerConfig({})).not.toThrow();
  });

  it("fails closed when the refresh token is missing", () => {
    expect(() =>
      assertStaticBearerConfig({
        MCP_STATIC_BEARER: "secret",
        FREEAGENT_CLIENT_ID: "id",
        FREEAGENT_CLIENT_SECRET: "cs",
      })
    ).toThrow(/FREEAGENT_REFRESH_TOKEN must be set/);
  });

  it("accepts a fully configured static-bearer env", () => {
    expect(() =>
      assertStaticBearerConfig({
        MCP_STATIC_BEARER: "secret",
        FREEAGENT_REFRESH_TOKEN: "rt",
        FREEAGENT_CLIENT_ID: "id",
        FREEAGENT_CLIENT_SECRET: "cs",
      })
    ).not.toThrow();
  });
});

describe("parseStaticScope", () => {
  it("defaults to read", () => {
    expect(parseStaticScope(undefined)).toBe("read");
  });

  it("accepts read_draft and full", () => {
    expect(parseStaticScope("read_draft")).toBe("read_draft");
    expect(parseStaticScope("full")).toBe("full");
  });

  it("rejects unknown values", () => {
    expect(() => parseStaticScope("write")).toThrow(/MCP_STATIC_SCOPE/);
  });
});

describe("getCachedFreeAgentAccessToken", () => {
  it("reuses the cached token until expiry", async () => {
    const refresh = vi.fn(async () => ({ access_token: "fa-access-1", expires_in: 3600 }));
    const first = await getCachedFreeAgentAccessToken({ nowMs: 1_000, refresh });
    const second = await getCachedFreeAgentAccessToken({ nowMs: 2_000, refresh });
    expect(first).toBe("fa-access-1");
    expect(second).toBe("fa-access-1");
    expect(refresh).toHaveBeenCalledTimes(1);
  });

  it("refreshes after expiry (including skew)", async () => {
    const refresh = vi
      .fn()
      .mockResolvedValueOnce({ access_token: "fa-access-1", expires_in: 60 })
      .mockResolvedValueOnce({ access_token: "fa-access-2", expires_in: 60 });

    const first = await getCachedFreeAgentAccessToken({ nowMs: 0, refresh });
    // 60s expiry minus 30s skew = 30_000; at 30_001 the cache is stale.
    const second = await getCachedFreeAgentAccessToken({ nowMs: 30_001, refresh });
    expect(first).toBe("fa-access-1");
    expect(second).toBe("fa-access-2");
    expect(refresh).toHaveBeenCalledTimes(2);
  });

  it("does not include the access token in refresh-failure messages", async () => {
    const refresh = vi.fn(async () => {
      throw new Error("Failed to refresh the FreeAgent access token (401).");
    });
    await expect(getCachedFreeAgentAccessToken({ refresh })).rejects.toThrow(/401/);
    await expect(getCachedFreeAgentAccessToken({ refresh })).rejects.not.toThrow(/fa-access/);
  });
});

describe("refreshFreeAgentAccessToken host allowlist", () => {
  it("posts to the sandbox token endpoint when FREEAGENT_USE_SANDBOX=true", async () => {
    let postedUrl = "";
    const post = (async (url: string) => {
      postedUrl = url;
      return { data: { access_token: "x", expires_in: 3600 } };
    }) as typeof import("axios").default.post;
    await refreshFreeAgentAccessToken(
      {
        FREEAGENT_REFRESH_TOKEN: "rt",
        FREEAGENT_CLIENT_ID: "id",
        FREEAGENT_CLIENT_SECRET: "cs",
        FREEAGENT_USE_SANDBOX: "true",
      },
      post
    );
    expect(postedUrl).toBe("https://api.sandbox.freeagent.com/v2/token_endpoint");
  });
});

describe("toolsForScope", () => {
  it("read registers only list_* and get_* tools", () => {
    const tools = toolsForScope("read");
    expect(tools.every((t) => /^freeagent_(list|get)_/.test(t.name))).toBe(true);
    expect(tools.find((t) => t.name === "freeagent_create_contact")).toBeUndefined();
    expect(tools.find((t) => t.name === "freeagent_create_bank_transaction_explanation")).toBeUndefined();
    expect(tools.find((t) => t.name === "freeagent_get_trial_balance")).toBeDefined();
  });

  it("read_draft adds create_bank_transaction_explanation and no other writes", () => {
    const read = toolsForScope("read");
    const draft = toolsForScope("read_draft");
    expect(draft).toHaveLength(read.length + 1);
    expect(draft.some((t) => t.name === "freeagent_create_bank_transaction_explanation")).toBe(true);
    expect(draft.some((t) => t.name === "freeagent_create_invoice")).toBe(false);
  });

  it("full registers the entire catalog", () => {
    expect(toolsForScope("full")).toHaveLength(toolDefinitions.length);
    expect(toolDefinitions).toHaveLength(88);
  });

  it("forces marked_for_review true on read_draft create explanation regardless of input", async () => {
    const wrapped = toolsForScope("read_draft").find(
      (t) => t.name === "freeagent_create_bank_transaction_explanation"
    )!;
    let postedBody: unknown;
    const post = vi.fn(async (_path: string, body?: unknown) => {
      postedBody = body;
      return {
        data: {
          bank_transaction_explanation: {
            url: "https://api.freeagent.com/v2/bank_transaction_explanations/9",
            dated_on: "2026-08-01",
            gross_value: "-10.00",
            description: "draft",
          },
        },
        headers: {},
      };
    });
    const client = { post } as never;

    await wrapped.handler(
      client,
      {
        bank_transaction: "https://api.freeagent.com/v2/bank_transactions/1",
        dated_on: "2026-08-01",
        gross_value: "-10.00",
        marked_for_review: false,
      },
      { clientSupportsElicitation: false, elicit: async () => ({ action: "cancel" }) as never }
    );

    expect(
      (postedBody as { bank_transaction_explanation: { marked_for_review: boolean } })
        .bank_transaction_explanation.marked_for_review
    ).toBe(true);
  });
});
