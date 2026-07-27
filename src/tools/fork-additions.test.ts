/**
 * Tests for the Jul-2026 coverage expansion: credit notes, reports, statutory
 * returns, ledger, capital assets, stock/attachments/notes, and the update
 * tools. One file because the modules share the same thin read/format shape.
 */

import { describe, it, expect, vi } from "vitest";
import type { FreeAgentApiClient } from "../services/api-client.js";
import { ResponseFormat } from "../constants.js";
import { listCreditNotes, getCreditNote } from "./credit-notes.js";
import { getProfitAndLoss, getTrialBalance, getBalanceSheet, getCashflow } from "./reports.js";
import { getCorporationTaxReturn, getVatReturn, listVatReturns } from "./tax-returns.js";
import { listLedgerTransactions } from "./ledger.js";
import { getCapitalAsset } from "./capital-assets.js";
import { listNotes, createNote, deleteNote } from "./stock-attachments-notes.js";
import { updateInvoice } from "./invoices.js";
import { updateBill } from "./bills.js";
import { updateProject } from "./projects.js";

interface Call {
  method: "get" | "post" | "put" | "delete";
  path: string;
  body?: unknown;
  params?: unknown;
}

function makeClient(handlers: {
  get?: (path: string, params?: unknown) => unknown;
  post?: (path: string, body?: unknown) => unknown;
  put?: (path: string, body?: unknown) => unknown;
}): { client: FreeAgentApiClient; calls: Call[] } {
  const calls: Call[] = [];
  const client = {
    get: vi.fn(async (path: string, params?: unknown) => {
      calls.push({ method: "get", path, params });
      return { data: handlers.get?.(path, params), headers: {} };
    }),
    post: vi.fn(async (path: string, body?: unknown) => {
      calls.push({ method: "post", path, body });
      return { data: handlers.post?.(path, body), headers: {} };
    }),
    put: vi.fn(async (path: string, body?: unknown) => {
      calls.push({ method: "put", path, body });
      return { data: handlers.put?.(path, body), headers: {} };
    }),
    delete: vi.fn(async (path: string) => {
      calls.push({ method: "delete", path });
      return { data: {}, headers: {} };
    }),
    parsePaginationHeaders: () => ({ hasMore: false }),
  } as unknown as FreeAgentApiClient;
  return { client, calls };
}

const MD = ResponseFormat.MARKDOWN;

describe("credit notes", () => {
  it("lists credit notes with status and PO reference", async () => {
    const { client, calls } = makeClient({
      get: () => ({
        credit_notes: [
          {
            url: "https://api.freeagent.com/v2/credit_notes/88205923",
            contact: "https://api.freeagent.com/v2/contacts/10948583",
            dated_on: "2026-03-23",
            reference: "147",
            status: "Refunded",
            total_value: "1060.2",
            currency: "GBP",
            po_reference: "92451 OP",
          },
        ],
      }),
    });

    const result = await listCreditNotes(client, {
      page: 1, per_page: 25, nested_credit_note_items: false, response_format: MD,
    });

    expect(result).toContain("Credit Note 147");
    expect(result).toContain("92451 OP");
    expect(result).toContain("Refunded");
    expect(calls[0].path).toBe("/credit_notes");
  });

  it("normalizes a contact ID filter into a URL", async () => {
    const { client, calls } = makeClient({ get: () => ({ credit_notes: [] }) });
    await listCreditNotes(client, {
      page: 1, per_page: 25, contact: "10948583", nested_credit_note_items: false, response_format: MD,
    });
    expect((calls[0].params as Record<string, string>).contact).toBe(
      "https://api.freeagent.com/v2/contacts/10948583"
    );
  });

  it("gets a single credit note with line items", async () => {
    const { client, calls } = makeClient({
      get: () => ({
        credit_note: {
          url: "https://api.freeagent.com/v2/credit_notes/88205923",
          contact: "https://api.freeagent.com/v2/contacts/10948583",
          dated_on: "2026-03-23",
          status: "Refunded",
          total_value: "-1060.2",
          currency: "GBP",
          credit_note_items: [
            { description: "Group licence credit", item_type: "Products", quantity: "1.0", price: "-883.5" },
          ],
        },
      }),
    });

    const result = await getCreditNote(client, { credit_note_id: "88205923", response_format: MD });
    expect(calls[0].path).toBe("/credit_notes/88205923");
    expect(result).toContain("Group licence credit");
  });
});

