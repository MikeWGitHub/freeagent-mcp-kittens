/**
 * v1.2.3: fixes from the independent review of v1.2.2 (26 Sep 2026).
 * Each test pins the payload FreeAgent actually receives, because the bug
 * class here is "the tool accepts it, FreeAgent silently does something else".
 */
import { describe, it, expect, vi } from "vitest";
import { FreeAgentApiClient } from "../services/api-client.js";
import { resolveCategory, resolveJournalCategory } from "../services/resolvers.js";
import {
  createBankTransactionExplanation,
  updateBankTransactionExplanation,
  getBankTransactionExplanation,
} from "./bank-transactions.js";
import { createBill } from "./bills.js";
import { createJournalSet, listJournalSets } from "./journal-sets.js";
import { formatAutoSalesTaxRate } from "./categories.js";
import {
  CreateInvoiceInputSchema,
  CreateEstimateInputSchema,
  UpdateInvoiceInputSchema,
  CreateBillInputSchema,
  CreateJournalSetInputSchema,
} from "../schemas/index.js";

const real = new FreeAgentApiClient("test-token");
const API = "https://api.freeagent.com/v2";

type Handler = (path: string, params?: unknown) => unknown;

function mockClient(getHandler: Handler = () => ({})) {
  const get = vi.fn(async (path: string, params?: unknown) => ({
    data: getHandler(path, params),
    headers: {},
  }));
  const post = vi.fn(async (_path: string, body?: unknown) => ({
    data: {
      bank_transaction_explanation: { url: `${API}/bank_transaction_explanations/1`, dated_on: "2025-04-17", gross_value: "-1.00" },
      bill: { url: `${API}/bills/1`, dated_on: "2025-04-17", total_value: "120.0", contact: `${API}/contacts/1` },
      journal_set: { url: `${API}/journal_sets/1`, dated_on: "2025-04-17", description: "x", journal_entries: [] },
      _echo: body,
    },
    headers: {},
  }));
  const put = vi.fn(async (_path: string, _body?: unknown) => ({
    data: {
      bank_transaction_explanation: { url: `${API}/bank_transaction_explanations/1`, dated_on: "2025-04-17", gross_value: "-1.00" },
    },
    headers: {},
  }));
  const client = {
    get,
    post,
    put,
    resourceUrl: real.resourceUrl.bind(real),
    parsePaginationHeaders: real.parsePaginationHeaders.bind(real),
  } as unknown as FreeAgentApiClient;
  return { client, get, post, put };
}

describe("depreciation_profile is nested under capital_asset", () => {
  const profile = { method: "straight_line" as const, asset_life_years: 4, frequency: "annually" as const };

  it("on create", async () => {
    const { client, post } = mockClient();
    await createBankTransactionExplanation(client, {
      bank_transaction: "1",
      dated_on: "2025-04-17",
      gross_value: "-21500.98",
      category: `${API}/categories/602-3`,
      depreciation_profile: profile,
    } as never);
    const body = (post.mock.calls[0][1] as { bank_transaction_explanation: Record<string, unknown> })
      .bank_transaction_explanation;
    expect(body.capital_asset).toEqual({ depreciation_profile: profile });
    expect(body).not.toHaveProperty("depreciation_profile");
  });

  it("on update", async () => {
    const { client, put } = mockClient();
    await updateBankTransactionExplanation(client, {
      bank_transaction_explanation_id: "582432568",
      depreciation_profile: profile,
    } as never);
    const body = (put.mock.calls[0][1] as { bank_transaction_explanation: Record<string, unknown> })
      .bank_transaction_explanation;
    expect(body.capital_asset).toEqual({ depreciation_profile: profile });
    expect(body).not.toHaveProperty("depreciation_profile");
  });
});

