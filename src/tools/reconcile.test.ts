import { describe, it, expect, vi } from "vitest";
import type { FreeAgentApiClient } from "../services/api-client.js";
import { reconcileBankTransaction } from "./reconcile.js";

interface Call {
  method: "get" | "post";
  path: string;
  params?: unknown;
  body?: unknown;
}

function makeClient(handlers: {
  get?: (path: string, params?: unknown) => unknown;
  post?: (path: string, body?: unknown) => unknown;
}): { client: FreeAgentApiClient; calls: Call[] } {
  const calls: Call[] = [];
  const client = {
    get: vi.fn(async (path: string, params?: unknown) => {
      calls.push({ method: "get", path, params });
      const data = handlers.get?.(path, params);
      return { data, headers: {} };
    }),
    post: vi.fn(async (path: string, body?: unknown) => {
      calls.push({ method: "post", path, body });
      const data = handlers.post?.(path, body);
      return { data, headers: {} };
    }),
    parsePaginationHeaders: () => ({ hasMore: false }),
    resourceUrl: (resource: string, idOrUrl: string) =>
      idOrUrl.startsWith("http")
        ? idOrUrl
        : `https://api.freeagent.com/v2/${resource}/${idOrUrl}`,
  } as unknown as FreeAgentApiClient;
  return { client, calls };
}

const baseTx = {
  url: "https://api.freeagent.com/v2/bank_transactions/42",
  bank_account: "https://api.freeagent.com/v2/bank_accounts/1",
  dated_on: "2026-04-01",
  // Real bank transactions carry amount/unexplained_amount, NOT gross_value.
  amount: "-18.50",
  unexplained_amount: "-18.50",
  description: "UBER TRIP",
};