describe("reports", () => {
  it("renders the P&L summary including less-lines", async () => {
    const { client, calls } = makeClient({
      get: () => ({
        profit_and_loss_summary: {
          from: "2025-07-02", to: "2026-07-01",
          income: "50000", expenses: "20000", operating_profit: "30000",
          less: [{ title: "Dividends", total: "10000" }],
          retained_profit: "20000",
          retained_profit_brought_forward: "5000",
          retained_profit_carried_forward: "25000",
        },
      }),
    });

    const result = await getProfitAndLoss(client, { response_format: MD });
    expect(calls[0].path).toBe("/accounting/profit_and_loss/summary");
    expect(result).toContain("**Dividends**: 10000");
    expect(result).toContain("carried forward**: 25000");
  });

  it("flags a trial balance that does not sum to zero", async () => {
    const { client } = makeClient({
      get: () => ({
        trial_balance_summary: [
          { display_nominal_code: "001", name: "Sales", total: "-100.00" },
          { display_nominal_code: "285", name: "Accommodation", total: "60.00" },
        ],
      }),
    });

    const result = await getTrialBalance(client, { opening_balances: false, response_format: MD });
    expect(result).toContain("does not balance");
  });

  it("confirms a balancing trial balance and hits the opening balances path when asked", async () => {
    const { client, calls } = makeClient({
      get: () => ({
        trial_balance_summary: [
          { display_nominal_code: "001", name: "Sales", total: "-100.00" },
          { display_nominal_code: "750-1", name: "Bank", total: "100.00" },
        ],
      }),
    });

    const result = await getTrialBalance(client, { opening_balances: true, response_format: MD });
    expect(calls[0].path).toBe("/accounting/trial_balance/summary/opening_balances");
    expect(result).toContain("(balances)");
  });

  it("renders a balance sheet of unknown shape without crashing", async () => {
    const { client } = makeClient({
      get: () => ({
        balance_sheet: {
          as_at_date: "2026-07-01",
          currency: "GBP",
          capital_assets: { net_book_value: "1200.00" },
          current_assets: { accounts: [{ name: "ESS Current", total: "9000.00" }] },
          total_assets: 10200,
        },
      }),
    });

    const result = await getBalanceSheet(client, { opening_balances: false, response_format: MD });
    expect(result).toContain("net book value**: 1200.00");
    expect(result).toContain("ESS Current: 9000.00");
    expect(result).toContain("Total assets**: 10200");
  });

  it("merges cashflow months into one table", async () => {
    const { client } = makeClient({
      get: () => ({
        cashflow: {
          from: "2026-01-01", to: "2026-02-28",
          incoming: { total: "300", months: [{ month: 1, year: 2026, total: "100" }, { month: 2, year: 2026, total: "200" }] },
          outgoing: { total: "50", months: [{ month: 2, year: 2026, total: "50" }] },
          balance: "250",
        },
      }),
    });

    const result = await getCashflow(client, { response_format: MD });
    expect(result).toContain("| 2026-01 | 100 | - |");
    expect(result).toContain("| 2026-02 | 200 | 50 |");
  });
});

