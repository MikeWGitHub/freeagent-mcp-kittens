/**
 * Type definitions for FreeAgent API
 */

export interface FreeAgentContact {
  url: string;
  first_name?: string;
  last_name?: string;
  organisation_name?: string;
  email?: string;
  phone_number?: string;
  mobile?: string;
  address1?: string;
  address2?: string;
  address3?: string;
  town?: string;
  region?: string;
  postcode?: string;
  country?: string;
  contact_name_on_invoices?: boolean;
  default_payment_terms_in_days?: number;
  charge_sales_tax?: string;
  active_projects_count?: number;
  created_at?: string;
  updated_at?: string;
}

export interface FreeAgentInvoice {
  url: string;
  contact: string;
  project?: string;
  invoice_items?: FreeAgentInvoiceItem[];
  dated_on: string;
  due_on?: string;
  reference?: string;
  currency: string;
  exchange_rate?: string;
  net_value: string;
  sales_tax_value: string;
  total_value: string;
  paid_value?: string;
  due_value?: string;
  status: string;
  comments?: string;
  discount_percent?: string;
  payment_terms_in_days?: number;
  ec_status?: string;
  written_off_date?: string;
  created_at?: string;
  updated_at?: string;
}

export interface FreeAgentInvoiceItem {
  item_type: string;
  description: string;
  price: string;
  quantity: string;
  sales_tax_rate?: string;
}

export interface FreeAgentExpense {
  url: string;
  user: string;
  category: string;
  dated_on: string;
  gross_value: string;
  currency?: string;
  sales_tax_value?: string;
  sales_tax_rate?: string;
  sales_tax_status?: string;
  description?: string;
  receipt_reference?: string;
  manual_sales_tax_amount?: string;
  ec_status?: string;
  project?: string;
  attachment?: string;
  attachment_count?: number;
  miles?: string;
  mileage?: string;
  vehicle_type?: string;
  engine_type?: string;
  engine_size?: string;
  initial_mileage?: string;
  mileage_type?: string;
  reclaim_mileage?: boolean;
  rebill_type?: string;
  rebilled_on_invoice?: string;
  recurring?: boolean;
  next_recurs_on?: string;
  recurring_end_date?: string;
  created_at?: string;
  updated_at?: string;
}

export interface FreeAgentProject {
  url: string;
  contact: string;
  name: string;
  budget: string;
  is_ir35: boolean;
  status: string;
  budget_units: string;
  currency?: string;
  normal_billing_rate?: string;
  billing_period?: string;
  hours_per_day?: string;
  starts_on?: string;
  ends_on?: string;
  contract_po_reference?: string;
  include_unbilled_time_in_profitability?: boolean;
  is_deletable?: boolean;
  uses_project_invoice_sequence?: boolean;
  created_at?: string;
  updated_at?: string;
}

export interface FreeAgentBankAccount {
  url: string;
  name: string;
  type: string;
  currency: string;
  opening_balance: string;
  current_balance?: string;
  is_personal?: boolean;
  is_primary?: boolean;
  is_active?: boolean;
  bank_name?: string;
  account_number?: string;
  sort_code?: string;
  iban?: string;
  bic?: string;
  created_at?: string;
  updated_at?: string;
}

export interface FreeAgentBankTransaction {
  url: string;
  bank_account: string;
  dated_on: string;
  /**
   * NOT returned by the bank transaction API — kept optional only because
   * some historical payloads carried it. The real fields are `amount` and
   * `unexplained_amount`; treating gross_value as required enabled the
   * Jul 2026 reconcile bug (0.00 explanations). Audit B-MED-4.
   */
  gross_value?: string;
  amount?: string;
  description?: string;
  unexplained_amount?: string;
  is_manual?: boolean;
  bank_transaction_explanations?: string[];
  uploaded_at?: string;
  created_at?: string;
  updated_at?: string;
}

export interface FreeAgentCompany {
  url: string;
  name: string;
  subdomain: string;
  type: string;
  currency: string;
  mileage_units: string;
  company_start_date: string;
  freeagent_start_date: string;
  first_accounting_year_end: string;
  company_registration_number?: string;
  sales_tax_registration_status: string;
  created_at?: string;
  updated_at?: string;
}

export interface FreeAgentUser {
  url: string;
  email: string;
  first_name: string;
  last_name: string;
  role: string;
  permission_level: number;
  opening_mileage?: number;
  created_at?: string;
  updated_at?: string;
}

export interface FreeAgentCategory {
  url: string;
  description: string;
  nominal_code: string;
  group_description?: string;
  allowable_for_tax?: boolean;
  tax_reporting_name?: string;
  auto_sales_tax_rate?: number | string;
  bank_account?: string;
  capital_asset_type?: string;
  user?: string;
  created_at?: string;
  updated_at?: string;
}

