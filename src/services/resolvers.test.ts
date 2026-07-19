import { describe, it, expect, vi } from "vitest";
import { resolveCategory } from "./resolvers.js";
import type { FreeAgentApiClient } from "./api-client.js";

function clientReturning(data: unknown): FreeAgentApiClient {
  return { get: vi.fn().mockResolvedValue({ data, headers: {} }) } as unknown as FreeAgentApiClient;
}

describe("resolveCategory with a numeric nominal code", () => {
  // The single-category endpoint wraps its result under a type-dependent key
  // (dev.freeagent.com/docs/categories), e.g. admin_expenses_categories for
  // nominal codes 200-399. Reading `data.category` broke create_journal_set
  // with nominal-code hints against the sandbox on 19 Jul 2026.
  const url = "https://api.sandbox.freeagent.com/v2/categories/280";

  it("unwraps admin_expenses_categories (object form)", async () => {
    const client = clientReturning({
      admin_expenses_categories: { url, description: "Sundries", nominal_code: "280" },
    });
    expect(await resolveCategory(client, "280")).toBe(url);
  });

  it("unwraps income_categories (array form)", async () => {
    const client = clientReturning({
      income_categories: [{ url, description: "Sales", nominal_code: "001" }],
    });
    expect(await resolveCategory(client, "001")).toBe(url);
  });

  it("still accepts a plain category key if the API ever returns one", async () => {
    const client = clientReturning({
      category: { url, description: "Sundries", nominal_code: "280" },
    });
    expect(await resolveCategory(client, "280")).toBe(url);
  });

  it("throws a clear error on an unrecognised shape instead of a TypeError", async () => {
    const client = clientReturning({ something_else: {} });
    await expect(resolveCategory(client, "280")).rejects.toThrow(
      /unrecognised shape/
    );
  });

  it("passes URLs through untouched", async () => {
    const client = clientReturning({});
    expect(await resolveCategory(client, url)).toBe(url);
  });
});