describe("statutory returns", () => {
  it("fetches a CT return by period end date and shows the amount due", async () => {
    const { client, calls } = makeClient({
      get: () => ({
        corporation_tax_return: {
          url: "https://api.freeagent.com/v2/corporation_tax_returns/2026-07-01",
          period_starts_on: "2025-07-02",
          period_ends_on: "2026-07-01",
          filing_status: "unfiled",
          amount_due: "0.00",
          payment_status: "unpaid",
        },
      }),
    });

    const result = await getCorporationTaxReturn(client, {
      period_ends_on: "2026-07-01", response_format: MD,
    });
    expect(calls[0].path).toBe("/corporation_tax_returns/2026-07-01");
    expect(result).toContain("**Amount due**: 0.00");
  });

  it("marks negative VAT payments as refunds", async () => {
    const { client } = makeClient({
      get: () => ({
        vat_returns: [
          {
            url: "https://api.freeagent.com/v2/vat_returns/2026-09-30",
            period_starts_on: "2026-07-01",
            period_ends_on: "2026-09-30",
            filing_status: "unfiled",
            payments: [{ label: "Payment", due_on: "2026-11-07", amount_due: "-176.70", status: "unpaid" }],
          },
        ],
      }),
    });

    const result = await listVatReturns(client, { response_format: MD });
    expect(result).toContain("refund");
  });

  it("renders the VAT box breakdown", async () => {
    const { client } = makeClient({
      get: () => ({
        vat_return: {
          url: "https://api.freeagent.com/v2/vat_returns/2026-03-31",
          period_ends_on: "2026-03-31",
          filing_status: "filed",
          breakdown: {
            title: "VAT breakdown",
            rows: [{ box_number: "1", title: "VAT due on sales", value: "176.70", key: "vat_due" }],
          },
        },
      }),
    });

    const result = await getVatReturn(client, { period_ends_on: "2026-03-31", response_format: MD });
    expect(result).toContain("| 1 | VAT due on sales | 176.70 |");
  });
});

describe("general ledger", () => {
  it("lists postings with nominal codes as a table", async () => {
    const { client, calls } = makeClient({
      get: () => ({
        transactions: [
          {
            url: "https://api.freeagent.com/v2/accounting/transactions/9001",
            dated_on: "2026-03-16",
            description: "Invoice 142",
            category_name: "Sales",
            nominal_code: "001",
            debit_value: "-883.5",
          },
        ],
      }),
    });

    const result = await listLedgerTransactions(client, {
      page: 1, per_page: 25, nominal_code: "001", response_format: MD,
    });
    expect(calls[0].path).toBe("/accounting/transactions");
    expect((calls[0].params as Record<string, string>).nominal_code).toBe("001");
    expect(result).toContain("| 2026-03-16 | 001 | Sales | -883.5 | Invoice 142 | 9001 |");
  });
});

describe("capital assets", () => {
  it("renders the asset history table and depreciation profile", async () => {
    const { client, calls } = makeClient({
      get: () => ({
        capital_asset: {
          url: "https://api.freeagent.com/v2/capital_assets/321",
          description: "CVP camera kit",
          asset_type: "Computer Equipment",
          purchased_on: "2026-06-30",
          depreciation_profile: { method: "straight_line", asset_life_years: 3, frequency: "monthly" },
          capital_asset_history: [
            { type: "purchase", date: "2026-06-30", value: "1200.00", description: "CVP LTD" },
          ],
        },
      }),
    });

    const result = await getCapitalAsset(client, {
      capital_asset_id: "321", include_history: true, response_format: MD,
    });
    expect((calls[0].params as Record<string, string>).include_history).toBe("true");
    expect(result).toContain("straight_line, 3 years, monthly");
    expect(result).toContain("| 2026-06-30 | purchase | 1200.00 |");
  });
});