export interface FreeAgentTask {
  url: string;
  project: string;
  name: string;
  status: string;
  is_billable: boolean;
  billing_rate?: string;
  billing_period?: string;
  currency?: string;
  is_deletable?: boolean;
  created_at?: string;
  updated_at?: string;
}

export interface FreeAgentTimeslip {
  url: string;
  user: string;
  project: string;
  task: string;
  dated_on: string;
  hours: string;
  comment?: string;
  billed_on_invoice?: string;
  attachment_count?: number;
  created_at?: string;
  updated_at?: string;
}

export interface FreeAgentBankTransactionExplanation {
  url: string;
  bank_transaction: string;
  dated_on: string;
  gross_value: string;
  description?: string;
  category?: string;
  type?: string;
  linked_transfer_account?: string;
  ec_status?: string;
  receipt_reference?: string;
  marked_for_review?: boolean;
  paid_invoice?: string;
  paid_bill?: string;
  paid_user?: string;
  transfer_bank_account?: string;
  project?: string;
  sales_tax_rate?: string;
  sales_tax_value?: string;
  attachment_count?: number;
  created_at?: string;
  updated_at?: string;
}

export interface FreeAgentBillItem {
  category?: string;
  description?: string;
  price?: string;
  quantity?: string;
  sales_tax_rate?: string;
  sales_tax_value?: string;
  total_value?: string;
}

export interface FreeAgentBill {
  url: string;
  contact: string;
  reference?: string;
  dated_on: string;
  due_on?: string;
  currency?: string;
  exchange_rate?: string;
  net_value?: string;
  sales_tax_value?: string;
  total_value: string;
  paid_value?: string;
  due_value?: string;
  status?: string;
  comments?: string;
  bill_items?: FreeAgentBillItem[];
  category?: string;
  ec_status?: string;
  payment_terms_in_days?: number;
  attachment?: string;
  created_at?: string;
  updated_at?: string;
}

export interface FreeAgentEstimateItem {
  item_type: string;
  description: string;
  price: string;
  quantity: string;
  sales_tax_rate?: string;
}

export interface FreeAgentEstimate {
  url: string;
  contact: string;
  project?: string;
  reference?: string;
  dated_on: string;
  expires_on?: string;
  currency?: string;
  net_value?: string;
  sales_tax_value?: string;
  total_value?: string;
  status?: string;
  discount_percent?: string;
  comments?: string;
  terms_and_conditions?: string;
  payment_terms_in_days?: number;
  estimate_items?: FreeAgentEstimateItem[];
  ec_status?: string;
  created_at?: string;
  updated_at?: string;
}

export interface FreeAgentRecurringInvoiceItem {
  item_type: string;
  description: string;
  price: string;
  quantity: string;
  sales_tax_rate?: string;
}

export interface FreeAgentRecurringInvoice {
  url: string;
  contact: string;
  project?: string;
  frequency?: string;
  next_recurs_on?: string;
  ends_on?: string;
  status?: string;
  currency?: string;
  reference?: string;
  payment_terms_in_days?: number;
  comments?: string;
  total_value?: string;
  recurring_invoice_items?: FreeAgentRecurringInvoiceItem[];
  invoice_items?: FreeAgentRecurringInvoiceItem[];
  created_at?: string;
  updated_at?: string;
}

export interface FreeAgentPriceListItem {
  url: string;
  item_type: string;
  description: string;
  price: string;
  sales_tax_rate?: string;
  category?: string;
  created_at?: string;
  updated_at?: string;
}

export interface FreeAgentCreditNoteItem {
  url?: string;
  position?: number;
  item_type?: string;
  description: string;
  price?: string;
  quantity?: string;
  sales_tax_rate?: string;
  sales_tax_status?: string;
  category?: string;
  project?: string;
  stock_item?: string;
}

export interface FreeAgentCreditNote {
  url: string;
  contact: string;
  project?: string;
  dated_on: string;
  due_on?: string;
  reference?: string;
  currency?: string;
  exchange_rate?: string;
  net_value?: string;
  sales_tax_value?: string;
  total_value?: string;
  refunded_value?: string;
  due_value?: string;
  status?: string;
  long_status?: string;
  comments?: string;
  discount_percent?: string;
  po_reference?: string;
  ec_status?: string;
  payment_terms_in_days?: number;
  refunded_on?: string;
  written_off_date?: string;
  credit_note_items?: FreeAgentCreditNoteItem[];
  created_at?: string;
  updated_at?: string;
}

