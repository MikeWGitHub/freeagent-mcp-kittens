/**
 * Shared tool registration for FreeAgent MCP Server
 *
 * Defines all tool configurations and registers them on an McpServer instance.
 * Used by both api/index.ts (Vercel/HTTP) and src/index.ts (stdio).
 */

import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { ElicitRequestFormParams, ElicitResult } from "@modelcontextprotocol/sdk/types.js";
import { FreeAgentApiClient, formatErrorForLLM } from "../services/api-client.js";
import { listContacts, getContact, createContact } from "./contacts.js";
import { listInvoices, getInvoice, createInvoice, updateInvoice } from "./invoices.js";
import { listCreditNotes, getCreditNote } from "./credit-notes.js";
import { listCapitalAssets, getCapitalAsset, listCapitalAssetTypes } from "./capital-assets.js";
import { getProfitAndLoss, getBalanceSheet, getTrialBalance, getCashflow } from "./reports.js";
import {
  listFinalAccountsReports, getFinalAccountsReport,
  listCorporationTaxReturns, getCorporationTaxReturn,
  listVatReturns, getVatReturn, listSalesTaxPeriods,
} from "./tax-returns.js";
import { listLedgerTransactions, getLedgerTransaction } from "./ledger.js";
import {
  listStockItems, getStockItem,
  getAttachment, deleteAttachment,
  listNotes, createNote, updateNote, deleteNote,
} from "./stock-attachments-notes.js";
import { invoiceFromTimeslips } from "./invoice-from-timeslips.js";
import { transitionInvoice } from "./transition-invoice.js";
import { listEstimates, getEstimate, createEstimate, transitionEstimate } from "./estimates.js";
import { listRecurringInvoices, getRecurringInvoice } from "./recurring-invoices.js";
import { listPriceListItems, getPriceListItem, createPriceListItem, updatePriceListItem } from "./price-list-items.js";
import { listExpenses, getExpense, createExpense, updateExpense } from "./expenses.js";
import { logExpense } from "./log-expense.js";
import { listBills, getBill, createBill, updateBill } from "./bills.js";
import { listTimeslips, getTimeslip, createTimeslip, updateTimeslip } from "./timeslips.js";
import { listBankAccounts, getBankAccount, listBankTransactions, getBankTransaction } from "./bank-accounts.js";
import { listBankTransactionExplanations, getBankTransactionExplanation, createBankTransactionExplanation, updateBankTransactionExplanation } from "./bank-transactions.js";
import { reconcileBankTransaction } from "./reconcile.js";
import { listJournalSets, getJournalSet, createJournalSet, updateJournalSet, deleteJournalSet } from "./journal-sets.js";
import { uploadBankStatement, deleteBankTransactionExplanation } from "./statement-upload.js";
import { listProjects, getProject, createProject, updateProject } from "./projects.js";
import { listTasks, getTask, createTask, updateTask } from "./tasks.js";
import { listCategories, getCategory } from "./categories.js";
import { getCompany, listUsers, getUser, listEmailAddresses } from "./company.js";
import {
  ListContactsInputSchema, GetContactInputSchema, CreateContactInputSchema,
  ListInvoicesInputSchema, GetInvoiceInputSchema, CreateInvoiceInputSchema, InvoiceFromTimeslipsInputSchema, TransitionInvoiceInputSchema,
  ListEstimatesInputSchema, GetEstimateInputSchema, CreateEstimateInputSchema, TransitionEstimateInputSchema,
  ListRecurringInvoicesInputSchema, GetRecurringInvoiceInputSchema,
  ListPriceListItemsInputSchema, GetPriceListItemInputSchema, CreatePriceListItemInputSchema,
  ListExpensesInputSchema, GetExpenseInputSchema, CreateExpenseInputSchema, UpdateExpenseInputSchema, LogExpenseInputSchema,
  ListBillsInputSchema, GetBillInputSchema, CreateBillInputSchema,
  ListTimeslipsInputSchema, GetTimeslipInputSchema, CreateTimeslipInputSchema, UpdateTimeslipInputSchema,
  ListBankAccountsInputSchema, GetBankAccountInputSchema, ListBankTransactionsInputSchema, GetBankTransactionInputSchema,
  ListBankTransactionExplanationsInputSchema, GetBankTransactionExplanationInputSchema,
  CreateBankTransactionExplanationInputSchema, UpdateBankTransactionExplanationInputSchema,
  ReconcileBankTransactionInputSchema,
  ListProjectsInputSchema, GetProjectInputSchema, CreateProjectInputSchema,
  ListTasksInputSchema, GetTaskInputSchema, CreateTaskInputSchema,
  ListCategoriesInputSchema, GetCategoryInputSchema,
  GetCompanyInputSchema, ListUsersInputSchema,
  SearchToolsInputSchema, CallToolInputSchema,
  ListJournalSetsInputSchema, GetJournalSetInputSchema, CreateJournalSetInputSchema,
  UpdateJournalSetInputSchema, DeleteJournalSetInputSchema,
  UploadBankStatementInputSchema, DeleteBankTransactionExplanationInputSchema,
  ListCreditNotesInputSchema, GetCreditNoteInputSchema,
  ListCapitalAssetsInputSchema, GetCapitalAssetInputSchema, ListCapitalAssetTypesInputSchema,
  GetProfitAndLossInputSchema, GetBalanceSheetInputSchema, GetTrialBalanceInputSchema, GetCashflowInputSchema,
  ListFinalAccountsReportsInputSchema, GetFinalAccountsReportInputSchema,
  ListCorporationTaxReturnsInputSchema, GetCorporationTaxReturnInputSchema,
  ListVatReturnsInputSchema, GetVatReturnInputSchema, ListSalesTaxPeriodsInputSchema,
  ListLedgerTransactionsInputSchema, GetLedgerTransactionInputSchema,
  ListStockItemsInputSchema, GetStockItemInputSchema,
  ListEmailAddressesInputSchema, GetUserInputSchema,
  GetAttachmentInputSchema, DeleteAttachmentInputSchema,
  ListNotesInputSchema, CreateNoteInputSchema, UpdateNoteInputSchema, DeleteNoteInputSchema,
  UpdateInvoiceInputSchema, UpdateBillInputSchema, UpdateProjectInputSchema,
  UpdateTaskInputSchema, UpdatePriceListItemInputSchema,
} from "../schemas/index.js";
import { searchTools, callTool } from "./tool-search.js";
import type { McpStaticScope } from "../services/static-bearer.js";