describe("reconcileBankTransaction", () => {
  it("resolves a category name and creates an explanation in one call sequence", async () => {
    const { client, calls } = makeClient({
      get: (path) => {
        if (path === "/bank_transactions/42") return { bank_transaction: baseTx };
        if (path === "/categories") {
          return {
            admin_expenses_categories: [
              { url: "https://api.freeagent.com/v2/categories/285", description: "Travel", nominal_code: "285" },
              { url: "https://api.freeagent.com/v2/categories/286", description: "Accommodation", nominal_code: "286" },
            ],
          };
        }
      },
      post: () => ({
        bank_transaction_explanation: {
          url: "https://api.freeagent.com/v2/bank_transaction_explanations/99",
          bank_transaction: baseTx.url,
          dated_on: baseTx.dated_on,
          gross_value: baseTx.amount,
          category: "https://api.freeagent.com/v2/categories/285",
          description: "Uber to client meeting",
        },
      }),
    });

    const result = await reconcileBankTransaction(client, {
      bank_transaction_id: "42",
      category: "travel",
      description: "Uber to client meeting",
    });

    expect(result).toContain("✅ Reconciled bank transaction 42");
    expect(result).toContain("/categories/285");

    const post = calls.find((c) => c.method === "post");
    expect(post?.body).toMatchObject({
      bank_transaction_explanation: {
        bank_transaction: baseTx.url,
        dated_on: "2026-04-01",
        gross_value: "-18.50",
        category: "https://api.freeagent.com/v2/categories/285",
        description: "Uber to client meeting",
      },
    });
  });

  it("resolves a nominal code via direct GET (no list call)", async () => {
    const { client, calls } = makeClient({
      get: (path) => {
        if (path === "/bank_transactions/42") return { bank_transaction: baseTx };
        if (path === "/categories/285") {
          return {
            category: {
              url: "https://api.freeagent.com/v2/categories/285",
              description: "Travel",
              nominal_code: "285",
            },
          };
        }
      },
      post: () => ({
        bank_transaction_explanation: {
          url: "https://api.freeagent.com/v2/bank_transaction_explanations/99",
          bank_transaction: baseTx.url,
          dated_on: baseTx.dated_on,
          gross_value: baseTx.amount,
          category: "https://api.freeagent.com/v2/categories/285",
        },
      }),
    });

    await reconcileBankTransaction(client, {
      bank_transaction_id: "42",
      category: "285",
    });

    expect(calls.map((c) => c.path)).not.toContain("/categories");
    expect(calls.map((c) => c.path)).toContain("/categories/285");
  });

  it("passes a URL category through without a lookup", async () => {
    const url = "https://api.freeagent.com/v2/categories/285";
    const { client, calls } = makeClient({
      get: () => ({ bank_transaction: baseTx }),
      post: () => ({
        bank_transaction_explanation: {
          url: "https://api.freeagent.com/v2/bank_transaction_explanations/99",
          bank_transaction: baseTx.url,
          dated_on: baseTx.dated_on,
          gross_value: baseTx.amount,
          category: url,
        },
      }),
    });

    await reconcileBankTransaction(client, {
      bank_transaction_id: "42",
      category: url,
    });

    const gets = calls.filter((c) => c.method === "get");
    expect(gets).toHaveLength(1);
    expect(gets[0].path).toBe("/bank_transactions/42");
  });

  it("errors with suggestions when a category name is ambiguous", async () => {
    const { client } = makeClient({
      get: (path) => {
        if (path === "/bank_transactions/42") return { bank_transaction: baseTx };
        if (path === "/categories") {
          return {
            admin_expenses_categories: [
              { url: "https://x/285", description: "Travel", nominal_code: "285" },
              { url: "https://x/286", description: "Travel - Overseas", nominal_code: "286" },
            ],
          };
        }
      },
    });

    await expect(
      reconcileBankTransaction(client, {
        bank_transaction_id: "42",
        category: "trav",
      })
    ).rejects.toThrow(/matches multiple categories/);
  });

  it("errors helpfully when no category matches", async () => {
    const { client } = makeClient({
      get: (path) => {
        if (path === "/bank_transactions/42") return { bank_transaction: baseTx };
        if (path === "/categories") return { admin_expenses_categories: [] };
      },
    });

    await expect(
      reconcileBankTransaction(client, {
        bank_transaction_id: "42",
        category: "bogus",
      })
    ).rejects.toThrow(/freeagent_list_categories/);
  });

  it("resolves an invoice reference and links it as paid_invoice", async () => {
    const invoiceUrl = "https://api.freeagent.com/v2/invoices/7";
    const { client, calls } = makeClient({
      get: (path, params) => {
        if (path === "/bank_transactions/42") return { bank_transaction: baseTx };
        if (path === "/invoices") {
          expect(params).toMatchObject({ view: "recent_open_or_overdue" });
          return {
            invoices: [
              { url: invoiceUrl, reference: "INV-001" },
              { url: "https://api.freeagent.com/v2/invoices/8", reference: "INV-002" },
            ],
          };
        }
      },
      post: () => ({
        bank_transaction_explanation: {
          url: "https://api.freeagent.com/v2/bank_transaction_explanations/99",
          bank_transaction: baseTx.url,
          dated_on: baseTx.dated_on,
          gross_value: baseTx.amount,
          paid_invoice: invoiceUrl,
        },
      }),
    });

    const result = await reconcileBankTransaction(client, {
      bank_transaction_id: "42",
      paid_invoice: "INV-001",
    });

    expect(result).toContain("Paid invoice: " + invoiceUrl);
    const post = calls.find((c) => c.method === "post");
    expect(post?.body).toMatchObject({
      bank_transaction_explanation: { paid_invoice: invoiceUrl },
    });
  });

  it("rejects when no link parameter is provided", async () => {
    const { client } = makeClient({});
    await expect(
      reconcileBankTransaction(client, { bank_transaction_id: "42" })
    ).rejects.toThrow(/Provide one of `category`.*`paid_invoice`.*`paid_bill`/);
  });

  it("rejects when multiple link parameters are provided", async () => {
    const { client } = makeClient({});
    await expect(
      reconcileBankTransaction(client, {
        bank_transaction_id: "42",
        category: "Travel",
        paid_invoice: "INV-001",
      })
    ).rejects.toThrow(/only one of/);
  });

  it("resolves a bill reference and links it as paid_bill", async () => {
    const billUrl = "https://api.freeagent.com/v2/bills/5";
    const { client, calls } = makeClient({
      get: (path, params) => {
        if (path === "/bank_transactions/42") return { bank_transaction: baseTx };
        if (path === "/bills") {
          expect(params).toMatchObject({ view: "open" });
          return {
            bills: [
              { url: billUrl, reference: "SUP-99", total_value: "18.50" },
              { url: "https://api.freeagent.com/v2/bills/6", reference: "SUP-100", total_value: "22.00" },
            ],
          };
        }
      },
      post: () => ({
        bank_transaction_explanation: {
          url: "https://api.freeagent.com/v2/bank_transaction_explanations/200",
          bank_transaction: baseTx.url,
          dated_on: baseTx.dated_on,
          gross_value: baseTx.amount,
          paid_bill: billUrl,
        },
      }),
    });

    const result = await reconcileBankTransaction(client, {
      bank_transaction_id: "42",
      paid_bill: "SUP-99",
    });

    expect(result).toContain("Paid bill: " + billUrl);
    const post = calls.find((c) => c.method === "post");
    expect(post?.body).toMatchObject({
      bank_transaction_explanation: { paid_bill: billUrl },
    });
  });
});