describe("notes", () => {
  it("rejects a listing with both contact and project", async () => {
    const { client } = makeClient({ get: () => ({ notes: [] }) });
    await expect(
      listNotes(client, { contact: "1", project: "2", response_format: MD })
    ).rejects.toThrow(/exactly one/);
  });

  it("rejects a create with neither parent", async () => {
    const { client } = makeClient({});
    await expect(createNote(client, { note: "hello" })).rejects.toThrow(/exactly one/);
  });

  it("creates a note against a normalized contact URL", async () => {
    const { client, calls } = makeClient({
      post: () => ({
        note: { url: "https://api.freeagent.com/v2/notes/77", note: "Write-off on 142 reversed 27 Jul 26" },
      }),
    });

    const result = await createNote(client, { contact: "10948583", note: "Write-off on 142 reversed 27 Jul 26" });
    expect(calls[0].path).toContain("/notes?contact=");
    expect(calls[0].path).toContain(encodeURIComponent("https://api.freeagent.com/v2/contacts/10948583"));
    expect(result).toContain("Note 77 created");
  });

  it("reads a note before deleting so the reply carries an audit trail", async () => {
    const { client, calls } = makeClient({
      get: () => ({
        note: { url: "https://api.freeagent.com/v2/notes/77", note: "old content", author: "Mike" },
      }),
    });

    const result = await deleteNote(client, { note_id: "77", confirm: true });
    expect(calls.map((c) => c.method)).toEqual(["get", "delete"]);
    expect(result).toContain("old content");
  });
});

describe("update tools", () => {
  it("updateInvoice sends only the provided fields and normalizes the contact", async () => {
    const { client, calls } = makeClient({
      put: () => ({
        invoice: {
          url: "https://api.freeagent.com/v2/invoices/86955526",
          contact: "https://api.freeagent.com/v2/contacts/10948583",
          reference: "EasyBuild PAYG Supply 142",
          dated_on: "2026-02-15",
          currency: "GBP",
          net_value: "883.5",
          sales_tax_value: "176.7",
          total_value: "1060.2",
          status: "Paid",
        },
      }),
    });

    await updateInvoice(client, {
      invoice_id: "86955526",
      contact: "10948583",
      po_reference: "PO-1",
      invoice_items: [{ id: "195668971", _destroy: 1 }],
    });

    expect(calls[0].path).toBe("/invoices/86955526");
    const body = calls[0].body as { invoice: Record<string, unknown> };
    expect(body.invoice.contact).toBe("https://api.freeagent.com/v2/contacts/10948583");
    expect(body.invoice.po_reference).toBe("PO-1");
    expect(body.invoice.invoice_items).toEqual([{ id: "195668971", _destroy: 1 }]);
    expect(body.invoice).not.toHaveProperty("dated_on");
    expect(body.invoice).not.toHaveProperty("invoice_id");
  });

  it("updateInvoice refuses an empty update", async () => {
    const { client } = makeClient({});
    await expect(updateInvoice(client, { invoice_id: "1" })).rejects.toThrow(/No fields to update/);
  });

  it("updateBill sends bill_items through unchanged", async () => {
    const { client, calls } = makeClient({
      put: () => ({
        bill: {
          url: "https://api.freeagent.com/v2/bills/10",
          contact: "https://api.freeagent.com/v2/contacts/1",
          dated_on: "2026-07-01",
          total_value: "120.00",
        },
      }),
    });

    await updateBill(client, {
      bill_id: "10",
      bill_items: [{ id: "5", total_value: "120.00" }],
    });
    const body = calls[0].body as { bill: Record<string, unknown> };
    expect(body.bill.bill_items).toEqual([{ id: "5", total_value: "120.00" }]);
  });

  it("updateProject strips undefined fields and the id", async () => {
    const { client, calls } = makeClient({
      put: () => ({
        project: {
          url: "https://api.freeagent.com/v2/projects/2693569",
          name: "EasyBuild",
          status: "Completed",
          budget: "0.0",
          budget_units: "Hours",
        },
      }),
    });

    await updateProject(client, { project_id: "2693569", status: "Completed" });
    expect(calls[0].path).toBe("/projects/2693569");
    const body = calls[0].body as { project: Record<string, unknown> };
    expect(body.project).toEqual({ status: "Completed" });
  });
});