export interface ToolContext {
  clientSupportsElicitation: boolean;
  elicit: (params: ElicitRequestFormParams) => Promise<ElicitResult>;
}

export interface ToolDefinition {
  name: string;
  title: string;
  description: string;
  inputSchema: any;
  annotations: {
    readOnlyHint: boolean;
    destructiveHint: boolean;
    idempotentHint: boolean;
    openWorldHint: boolean;
  };
  handler: (apiClient: FreeAgentApiClient, params: any, ctx: ToolContext) => Promise<string>;
}

/**
 * All tool definitions for the FreeAgent MCP server.
 * Single source of truth used by both Vercel and stdio entry points.
 */
export const toolDefinitions: ToolDefinition[] = [
  // Contact Management
  {
    name: "freeagent_list_contacts",
    title: "List FreeAgent Contacts",
    description: "List all contacts in your FreeAgent account with pagination support.",
    inputSchema: ListContactsInputSchema.shape,
    annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: true },
    handler: listContacts,
  },
  {
    name: "freeagent_get_contact",
    title: "Get FreeAgent Contact Details",
    description: "Retrieve detailed information about a specific contact by ID.",
    inputSchema: GetContactInputSchema.shape,
    annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: true },
    handler: getContact,
  },
  {
    name: "freeagent_create_contact",
    title: "Create FreeAgent Contact",
    description: "Create a new contact in FreeAgent.",
    inputSchema: CreateContactInputSchema.shape,
    annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: true },
    handler: createContact,
  },

  // Invoice Management
  {
    name: "freeagent_list_invoices",
    title: "List FreeAgent Invoices",
    description: "List invoices in your FreeAgent account with filtering and pagination.",
    inputSchema: ListInvoicesInputSchema.shape,
    annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: true },
    handler: listInvoices,
  },
  {
    name: "freeagent_get_invoice",
    title: "Get FreeAgent Invoice Details",
    description: "Retrieve detailed information about a specific invoice.",
    inputSchema: GetInvoiceInputSchema.shape,
    annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: true },
    handler: getInvoice,
  },
  {
    name: "freeagent_create_invoice",
    title: "Create FreeAgent Invoice",
    description: "Create a new invoice in FreeAgent.",
    inputSchema: CreateInvoiceInputSchema.shape,
    annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: true },
    handler: createInvoice,
  },
  {
    name: "freeagent_update_invoice",
    title: "Update FreeAgent Invoice",
    description:
      "Update an existing invoice: dates, reference, PO reference, comments, discount, contact, send_reminder_emails (toggles automatic overdue reminder emails; does not send immediately), and line items (add without id; modify with id; remove with id + _destroy: 1). Cannot change status — use freeagent_transition_invoice for that. Changes the live account: confirm with the user before calling.",
    inputSchema: UpdateInvoiceInputSchema.shape,
    annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: true, openWorldHint: true },
    handler: updateInvoice,
  },
  {
    name: "freeagent_transition_invoice",
    title: "Transition FreeAgent Invoice",
    description:
      "Move a FreeAgent invoice between lifecycle states. 'mark_as_sent' moves Draft → Sent and also re-opens a cancelled invoice; 'mark_as_draft' rolls back to Draft; 'mark_as_scheduled' queues a future send; 'convert_to_credit_note' creates a credit note against the invoice. CAUTION: 'mark_as_cancelled' WRITES OFF a sent invoice as unpaid (it does not merely void it) — the invoice must be sent with a past due date, and the write-off has accounting consequences; reversing it via the API is undocumented (the web UI can remove a write-off). mark_as_cancelled therefore requires confirm: true — confirm with the user first.",
    inputSchema: TransitionInvoiceInputSchema.shape,
    // destructiveHint because mark_as_cancelled writes the invoice off.
    annotations: { readOnlyHint: false, destructiveHint: true, idempotentHint: true, openWorldHint: true },
    handler: transitionInvoice,
  },

  // Credit Notes (read-only fork addition)
  {
    name: "freeagent_list_credit_notes",
    title: "List FreeAgent Credit Notes",
    description: "List credit notes with filtering and pagination. Credit notes cancel or refund invoices; use this to trace cancellation chains instead of inferring them from invoice long_status strings.",
    inputSchema: ListCreditNotesInputSchema.shape,
    annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: true },
    handler: listCreditNotes,
  },
  {
    name: "freeagent_get_credit_note",
    title: "Get FreeAgent Credit Note",
    description: "Retrieve a specific credit note with line items, amounts, refund state, and PO reference.",
    inputSchema: GetCreditNoteInputSchema.shape,
    annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: true },
    handler: getCreditNote,
  },
  // Estimate Management
  {
    name: "freeagent_list_estimates",
    title: "List FreeAgent Estimates",
    description: "List estimates (quotes) with filtering and pagination.",
    inputSchema: ListEstimatesInputSchema.shape,
    annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: true },
    handler: listEstimates,
  },
  {
    name: "freeagent_get_estimate",
    title: "Get FreeAgent Estimate",
    description: "Retrieve detailed information about a specific estimate by ID.",
    inputSchema: GetEstimateInputSchema.shape,
    annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: true },
    handler: getEstimate,
  },
  {
    name: "freeagent_create_estimate",
    title: "Create FreeAgent Estimate",
    description: "Draft a new estimate (quote) for a contact.",
    inputSchema: CreateEstimateInputSchema.shape,
    annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: true },
    handler: createEstimate,
  },
  {
    name: "freeagent_transition_estimate",
    title: "Transition FreeAgent Estimate",
    description: "Move an estimate through its lifecycle: mark as sent, approved, rejected, cancelled, back to draft, or convert to an invoice.",
    inputSchema: TransitionEstimateInputSchema.shape,
    annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: true, openWorldHint: true },
    handler: transitionEstimate,
  },

  // Recurring Invoices (read-only)
  {
    name: "freeagent_list_recurring_invoices",
    title: "List FreeAgent Recurring Invoices",
    description: "List recurring invoice templates with filtering and pagination.",
    inputSchema: ListRecurringInvoicesInputSchema.shape,
    annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: true },
    handler: listRecurringInvoices,
  },
  {
    name: "freeagent_get_recurring_invoice",
    title: "Get FreeAgent Recurring Invoice",
    description: "Retrieve a specific recurring invoice template by ID.",
    inputSchema: GetRecurringInvoiceInputSchema.shape,
    annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: true },
    handler: getRecurringInvoice,
  },

  // Price List Items
  {
    name: "freeagent_list_price_list_items",
    title: "List FreeAgent Price List Items",
    description: "List price list (catalog) items available to use as invoice/estimate line items.",
    inputSchema: ListPriceListItemsInputSchema.shape,
    annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: true },
    handler: listPriceListItems,
  },
  {
    name: "freeagent_get_price_list_item",
    title: "Get FreeAgent Price List Item",
    description: "Retrieve a specific price list item by ID.",
    inputSchema: GetPriceListItemInputSchema.shape,
    annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: true },
    handler: getPriceListItem,
  },
  {
    name: "freeagent_create_price_list_item",
    title: "Create FreeAgent Price List Item",
    description: "Create a new catalog item that can be reused on invoices and estimates.",
    inputSchema: CreatePriceListItemInputSchema.shape,
    annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: true },
    handler: createPriceListItem,
  },
  {
    name: "freeagent_update_price_list_item",
    title: "Update FreeAgent Price List Item",
    description: "Update an existing catalog item. Only provided fields are changed.",
    inputSchema: UpdatePriceListItemInputSchema.shape,
    annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: true, openWorldHint: true },
    handler: updatePriceListItem,
  },

  // Accounting reports (read-only fork addition)
  {
    name: "freeagent_get_profit_and_loss",
    title: "Get FreeAgent Profit & Loss Summary",
    description: "Income, expenses, operating profit, and retained profit for a period. Defaults to the current accounting year to date; date ranges must fit within one accounting year (or pass accounting_period like '2025/26').",
    inputSchema: GetProfitAndLossInputSchema.shape,
    annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: true },
    handler: getProfitAndLoss,
  },
  {
    name: "freeagent_get_balance_sheet",
    title: "Get FreeAgent Balance Sheet",
    description: "Balance sheet as at a date (default today): capital assets, current assets, liabilities, and owners' equity. Set opening_balances: true for the company's fixed opening position.",
    inputSchema: GetBalanceSheetInputSchema.shape,
    annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: true },
    handler: getBalanceSheet,
  },
  {
    name: "freeagent_get_trial_balance",
    title: "Get FreeAgent Trial Balance",
    description: "Per-category totals with nominal codes for a period — one call replaces adding up individual documents, and it's the natural sanity check after journal or reconciliation work. Auto-paginates (up to 1,000 rows) and warns if the cap is hit. The markdown output verifies the rows sum to zero.",
    inputSchema: GetTrialBalanceInputSchema.shape,
    annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: true },
    handler: getTrialBalance,
  },
  {
    name: "freeagent_get_cashflow",
    title: "Get FreeAgent Cashflow",
    description: "Historic incoming/outgoing cash totals with a monthly breakdown. Future-dated requests return 0 (no projections).",
    inputSchema: GetCashflowInputSchema.shape,
    annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: true },
    handler: getCashflow,
  },

  // General ledger (read-only fork addition)
  {
    name: "freeagent_list_ledger_transactions",
    title: "List FreeAgent Ledger Transactions",
    description: "The double-entry postings behind invoices, credit notes, explanations, and journals. Filter by date range (max 12 months, single accounting year) and/or nominal code. Use this to trace what a document actually posted to the accounts.",
    inputSchema: ListLedgerTransactionsInputSchema.shape,
    annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: true },
    handler: listLedgerTransactions,
  },
  {
    name: "freeagent_get_ledger_transaction",
    title: "Get FreeAgent Ledger Transaction",
    description: "Retrieve a single general ledger posting including its source document URL.",
    inputSchema: GetLedgerTransactionInputSchema.shape,
    annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: true },
    handler: getLedgerTransaction,
  },

  // Capital assets (read-only fork addition)
  {
    name: "freeagent_list_capital_assets",
    title: "List FreeAgent Capital Assets",
    description: "List the capital asset register. Assets are created by explaining a bank transaction, bill, or expense against a capital asset sub-category (e.g. 602-1), optionally with a depreciation_profile; the API exposes the resulting register read-only.",
    inputSchema: ListCapitalAssetsInputSchema.shape,
    annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: true },
    handler: listCapitalAssets,
  },
  {
    name: "freeagent_get_capital_asset",
    title: "Get FreeAgent Capital Asset",
    description: "Retrieve a capital asset with its depreciation profile and full lifecycle history (purchase, depreciation postings, capital allowances, disposal).",
    inputSchema: GetCapitalAssetInputSchema.shape,
    annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: true },
    handler: getCapitalAsset,
  },
  {
    name: "freeagent_list_capital_asset_types",
    title: "List FreeAgent Capital Asset Types",
    description: "List system and custom capital asset types (Computer Equipment, Motor Vehicles, etc).",
    inputSchema: ListCapitalAssetTypesInputSchema.shape,
    annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: true },
    handler: listCapitalAssetTypes,
  },

  // Statutory returns (read-only fork addition — deliberately no filing writes)
  {
    name: "freeagent_list_final_accounts_reports",
    title: "List FreeAgent Final Accounts Reports",
    description: "List Final Accounts reports per accounting period with filing status and due dates. Read-only: filing state changes stay in the web UI.",
    inputSchema: ListFinalAccountsReportsInputSchema.shape,
    annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: true },
    handler: listFinalAccountsReports,
  },
  {
    name: "freeagent_get_final_accounts_report",
    title: "Get FreeAgent Final Accounts Report",
    description: "Retrieve a Final Accounts report by its period end date (YYYY-MM-DD).",
    inputSchema: GetFinalAccountsReportInputSchema.shape,
    annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: true },
    handler: getFinalAccountsReport,
  },
  {
    name: "freeagent_list_corporation_tax_returns",
    title: "List FreeAgent Corporation Tax Returns",
    description: "List Corporation Tax returns with amount due, payment status, and filing status per period. Read-only. For IoM companies (0% CT), read amount_due here, sanity check it, then zero it with freeagent_create_journal_set.",
    inputSchema: ListCorporationTaxReturnsInputSchema.shape,
    annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: true },
    handler: listCorporationTaxReturns,
  },
  {
    name: "freeagent_get_corporation_tax_return",
    title: "Get FreeAgent Corporation Tax Return",
    description: "Retrieve a Corporation Tax return by its period end date (YYYY-MM-DD), including the amount FreeAgent thinks is due.",
    inputSchema: GetCorporationTaxReturnInputSchema.shape,
    annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: true },
    handler: getCorporationTaxReturn,
  },
  {
    name: "freeagent_list_vat_returns",
    title: "List FreeAgent VAT Returns",
    description: "List VAT returns with filing status and payments (negative amount_due = refund). Read-only: this tool never files or marks returns.",
    inputSchema: ListVatReturnsInputSchema.shape,
    annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: true },
    handler: listVatReturns,
  },
  {
    name: "freeagent_get_vat_return",
    title: "Get FreeAgent VAT Return",
    description: "Retrieve a VAT return by its period end date (YYYY-MM-DD), including the box-by-box breakdown and payments.",
    inputSchema: GetVatReturnInputSchema.shape,
    annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: true },
    handler: getVatReturn,
  },
  {
    name: "freeagent_list_sales_tax_periods",
    title: "List FreeAgent Sales Tax Periods",
    description: "List the company's sales tax registration periods (name, rates, registration status, effective dates). Read-only.",
    inputSchema: ListSalesTaxPeriodsInputSchema.shape,
    annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: true },
    handler: listSalesTaxPeriods,
  },

  // Stock items (read-only in the FreeAgent API)
  {
    name: "freeagent_list_stock_items",
    title: "List FreeAgent Stock Items",
    description: "List stock items with quantities on hand. Read-only in the FreeAgent API.",
    inputSchema: ListStockItemsInputSchema.shape,
    annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: true },
    handler: listStockItems,
  },
  {
    name: "freeagent_get_stock_item",
    title: "Get FreeAgent Stock Item",
    description: "Retrieve a specific stock item by ID.",
    inputSchema: GetStockItemInputSchema.shape,
    annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: true },
    handler: getStockItem,
  },

  // Attachments
  {
    name: "freeagent_get_attachment",
    title: "Get FreeAgent Attachment",
    description: "Retrieve an attachment's metadata and time-limited download URLs. Attachment IDs surface on parent resources (explanations, expenses, invoices); there is no list endpoint.",
    inputSchema: GetAttachmentInputSchema.shape,
    annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: true },
    handler: getAttachment,
  },
  {
    name: "freeagent_delete_attachment",
    title: "Delete FreeAgent Attachment",
    description: "Permanently delete an attached file. Requires confirm: true. Confirm with the user before calling; the reply records what was removed.",
    inputSchema: DeleteAttachmentInputSchema.shape,
    annotations: { readOnlyHint: false, destructiveHint: true, idempotentHint: true, openWorldHint: true },
    handler: deleteAttachment,
  },

  // Notes (on contacts and projects)
  {
    name: "freeagent_list_notes",
    title: "List FreeAgent Notes",
    description: "List the notes on a contact or project (provide exactly one). Notes are the natural home for audit-trail commentary, e.g. why a write-off was reversed.",
    inputSchema: ListNotesInputSchema.shape,
    annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: true },
    handler: listNotes,
  },
  {
    name: "freeagent_create_note",
    title: "Create FreeAgent Note",
    description: "Add a note to a contact or project (provide exactly one).",
    inputSchema: CreateNoteInputSchema.shape,
    annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: true },
    handler: createNote,
  },
  {
    name: "freeagent_update_note",
    title: "Update FreeAgent Note",
    description: "Replace the content of an existing note.",
    inputSchema: UpdateNoteInputSchema.shape,
    annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: true, openWorldHint: true },
    handler: updateNote,
  },
  {
    name: "freeagent_delete_note",
    title: "Delete FreeAgent Note",
    description: "Permanently delete a note. Requires confirm: true. Confirm with the user before calling; the reply records what was removed.",
    inputSchema: DeleteNoteInputSchema.shape,
    annotations: { readOnlyHint: false, destructiveHint: true, idempotentHint: true, openWorldHint: true },
    handler: deleteNote,
  },

  // Journal Sets (fork addition: manual-jurisdiction adjustments, e.g. IoM CT zeroing)
  {
    name: "freeagent_list_journal_sets",
    title: "List FreeAgent Journal Sets",
    description: "List journal sets (balanced sets of manual accounting entries), filterable by date range and tag.",
    inputSchema: ListJournalSetsInputSchema.shape,
    annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: true },
    handler: listJournalSets,
  },
  {
    name: "freeagent_get_journal_set",
    title: "Get FreeAgent Journal Set",
    description: "Retrieve a single journal set with all its entries.",
    inputSchema: GetJournalSetInputSchema.shape,
    annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: true },
    handler: getJournalSet,
  },
  {
    name: "freeagent_create_journal_set",
    title: "Create FreeAgent Journal Set",
    description: "Create a balanced set of journal entries (debits positive, credits negative, must sum to zero). Categories accept names, nominal codes, or URLs. Requires confirm: true — journals move real account balances. Confirm with the user before calling.",
    inputSchema: CreateJournalSetInputSchema.shape,
    annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: true },
    handler: createJournalSet,
  },
  {
    name: "freeagent_update_journal_set",
    title: "Update FreeAgent Journal Set",
    description: "Update a journal set: change date/description, modify entries, add entries, or remove entries (_destroy). Requires confirm: true — it overwrites existing accounting data. The post-update set is balance-checked client-side before the write.",
    inputSchema: UpdateJournalSetInputSchema.shape,
    annotations: { readOnlyHint: false, destructiveHint: true, idempotentHint: false, openWorldHint: true },
    handler: updateJournalSet,
  },
  {
    name: "freeagent_delete_journal_set",
    title: "Delete FreeAgent Journal Set",
    description: "Permanently delete a journal set and all its entries. Requires confirm: true. Confirm with the user before calling; the reply records what was removed.",
    inputSchema: DeleteJournalSetInputSchema.shape,
    annotations: { readOnlyHint: false, destructiveHint: true, idempotentHint: true, openWorldHint: true },
    handler: deleteJournalSet,
  },

  // Statement upload + explanation delete (fork addition: reconciliation repair)
  {
    name: "freeagent_upload_bank_statement",
    title: "Upload FreeAgent Bank Statement",
    description: "Add bank transactions to an account via statement upload. Requires confirm: true. WARNING: FreeAgent silently de-duplicates rows matching an existing transaction's date+amount+description; vary the description or set a unique fitid to add deliberate same-day twins. The tool verifies the import (paginated) and reports dropped rows.",
    inputSchema: UploadBankStatementInputSchema.shape,
    annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: true },
    handler: (apiClient, params) => uploadBankStatement(apiClient, params),
  },
  {
    name: "freeagent_delete_bank_transaction_explanation",
    title: "Delete FreeAgent Bank Transaction Explanation",
    description: "Permanently delete a bank transaction explanation, returning its transaction to unexplained and breaking any transfer pairing. Never deletes bank transactions themselves. Requires confirm: true. Confirm with the user before calling.",
    inputSchema: DeleteBankTransactionExplanationInputSchema.shape,
    annotations: { readOnlyHint: false, destructiveHint: true, idempotentHint: true, openWorldHint: true },
    handler: deleteBankTransactionExplanation,
  },

  {
    name: "freeagent_invoice_from_timeslips",
    title: "Draft FreeAgent Invoice From Timeslips",
    description:
      "Draft an invoice from a contact's unbilled timeslips in one call. Resolves the contact by name/ID/URL, finds active projects, collects unbilled timeslips in the given date range (defaults: first day of previous month → today), groups by task using the task or project billing rate, and posts a draft invoice. Note: the timeslips themselves are not auto-linked to the invoice.",
    inputSchema: InvoiceFromTimeslipsInputSchema.shape,
    annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: true },
    handler: invoiceFromTimeslips,
  },

  // Expense Management
  {
    name: "freeagent_list_expenses",
    title: "List FreeAgent Expenses",
    description: "List expenses in your FreeAgent account with filtering and pagination.",
    inputSchema: ListExpensesInputSchema.shape,
    annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: true },
    handler: listExpenses,
  },
  {
    name: "freeagent_get_expense",
    title: "Get FreeAgent Expense Details",
    description: "Retrieve detailed information about a specific expense by ID.",
    inputSchema: GetExpenseInputSchema.shape,
    annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: true },
    handler: getExpense,
  },
  {
    name: "freeagent_create_expense",
    title: "Create FreeAgent Expense",
    description: "Create a new expense in FreeAgent, including regular expenses or mileage claims.",
    inputSchema: CreateExpenseInputSchema.shape,
    annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: true },
    handler: createExpense,
  },
  {
    name: "freeagent_update_expense",
    title: "Update FreeAgent Expense",
    description: "Update an existing expense in FreeAgent. Only provide the fields you want to change.",
    inputSchema: UpdateExpenseInputSchema.shape,
    annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: true, openWorldHint: true },
    handler: updateExpense,
  },
  // Bill Management
  {
    name: "freeagent_list_bills",
    title: "List FreeAgent Bills",
    description: "List supplier bills with filtering and pagination.",
    inputSchema: ListBillsInputSchema.shape,
    annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: true },
    handler: listBills,
  },
  {
    name: "freeagent_get_bill",
    title: "Get FreeAgent Bill Details",
    description: "Retrieve detailed information about a specific supplier bill by ID.",
    inputSchema: GetBillInputSchema.shape,
    annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: true },
    handler: getBill,
  },
  {
    name: "freeagent_create_bill",
    title: "Create FreeAgent Bill",
    description: "Create a new supplier bill in FreeAgent. Used to record money owed to suppliers.",
    inputSchema: CreateBillInputSchema.shape,
    annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: true },
    handler: createBill,
  },
  {
    name: "freeagent_update_bill",
    title: "Update FreeAgent Bill",
    description: "Update an existing supplier bill: dates, reference, comments, contact, and line items (add without id; modify with id; remove with id + _destroy: 1).",
    inputSchema: UpdateBillInputSchema.shape,
    annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: true, openWorldHint: true },
    handler: updateBill,
  },

  {
    name: "freeagent_log_expense",
    title: "Log FreeAgent Expense",
    description:
      "Log a regular expense in one call. Takes a POSITIVE amount plus `kind` ('expense' or 'refund') — the tool applies the correct sign, so you never send a negative value. Accepts a category name, nominal code, or URL; accepts a user email, ID, or URL (defaults to the sole user on the account). Use freeagent_create_expense for mileage, recurring expenses, or receipt attachments.",
    inputSchema: LogExpenseInputSchema.shape,
    annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: true },
    handler: logExpense,
  },

  // Timeslip Management
  {
    name: "freeagent_list_timeslips",
    title: "List FreeAgent Timeslips",
    description: "List timeslips in your FreeAgent account with filtering and pagination.",
    inputSchema: ListTimeslipsInputSchema.shape,
    annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: true },
    handler: listTimeslips,
  },
  {
    name: "freeagent_get_timeslip",
    title: "Get FreeAgent Timeslip Details",
    description: "Retrieve detailed information about a specific timeslip by ID.",
    inputSchema: GetTimeslipInputSchema.shape,
    annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: true },
    handler: getTimeslip,
  },
  {
    name: "freeagent_create_timeslip",
    title: "Create FreeAgent Timeslip",
    description: "Create a new timeslip (time tracking entry) in FreeAgent.",
    inputSchema: CreateTimeslipInputSchema.shape,
    annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: true },
    handler: createTimeslip,
  },
  {
    name: "freeagent_update_timeslip",
    title: "Update FreeAgent Timeslip",
    description: "Update an existing timeslip. Supports setting `billed_on_invoice` to link the timeslip to an invoice, though FreeAgent may reject external writes to that field.",
    inputSchema: UpdateTimeslipInputSchema.shape,
    annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: true, openWorldHint: true },
    handler: updateTimeslip,
  },

  // Bank Account Management
  {
    name: "freeagent_list_bank_accounts",
    title: "List FreeAgent Bank Accounts",
    description: "List all bank accounts in your FreeAgent account.",
    inputSchema: ListBankAccountsInputSchema.shape,
    annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: true },
    handler: listBankAccounts,
  },
  {
    name: "freeagent_get_bank_account",
    title: "Get FreeAgent Bank Account Details",
    description: "Retrieve detailed information about a specific bank account by ID.",
    inputSchema: GetBankAccountInputSchema.shape,
    annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: true },
    handler: getBankAccount,
  },
  {
    name: "freeagent_list_bank_transactions",
    title: "List FreeAgent Bank Transactions",
    description: "List bank transactions for a specific bank account with pagination and filtering.",
    inputSchema: ListBankTransactionsInputSchema.shape,
    annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: true },
    handler: listBankTransactions,
  },
  {
    name: "freeagent_get_bank_transaction",
    title: "Get FreeAgent Bank Transaction",
    description: "Get detailed information about a specific bank transaction including amount, description, and explanation status.",
    inputSchema: GetBankTransactionInputSchema.shape,
    annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: true },
    handler: getBankTransaction,
  },

  // Bank Transaction Explanations
  {
    name: "freeagent_list_bank_transaction_explanations",
    title: "List FreeAgent Bank Transaction Explanations",
    description: "List bank transaction explanations showing how transactions were categorized or linked to invoices, bills, or transfers.",
    inputSchema: ListBankTransactionExplanationsInputSchema.shape,
    annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: true },
    handler: listBankTransactionExplanations,
  },
  {
    name: "freeagent_get_bank_transaction_explanation",
    title: "Get FreeAgent Bank Transaction Explanation",
    description: "Get detailed information about a specific bank transaction explanation including categorization, tax info, and linked entities.",
    inputSchema: GetBankTransactionExplanationInputSchema.shape,
    annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: true },
    handler: getBankTransactionExplanation,
  },
  {
    name: "freeagent_create_bank_transaction_explanation",
    title: "Explain FreeAgent Bank Transaction",
    description: "Create an explanation for a bank transaction by linking it to invoices, bills, or categories.",
    inputSchema: CreateBankTransactionExplanationInputSchema.shape,
    annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: true },
    handler: createBankTransactionExplanation,
  },
  {
    name: "freeagent_update_bank_transaction_explanation",
    title: "Update FreeAgent Bank Transaction Explanation",
    description: "Update an existing bank transaction explanation. Only provide the fields you want to change. Accepts an optional attachment (same 8MB decoded-size limit and content types as create).",
    inputSchema: UpdateBankTransactionExplanationInputSchema.shape,
    annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: true, openWorldHint: true },
    handler: updateBankTransactionExplanation,
  },
  {
    name: "freeagent_reconcile_bank_transaction",
    title: "Reconcile FreeAgent Bank Transaction",
    description:
      "Explain a bank transaction in one call. Accepts a human-friendly hint (category name like 'Travel', nominal code like '285', invoice reference like 'INV-001', or bill reference) and resolves it to the correct FreeAgent URL server-side. Auto-fills date and amount from the transaction, so you do not need to call get_bank_transaction or list_categories first. Provide exactly one of `category`, `paid_invoice`, or `paid_bill`.",
    inputSchema: ReconcileBankTransactionInputSchema.shape,
    annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: true },
    handler: reconcileBankTransaction,
  },

  // Project Management
  {
    name: "freeagent_list_projects",
    title: "List FreeAgent Projects",
    description: "List all projects in your FreeAgent account with filtering and pagination.",
    inputSchema: ListProjectsInputSchema.shape,
    annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: true },
    handler: listProjects,
  },
  {
    name: "freeagent_get_project",
    title: "Get FreeAgent Project Details",
    description: "Retrieve detailed information about a specific project by ID.",
    inputSchema: GetProjectInputSchema.shape,
    annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: true },
    handler: getProject,
  },
  {
    name: "freeagent_create_project",
    title: "Create FreeAgent Project",
    description: "Create a new project in FreeAgent.",
    inputSchema: CreateProjectInputSchema.shape,
    annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: true },
    handler: createProject,
  },
  {
    name: "freeagent_update_project",
    title: "Update FreeAgent Project",
    description: "Update an existing project: name, status, budget, billing rate, dates, PO reference. Only provided fields are changed.",
    inputSchema: UpdateProjectInputSchema.shape,
    annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: true, openWorldHint: true },
    handler: updateProject,
  },

  // Task Management
  {
    name: "freeagent_list_tasks",
    title: "List FreeAgent Tasks",
    description: "List tasks in your FreeAgent account with filtering and pagination.",
    inputSchema: ListTasksInputSchema.shape,
    annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: true },
    handler: listTasks,
  },
  {
    name: "freeagent_get_task",
    title: "Get FreeAgent Task Details",
    description: "Retrieve detailed information about a specific task by ID.",
    inputSchema: GetTaskInputSchema.shape,
    annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: true },
    handler: getTask,
  },
  {
    name: "freeagent_create_task",
    title: "Create FreeAgent Task",
    description: "Create a new task within a project in FreeAgent.",
    inputSchema: CreateTaskInputSchema.shape,
    annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: true },
    handler: createTask,
  },
  {
    name: "freeagent_update_task",
    title: "Update FreeAgent Task",
    description: "Update an existing task: name, status, billing. Only provided fields are changed.",
    inputSchema: UpdateTaskInputSchema.shape,
    annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: true, openWorldHint: true },
    handler: updateTask,
  },

  // Category Management
  {
    name: "freeagent_list_categories",
    title: "List FreeAgent Categories",
    description: "List all categories in your FreeAgent account for expenses, invoices, and transactions.",
    inputSchema: ListCategoriesInputSchema.shape,
    annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: true },
    handler: listCategories,
  },
  {
    name: "freeagent_get_category",
    title: "Get FreeAgent Category Details",
    description: "Retrieve detailed information about a specific category by nominal code.",
    inputSchema: GetCategoryInputSchema.shape,
    annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: true },
    handler: getCategory,
  },

  // Company & Users
  {
    name: "freeagent_get_company",
    title: "Get FreeAgent Company Information",
    description: "Retrieve information about your FreeAgent company account.",
    inputSchema: GetCompanyInputSchema.shape,
    annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: true },
    handler: getCompany,
  },
  {
    name: "freeagent_list_users",
    title: "List FreeAgent Users",
    description: "List all users in your FreeAgent account.",
    inputSchema: ListUsersInputSchema.shape,
    annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: true },
    handler: listUsers,
  },
  {
    name: "freeagent_get_user",
    title: "Get FreeAgent User",
    description: "Retrieve a single user by ID, URL, or 'me' for the authenticated user.",
    inputSchema: GetUserInputSchema.shape,
    annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: true },
    handler: getUser,
  },
  {
    name: "freeagent_list_email_addresses",
    title: "List FreeAgent Verified Email Addresses",
    description: "List the account's verified sender email addresses (the addresses FreeAgent may send invoices and estimates from).",
    inputSchema: ListEmailAddressesInputSchema.shape,
    annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: true },
    handler: listEmailAddresses,
  },
];