export interface FreeAgentDepreciationProfile {
  method: string;
  asset_life_years?: number;
  annual_depreciation_percentage?: number;
  frequency?: string;
}

export interface FreeAgentCapitalAssetHistoryEvent {
  type?: string;
  description?: string;
  date?: string;
  value?: string;
  tax_value?: string;
  link?: string;
}

export interface FreeAgentCapitalAsset {
  url: string;
  description?: string;
  asset_type?: string;
  depreciation_profile?: FreeAgentDepreciationProfile;
  asset_life_years?: number;
  purchased_on?: string;
  disposed_on?: string;
  capital_asset_history?: FreeAgentCapitalAssetHistoryEvent[];
  created_at?: string;
  updated_at?: string;
}

export interface FreeAgentCapitalAssetType {
  url: string;
  name: string;
  system_default?: boolean;
  created_at?: string;
  updated_at?: string;
}

export interface FreeAgentStockItem {
  url: string;
  description?: string;
  opening_quantity?: number;
  opening_balance?: string;
  cost_of_sale_category?: string;
  stock_on_hand?: number;
  created_at?: string;
  updated_at?: string;
}

export interface FreeAgentNote {
  url: string;
  note: string;
  parent_url?: string;
  author?: string;
  created_at?: string;
  updated_at?: string;
}

export interface FreeAgentAttachment {
  url: string;
  content_src?: string;
  content_src_medium?: string;
  content_src_small?: string;
  expires_at?: string;
  content_type?: string;
  file_name?: string;
  file_size?: number;
  description?: string;
}

/** Shared shape for Final Accounts Reports and Corporation Tax Returns. */
export interface FreeAgentAnnualReturn {
  url: string;
  period_starts_on?: string;
  period_ends_on: string;
  filing_due_on?: string;
  filing_status?: string;
  filed_at?: string;
  filed_reference?: string;
  amount_due?: string;
  payment_due_on?: string;
  payment_status?: string;
}

export interface FreeAgentVatReturnPayment {
  label?: string;
  due_on?: string;
  amount_due?: string;
  status?: string;
}

export interface FreeAgentVatReturnBreakdownRow {
  title?: string;
  value?: string;
  key?: string;
  box_number?: string;
}

export interface FreeAgentVatReturn {
  url: string;
  period_starts_on?: string;
  period_ends_on: string;
  filing_due_on?: string;
  filing_status?: string;
  filed_at?: string;
  filed_reference?: string;
  payments?: FreeAgentVatReturnPayment[];
  breakdown?: {
    title?: string;
    rows?: FreeAgentVatReturnBreakdownRow[];
  };
}

export interface FreeAgentSalesTaxPeriod {
  url: string;
  sales_tax_name?: string;
  sales_tax_registration_status?: string;
  sales_tax_registration_number?: string;
  sales_tax_rate_1?: string;
  sales_tax_rate_2?: string;
  sales_tax_rate_3?: string;
  sales_tax_is_value_added?: boolean;
  effective_date?: string;
  is_locked?: boolean;
  locked_reason?: string;
}

export interface FreeAgentLedgerTransaction {
  url: string;
  dated_on: string;
  description?: string;
  category?: string;
  category_name?: string;
  nominal_code?: string;
  debit_value?: string;
  source_item_url?: string;
  foreign_currency_data?: {
    currency_code?: string;
    debit_value?: string;
  };
  created_at?: string;
  updated_at?: string;
}

export interface FreeAgentProfitAndLossSummary {
  from?: string;
  to?: string;
  income?: string;
  expenses?: string;
  operating_profit?: string;
  less?: Array<{ title?: string; total?: string }>;
  retained_profit?: string;
  retained_profit_brought_forward?: string;
  retained_profit_carried_forward?: string;
}

export interface FreeAgentTrialBalanceRow {
  category?: string;
  nominal_code?: string;
  display_nominal_code?: string;
  name?: string;
  total?: string;
  bank_account?: string;
  user?: string;
}

export interface FreeAgentCashflowSide {
  total?: string;
  months?: Array<{ month?: number; year?: number; total?: string }>;
}

export interface FreeAgentCashflow {
  from?: string;
  to?: string;
  incoming?: FreeAgentCashflowSide;
  outgoing?: FreeAgentCashflowSide;
  balance?: string;
}

export interface FreeAgentApiErrorItem {
  message?: string;
  [key: string]: unknown;
}

export interface FreeAgentApiError {
  message: string;
  errors?: FreeAgentApiErrorItem[] | Record<string, string[] | string | FreeAgentApiErrorItem>;
}

export interface PaginationInfo {
  page: number;
  per_page: number;
  total_count?: number;
  has_more: boolean;
  next_page?: number;
}