describe("sub-coded categories and capital asset journals", () => {
  const motor = {
    url: `${API}/categories/602-3`,
    description: "Motor Vehicle Purchase",
    nominal_code: "602-3",
    capital_asset_type: `${API}/capital_asset_types/1928015`,
  };
  const parent = { url: `${API}/categories/602`, description: "Capital Asset Purchase", nominal_code: "602" };

  it("resolveCategory('602-3') asks FreeAgent for /categories/602-3", async () => {
    const { client, get } = mockClient((path) =>
      path === "/categories/602-3" ? { general_categories: motor } : {}
    );
    await expect(resolveCategory(client, "602-3")).resolves.toBe(motor.url);
    expect(get).toHaveBeenCalledWith("/categories/602-3");
  });

  it("name search falls back to sub_accounts=true", async () => {
    const { client, get } = mockClient((path, params) =>
      path === "/categories" && (params as { sub_accounts?: boolean } | undefined)?.sub_accounts
        ? { general_categories: [motor] }
        : { general_categories: [parent] }
    );
    await expect(resolveCategory(client, "Motor Vehicle Purchase")).resolves.toBe(motor.url);
    expect(get).toHaveBeenLastCalledWith("/categories", { sub_accounts: true });
  });

  it("a sub-coded capital category becomes parent category + capital_asset_type", async () => {
    const { client } = mockClient((path) => (path === "/categories/602-3" ? { general_categories: motor } : {}));
    await expect(resolveJournalCategory(client, "602-3")).resolves.toEqual({
      category: `${API}/categories/602`,
      capital_asset_type: motor.capital_asset_type,
    });
  });

  it("a bare 601-607 category without a type is refused before FreeAgent sees it", async () => {
    const { client, post } = mockClient((path) => (path === "/categories/602" ? { general_categories: parent } : {}));
    await expect(
      createJournalSet(client, {
        dated_on: "2025-04-17",
        description: "Capitalise car",
        confirm: true,
        journal_entries: [
          { category: "602", debit_value: 100 },
          { category: `${API}/categories/363`, debit_value: -100 },
        ],
      } as never)
    ).rejects.toThrow(/capital asset type/i);
    expect(post).not.toHaveBeenCalled();
  });

  it("an explicit capital_asset_type name is resolved and sent", async () => {
    const { client, post } = mockClient((path) => {
      if (path === "/categories/602") return { general_categories: parent };
      if (path === "/capital_asset_types")
        return { capital_asset_types: [{ url: motor.capital_asset_type, name: "Motor Vehicles" }] };
      return {};
    });
    await createJournalSet(client, {
      dated_on: "2025-04-17",
      description: "Capitalise car",
      confirm: true,
      journal_entries: [
        { category: "602", debit_value: 100, capital_asset_type: "Motor Vehicles" },
        { category: `${API}/categories/363`, debit_value: -100 },
      ],
    } as never);
    const entries = (post.mock.calls[0][1] as { journal_set: { journal_entries: Record<string, unknown>[] } })
      .journal_set.journal_entries;
    expect(entries[0]).toMatchObject({ category: parent.url, capital_asset_type: motor.capital_asset_type });
    expect(entries[1]).not.toHaveProperty("capital_asset_type");
  });

  it("journal entry schema accepts capital_asset_type and stock fields", () => {
    const r = CreateJournalSetInputSchema.safeParse({
      dated_on: "2025-04-17",
      description: "x",
      confirm: true,
      journal_entries: [
        { category: "602-3", debit_value: 1, capital_asset_type: "Motor Vehicles" },
        { category: "609", debit_value: -1, stock_item: "5", stock_altering_quantity: 1 },
      ],
    });
    expect(r.success).toBe(true);
  });
});

describe("create_bill posts total_value, never price", () => {
  const base = { contact: `${API}/contacts/1`, dated_on: "2026-09-26" };

  it("sends total_value for a gross line", async () => {
    const { client, post } = mockClient();
    await createBill(client, {
      ...base,
      bill_items: [{ category: "285", description: "Lunch", total_value: "120.00", sales_tax_rate: "20.0" }],
    } as never);
    const item = (post.mock.calls[0][1] as { bill: { bill_items: Record<string, unknown>[] } }).bill.bill_items[0];
    expect(item).toMatchObject({ category: "285", total_value: "120.00", sales_tax_rate: "20.0" });
    expect(item).not.toHaveProperty("price");
  });

  it("sends total_value_ex_tax for a net line", async () => {
    const { client, post } = mockClient();
    await createBill(client, { ...base, bill_items: [{ category: "285", total_value_ex_tax: "100.00" }] } as never);
    const item = (post.mock.calls[0][1] as { bill: { bill_items: Record<string, unknown>[] } }).bill.bill_items[0];
    expect(item).toMatchObject({ total_value_ex_tax: "100.00" });
  });

  it("refuses a line with neither or both totals", async () => {
    const { client, post } = mockClient();
    await expect(createBill(client, { ...base, bill_items: [{ category: "285" }] } as never)).rejects.toThrow(
      /exactly one of total_value/
    );
    await expect(
      createBill(client, { ...base, bill_items: [{ category: "285", total_value: "1", total_value_ex_tax: "1" }] } as never)
    ).rejects.toThrow(/exactly one of total_value/);
    expect(post).not.toHaveBeenCalled();
  });

  it("schema no longer offers price on bill lines", () => {
    const r = CreateBillInputSchema.safeParse({ ...base, bill_items: [{ category: "285", price: "100", quantity: "1" }] });
    expect(r.success).toBe(false);
  });
});