describe("sales_tax_status passthrough", () => {
  it("includes sales_tax_status in the explanation payload when provided", async () => {
    const { client, calls } = makeClient({
      get: (path) => {
        if (path === "/bank_transactions/42") return { bank_transaction: baseTx };
        if (path === "/categories") {
          return {
            income_categories: [
              { url: "https://api.freeagent.com/v2/categories/001", description: "Sales", nominal_code: "001" },
            ],
          };
        }
      },
      post: () => ({
        bank_transaction_explanation: {
          url: "https://api.freeagent.com/v2/bank_transaction_explanations/100",
          bank_transaction: baseTx.url,
          dated_on: baseTx.dated_on,
          gross_value: baseTx.amount,
          category: "https://api.freeagent.com/v2/categories/001",
        },
      }),
    });

    await reconcileBankTransaction(client, {
      bank_transaction_id: "42",
      category: "Sales",
      description: "PATREON INCOME",
      sales_tax_status: "OUT_OF_SCOPE",
    } as Parameters<typeof reconcileBankTransaction>[1]);

    const post = calls.find((c) => c.method === "post");
    expect(post).toBeDefined();
    const body = post!.body as { bank_transaction_explanation: Record<string, unknown> };
    expect(body.bank_transaction_explanation.sales_tax_status).toBe("OUT_OF_SCOPE");
  });

  it("omits sales_tax_status when not provided", async () => {
    const { client, calls } = makeClient({
      get: (path) => {
        if (path === "/bank_transactions/42") return { bank_transaction: baseTx };
        if (path === "/categories") {
          return {
            admin_expenses_categories: [
              { url: "https://api.freeagent.com/v2/categories/285", description: "Travel", nominal_code: "285" },
            ],
          };
        }
      },
      post: () => ({
        bank_transaction_explanation: {
          url: "https://api.freeagent.com/v2/bank_transaction_explanations/101",
          bank_transaction: baseTx.url,
          dated_on: baseTx.dated_on,
          gross_value: baseTx.amount,
          category: "https://api.freeagent.com/v2/categories/285",
        },
      }),
    });

    await reconcileBankTransaction(client, {
      bank_transaction_id: "42",
      category: "Travel",
    } as Parameters<typeof reconcileBankTransaction>[1]);

    const post = calls.find((c) => c.method === "post");
    const body = post!.body as { bank_transaction_explanation: Record<string, unknown> };
    expect("sales_tax_status" in body.bank_transaction_explanation).toBe(false);
  });
});

describe("amount sourcing", () => {
  it("uses unexplained_amount for a partially explained transaction", async () => {
    const partialTx = { ...baseTx, amount: "-100.00", unexplained_amount: "-40.00" };
    const { client, calls } = makeClient({
      get: (path) => {
        if (path === "/bank_transactions/42") return { bank_transaction: partialTx };
        if (path === "/categories") {
          return {
            admin_expenses_categories: [
              { url: "https://api.freeagent.com/v2/categories/285", description: "Travel", nominal_code: "285" },
            ],
          };
        }
      },
      post: () => ({
        bank_transaction_explanation: {
          url: "https://api.freeagent.com/v2/bank_transaction_explanations/102",
          bank_transaction: baseTx.url,
          dated_on: baseTx.dated_on,
          gross_value: "-40.00",
          category: "https://api.freeagent.com/v2/categories/285",
        },
      }),
    });

    await reconcileBankTransaction(client, {
      bank_transaction_id: "42",
      category: "Travel",
    } as Parameters<typeof reconcileBankTransaction>[1]);

    const post = calls.find((c) => c.method === "post");
    const body = post!.body as { bank_transaction_explanation: Record<string, unknown> };
    expect(body.bank_transaction_explanation.gross_value).toBe("-40.00");
  });

  it("refuses to create a zero-value explanation when the transaction is fully explained", async () => {
    const explainedTx = { ...baseTx, amount: "-18.50", unexplained_amount: "0.0" };
    const { client } = makeClient({
      get: (path) => {
        if (path === "/bank_transactions/42") return { bank_transaction: explainedTx };
      },
    });

    await expect(
      reconcileBankTransaction(client, {
        bank_transaction_id: "42",
        category: "Travel",
      } as Parameters<typeof reconcileBankTransaction>[1])
    ).rejects.toThrow(/no unexplained amount/);
  });
});