/**
 * Meta-tool definitions used when FREEAGENT_TOOL_SEARCH=true.
 * These are the only tools exposed over tools/list in tool-search mode; the
 * full catalog above is reachable through freeagent_call_tool.
 */
export const toolSearchMetaDefinitions: ToolDefinition[] = [
  {
    name: "freeagent_search_tools",
    title: "Search FreeAgent Tool Catalog",
    description:
      "Search the FreeAgent tool catalog and return JSONSchema definitions for matching tools. Use this to discover which tool to call before invoking freeagent_call_tool. Supports 'select:name1,name2' for direct name lookup, '+required optional' to require specific keywords, or plain keywords for a ranked search.",
    inputSchema: SearchToolsInputSchema.shape,
    annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false },
    handler: (_apiClient, params) => searchTools(toolDefinitions, params),
  },
  {
    name: "freeagent_call_tool",
    title: "Call FreeAgent Tool By Name",
    description:
      "Invoke a FreeAgent catalog tool by name with the given arguments. Pair with freeagent_search_tools to discover tool names and input schemas — this meta-tool validates arguments against the target tool's Zod schema before dispatching.",
    inputSchema: CallToolInputSchema.shape,
    annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: true },
    handler: (apiClient, params, ctx) => callTool(toolDefinitions, apiClient, params, ctx),
  },
];