describe("percentage guards and invoice VAT fields", () => {
  const invoice = {
    contact: "1",
    dated_on: "2026-09-26",
    invoice_items: [{ item_type: "Hours", description: "Work", price: "240.00", quantity: "1" }],
  };

  it("invoice lines accept a VAT rate and status", () => {
    const r = CreateInvoiceInputSchema.safeParse({
      ...invoice,
      invoice_items: [{ ...invoice.invoice_items[0], sales_tax_rate: "20.0", sales_tax_status: "TAXABLE" }],
    });
    expect(r.success).toBe(true);
  });

  it("invoice lines reject a decimal-fraction VAT rate", () => {
    const r = CreateInvoiceInputSchema.safeParse({
      ...invoice,
      invoice_items: [{ ...invoice.invoice_items[0], sales_tax_rate: "0.20" }],
    });
    expect(r.success).toBe(false);
  });

  it.each([
    ["create_invoice", (d: string) => CreateInvoiceInputSchema.safeParse({ ...invoice, discount_percent: d })],
    ["update_invoice", (d: string) => UpdateInvoiceInputSchema.safeParse({ invoice_id: "1", discount_percent: d })],
    [
      "create_estimate",
      (d: string) =>
        CreateEstimateInputSchema.shape.discount_percent.safeParse(d),
    ],
  ])("%s: discount_percent '20' is accepted and '0.20' rejected", (_name, parse) => {
    expect(parse("20").success).toBe(true);
    expect(parse("0.20").success).toBe(false);
  });
});

describe("pagination", () => {
  it("falls back to X-Total-Count when no Link header arrives", () => {
    expect(real.parsePaginationHeaders({ "x-total-count": "60" }, 1, 25)).toMatchObject({ hasMore: true, nextPage: 2 });
    expect(real.parsePaginationHeaders({ "x-total-count": "60" }, 3, 25)).toMatchObject({ hasMore: false });
  });

  it("parses a relative Link header", () => {
    expect(
      real.parsePaginationHeaders({ link: '</v2/bank_transactions?page=3&per_page=25>; rel="next"' })
    ).toMatchObject({ hasMore: true, nextPage: 3 });
  });

  it("list_journal_sets follows every page", async () => {
    let call = 0;
    const get = vi.fn(async () => {
      call += 1;
      return {
        data: {
          journal_sets: [{ url: `${API}/journal_sets/${call}`, dated_on: "2025-07-01", description: `set ${call}`, journal_entries: [] }],
        },
        headers: call === 1 ? { link: `<${API}/journal_sets?page=2>; rel="next"` } : {},
      };
    });
    const client = {
      get,
      parsePaginationHeaders: real.parsePaginationHeaders.bind(real),
      resourceUrl: real.resourceUrl.bind(real),
    } as unknown as FreeAgentApiClient;
    const out = await listJournalSets(client, { response_format: "markdown" } as never);
    expect(get).toHaveBeenCalledTimes(2);
    expect(out).toContain("Journal Sets (2)");
  });
});

describe("display and transport", () => {
  it("renders VAT rates as percentages", () => {
    expect(formatAutoSalesTaxRate(20)).toBe("20.0%");
    expect(formatAutoSalesTaxRate(0.2)).toBe("20.0%");
    expect(formatAutoSalesTaxRate("Standard rate")).toBe("Standard rate");
  });

  it("shows a 20.0 explanation rate as 20%, not 2000%", async () => {
    const { client } = mockClient(() => ({
      bank_transaction_explanation: {
        url: `${API}/bank_transaction_explanations/1`,
        dated_on: "2025-09-18",
        gross_value: "-25.33",
        sales_tax_rate: "20.0",
        sales_tax_value: "-4.22",
      },
    }));
    const out = await getBankTransactionExplanation(client, {
      bank_transaction_explanation_id: "1",
      response_format: "markdown",
    } as never);
    expect(out).toContain("20%");
    expect(out).not.toContain("2000%");
  });

  it("never follows redirects (bearer must not leave api.freeagent.com)", () => {
    const instance = (real as unknown as { axiosInstance: { defaults: { maxRedirects?: number } } }).axiosInstance;
    expect(instance.defaults.maxRedirects).toBe(0);
  });
});
