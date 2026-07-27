/**
 * Regression tests for the v1.1.1 audit fixes (Grok static audit, 27 Jul 2026):
 * getCategory unwrap (B-CRIT-1), SSRF/absolute-URL guard (S-HIGH-1),
 * multi-page fetching (B-HIGH-2/3/4), sandbox-aware resourceUrl (B-HIGH-1),
 * auto_sales_tax_rate display (B-MED-2), and local-date defaults (B-MED-3).
 */

import { describe, it, expect, vi } from "vitest";
import { FreeAgentApiClient, fetchAllPages } from "../services/api-client.js";
import { getCategory } from "./categories.js";
import { todayLocalISO } from "../services/formatter.js";
import { ResponseFormat } from "../constants.js";

function makeMock(handlers: { get?: (path: string, params?: unknown) => unknown }) {
  const calls: Array<{ path: string; params?: unknown }> = [];
  const client = {
    get: vi.fn(async (path: string, params?: unknown) => {
      calls.push({ path, params });
      const result = handlers.get?.(path, params);
      // Allow handlers to return { data, headers } directly for pagination tests
      if (result && typeof result === "object" && "data" in (result as object)) {
        return result;
      }
      return { data: result, headers: {} };
    }),
    parsePaginationHeaders: (headers: Record<string, string>) => {
      const link = headers?.link;
      if (link && link.includes('rel="next"')) {
        const match = /[?&]page=(\d+)[^>]*>;\s*rel="next"/.exec(link);
        return { hasMore: true, nextPage: match ? Number(match[1]) : undefined };
      }
      return { hasMore: false };
    },
  } as unknown as FreeAgentApiClient;
  return { client, calls };
}

describe("getCategory unwrap (audit B-CRIT-1)", () => {
  it("reads the type-dependent wrapper key, not response.data.category", async () => {
    const { client } = makeMock({
      get: () => ({
        admin_expenses_categories: [
          {
            url: "https://api.freeagent.com/v2/categories/285",
            description: "Accommodation and Meals",
            nominal_code: "285",
            allowable_for_tax: true,
          },
        ],
      }),
    });

    const result = await getCategory(client, {
      nominal_code: "285",
      response_format: ResponseFormat.MARKDOWN,
    });

    expect(result).toContain("Accommodation and Meals");
    expect(result).toContain("285");
    expect(result).not.toContain("undefined");
  });

  it("throws a clear error when the response shape is unrecognised", async () => {
    const { client } = makeMock({ get: () => ({ something_else: [] }) });

    await expect(
      getCategory(client, { nominal_code: "999", response_format: ResponseFormat.MARKDOWN })
    ).rejects.toThrow(/unrecognised shape|does not exist/);
  });

  it("renders a string auto_sales_tax_rate verbatim instead of NaN%", async () => {
    const { client } = makeMock({
      get: () => ({
        income_categories: [
          {
            url: "https://api.freeagent.com/v2/categories/001",
            description: "Sales",
            nominal_code: "001",
            auto_sales_tax_rate: "Standard rate",
          },
        ],
      }),
    });

    const result = await getCategory(client, {
      nominal_code: "001",
      response_format: ResponseFormat.MARKDOWN,
    });
    expect(result).toContain("Standard rate");
    expect(result).not.toContain("NaN");
  });
});

describe("SSRF guard (audit S-HIGH-1)", () => {
  it("refuses to send requests to non-FreeAgent hosts", async () => {
    const client = new FreeAgentApiClient("test-token", false);
    await expect(client.get("https://evil.example.com/v2/contacts/1")).rejects.toThrow(
      /non-FreeAgent host/
    );
  });

  it("resourceUrl builds sandbox URLs in sandbox mode (audit B-HIGH-1)", () => {
    const sandbox = new FreeAgentApiClient("t", true);
    expect(sandbox.resourceUrl("contacts", "123")).toBe(
      "https://api.sandbox.freeagent.com/v2/contacts/123"
    );
    const production = new FreeAgentApiClient("t", false);
    expect(production.resourceUrl("contacts", "123")).toBe(
      "https://api.freeagent.com/v2/contacts/123"
    );
  });

  it("resourceUrl re-homes a cross-environment URL to the active environment", () => {
    const sandbox = new FreeAgentApiClient("t", true);
    expect(sandbox.resourceUrl("contacts", "https://api.freeagent.com/v2/contacts/9")).toBe(
      "https://api.sandbox.freeagent.com/v2/contacts/9"
    );
  });

  it("resourceUrl rejects a non-FreeAgent absolute URL", () => {
    const client = new FreeAgentApiClient("t", false);
    expect(() => client.resourceUrl("contacts", "https://evil.example.com/v2/contacts/9")).toThrow(
      /non-FreeAgent host/
    );
  });
});

describe("fetchAllPages (audit B-HIGH-2/3/4)", () => {
  it("concatenates every page until has_more is false", async () => {
    const { client, calls } = makeMock({
      get: (_path, params) => {
        const page = (params as { page: number }).page;
        if (page === 1) {
          return {
            data: { invoices: [{ reference: "A" }, { reference: "B" }] },
            headers: { link: '<https://api.freeagent.com/v2/invoices?page=2>; rel="next"' },
          };
        }
        return { data: { invoices: [{ reference: "C" }] }, headers: {} };
      },
    });

    const { items, pagesFetched, capped } = await fetchAllPages<{ reference: string }>(
      client,
      "/invoices",
      { view: "recent_open_or_overdue" },
      "invoices"
    );

    expect(items.map((i) => i.reference)).toEqual(["A", "B", "C"]);
    expect(pagesFetched).toBe(2);
    expect(capped).toBe(false);
    expect(calls.length).toBe(2);
  });

  it("stops at maxPages and reports capped", async () => {
    const { client } = makeMock({
      get: (_path, params) => {
        const page = (params as { page: number }).page;
        return {
          data: { rows: [{ n: page }] },
          headers: { link: `<x?page=${page + 1}>; rel="next"` },
        };
      },
    });

    const { items, capped } = await fetchAllPages<{ n: number }>(client, "/x", {}, "rows", 3);
    expect(items.length).toBe(3);
    expect(capped).toBe(true);
  });
});

describe("todayLocalISO (audit B-MED-3)", () => {
  it("uses the local calendar date, not the UTC date", () => {
    // 00:30 local on 15 June: UTC conversion in a positive-offset zone would
    // report 14 June. The helper must return the local date regardless.
    const localMidnightish = new Date(2026, 5, 15, 0, 30, 0);
    expect(todayLocalISO(localMidnightish)).toBe("2026-06-15");
  });
});