/**
 * Whether tool-search mode is enabled. When true, only the two meta-tools are
 * registered over MCP; the full catalog is reached through freeagent_call_tool.
 * Controlled by the FREEAGENT_TOOL_SEARCH env var (accepts "true" or "1").
 */
export function isToolSearchMode(): boolean {
  const raw = process.env.FREEAGENT_TOOL_SEARCH;
  return raw === "true" || raw === "1";
}

const READ_TOOL_NAME = /^freeagent_(list|get)_/;
const CREATE_EXPLANATION = "freeagent_create_bank_transaction_explanation";

function forceMarkedForReview(tool: ToolDefinition): ToolDefinition {
  return {
    ...tool,
    handler: async (apiClient, params, ctx) =>
      tool.handler(apiClient, { ...params, marked_for_review: true }, ctx),
  };
}

/**
 * Filter the catalog for hosted static-bearer scopes.
 * - read: list_* / get_* only
 * - read_draft: read plus create_bank_transaction_explanation (marked_for_review forced true)
 * - full: the complete catalog
 */
export function toolsForScope(
  scope: McpStaticScope,
  catalog: ToolDefinition[] = toolDefinitions
): ToolDefinition[] {
  if (scope === "full") return catalog;
  const readTools = catalog.filter((tool) => READ_TOOL_NAME.test(tool.name));
  if (scope === "read") return readTools;
  const createExplanation = catalog.find((tool) => tool.name === CREATE_EXPLANATION);
  if (!createExplanation) return readTools;
  return [...readTools, forceMarkedForReview(createExplanation)];
}

function metaToolsFor(catalog: ToolDefinition[]): ToolDefinition[] {
  return [
    {
      ...toolSearchMetaDefinitions[0],
      handler: (_apiClient, params) => searchTools(catalog, params),
    },
    {
      ...toolSearchMetaDefinitions[1],
      handler: (apiClient, params, ctx) => callTool(catalog, apiClient, params, ctx),
    },
  ];
}

/**
 * Register FreeAgent tools on an McpServer instance.
 *
 * In default mode, registers every catalog tool directly. In tool-search mode
 * (FREEAGENT_TOOL_SEARCH=true) registers only the two meta-tools
 * freeagent_search_tools and freeagent_call_tool, which dramatically reduces
 * the token footprint of tools/list for clients with many MCP servers.
 *
 * @param server - The McpServer to register tools on
 * @param apiClient - The FreeAgent API client to use for API calls
 * @param options.scope - Hosted static-bearer scope; stdio and OAuth/JWT omit this (full catalog)
 */
export function registerAllTools(
  server: McpServer,
  apiClient: FreeAgentApiClient,
  options?: { scope?: McpStaticScope }
): void {
  const ctx: ToolContext = {
    get clientSupportsElicitation(): boolean {
      return Boolean(server.server.getClientCapabilities()?.elicitation);
    },
    elicit: (params) => server.server.elicitInput(params),
  };

  const catalog = toolsForScope(options?.scope ?? "full");
  const tools = isToolSearchMode() ? metaToolsFor(catalog) : catalog;

  for (const tool of tools) {
    server.registerTool(
      tool.name,
      {
        title: tool.title,
        description: tool.description,
        inputSchema: tool.inputSchema,
        annotations: tool.annotations,
      },
      async (params: any) => {
        // Stderr breadcrumbs (visible in mcp-server-*.log): Claude Desktop's own
        // log lines don't name the tool, which made the 19 Jul "hang" report
        // undiagnosable from the server side. This records tool, duration, outcome.
        const startedAt = Date.now();
        const logCall = (outcome: "ok" | "error", detail?: string) =>
          console.error(JSON.stringify({
            timestamp: new Date().toISOString(),
            level: outcome === "ok" ? "info" : "warn",
            message: "tool call finished",
            data: { tool: tool.name, outcome, durationMs: Date.now() - startedAt, ...(detail && { detail }) },
          }));
        try {
          const result = await tool.handler(apiClient, params, ctx);
          logCall("ok");
          return { content: [{ type: "text" as const, text: result }] };
        } catch (error) {
          logCall("error", error instanceof Error ? error.message : String(error));
          return { isError: true, content: [{ type: "text" as const, text: formatErrorForLLM(error as Error) }] };
        }
      }
    );
  }
}
