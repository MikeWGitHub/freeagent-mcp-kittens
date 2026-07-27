/**
 * Zod Validation Schemas for FreeAgent MCP Tools
 */

import { z } from "zod";
import { ResponseFormat, DEFAULT_PAGE_SIZE, MAX_PAGE_SIZE } from "../constants.js";

// Base pagination schema
export const PaginationSchema = z.object({
  page: z.number()
    .int()
    .min(1)
    .default(1)
    .describe("Page number for pagination (starts at 1)"),
  per_page: z.number()
    .int()
    .min(1)
    .max(MAX_PAGE_SIZE)
    .default(DEFAULT_PAGE_SIZE)
    .describe(`Number of items per page (max ${MAX_PAGE_SIZE})`)
}).strict();

// Response format schema
export const ResponseFormatSchema = z.nativeEnum(ResponseFormat)
  .default(ResponseFormat.MARKDOWN)
  .describe("Output format: 'markdown' for human-readable or 'json' for machine-readable");

// Tool-search schemas (meta-tools used when FREEAGENT_TOOL_SEARCH=true)
export const SearchToolsInputSchema = z.object({
  query: z.string()
    .min(1)
    .describe(
      "Query for the FreeAgent tool catalog. Forms: 'select:name1,name2' to fetch specific tools by exact name; '+must_have optional' to require certain keywords and rank by the rest; or plain keywords for a ranked search (e.g. 'list invoices', 'reconcile bank transaction')."
    ),
  max_results: z.number()
    .int()
    .min(1)
    .max(50)
    .default(5)
    .describe("Maximum number of tool schemas to return (default 5). Ignored for 'select:' queries, which return every named tool."),
}).strict();

export const CallToolInputSchema = z.object({
  name: z.string()
    .min(1)
    .describe("Exact name of a FreeAgent tool from the catalog (e.g. 'freeagent_list_invoices'). Discover names with freeagent_search_tools first."),
  arguments: z.record(z.string(), z.unknown())
    .default({})
    .describe("Arguments object matching the target tool's input schema. Use freeagent_search_tools to fetch the schema if unknown."),
}).strict();

// Contact schemas
export const ListContactsInputSchema = z.object({
  page: PaginationSchema.shape.page,
  per_page: PaginationSchema.shape.per_page,
  sort: z.enum(["created_at", "updated_at", "first_name", "last_name", "organisation_name"])
    .optional()
    .describe("Field to sort by"),
  response_format: ResponseFormatSchema
}).strict();

export const GetContactInputSchema = z.object({
  contact_id: z.string()
    .min(1)
    .describe("The FreeAgent contact ID (numeric) or full URL"),
  response_format: ResponseFormatSchema
}).strict();

export const CreateContactInputSchema = z.object({
  first_name: z.string().optional().describe("Contact's first name"),
  last_name: z.string().optional().describe("Contact's last name"),
  organisation_name: z.string().optional().describe("Organisation name"),
  email: z.string().email().optional().describe("Email address"),
  phone_number: z.string().optional().describe("Phone number"),
  mobile: z.string().optional().describe("Mobile number"),
  address1: z.string().optional().describe("Address line 1"),
  town: z.string().optional().describe("Town/City"),
  postcode: z.string().optional().describe("Postal code"),
  country: z.string().optional().describe("Country code (e.g., GB, US)")
}).strict();

// Invoice schemas
export const ListInvoicesInputSchema = z.object({
  page: PaginationSchema.shape.page,
  per_page: PaginationSchema.shape.per_page,
  view: z.enum(["all", "recent_open_or_overdue", "draft", "scheduled", "sent", "overdue"])
    .optional()
    .describe("Filter invoices by status view"),
  contact: z.string().optional().describe("Filter by contact URL or ID"),
  project: z.string().optional().describe("Filter by project URL or ID"),
  sort: z.enum(["created_at", "updated_at", "dated_on", "due_on"])
    .optional()
    .describe("Field to sort by (prefix with '-' for descending)"),
  response_format: ResponseFormatSchema
}).strict();

export const GetInvoiceInputSchema = z.object({
  invoice_id: z.string()
    .min(1)
    .describe("The FreeAgent invoice ID (numeric) or full URL"),
  response_format: ResponseFormatSchema
}).strict();

export const CreateInvoiceInputSchema = z.object({
  contact: z.string()
    .optional()
    .describe("Contact URL or ID to invoice. If omitted, the server will elicit a choice from the user when the client supports form elicitation; otherwise the call fails with a clear error."),
  dated_on: z.string()
    .regex(/^\d{4}-\d{2}-\d{2}$/)
    .describe("Invoice date in YYYY-MM-DD format"),
  due_on: z.string()
    .regex(/^\d{4}-\d{2}-\d{2}$/)
    .optional()
    .describe("Due date in YYYY-MM-DD format"),
  reference: z.string().optional().describe("Invoice reference number"),
  currency: z.string()
    .length(3)
    .default("GBP")
    .describe("Currency code (e.g., GBP, USD, EUR)"),
  comments: z.string().optional().describe("Comments for the invoice"),
  payment_terms_in_days: z.number().int().optional().describe("Payment terms in days"),
  discount_percent: z.string()
    .optional()
    .describe("Discount to apply, as a decimal string (e.g., '20' for 20%)."),
  invoice_items: z.array(z.object({
    item_type: z.string().describe("Item type (e.g., 'Hours', 'Days', 'Products')"),
    description: z.string().describe("Item description"),
    price: z.string().describe("Price per unit"),
    quantity: z.string().describe("Quantity")
  })).min(1).describe("Array of invoice line items")
}).strict();

// Expense schemas
export const ListExpensesInputSchema = z.object({
  page: PaginationSchema.shape.page,
  per_page: PaginationSchema.shape.per_page,
  view: z.enum(["recent", "awaiting_receipt", "all"])
    .optional()
    .describe("Filter expenses by view"),
  from_date: z.string()
    .regex(/^\d{4}-\d{2}-\d{2}$/)
    .optional()
    .describe("Filter expenses from this date (YYYY-MM-DD)"),
  to_date: z.string()
    .regex(/^\d{4}-\d{2}-\d{2}$/)
    .optional()
    .describe("Filter expenses to this date (YYYY-MM-DD)"),
  response_format: ResponseFormatSchema
}).strict();

export const GetExpenseInputSchema = z.object({
  expense_id: z.string()
    .min(1)
    .describe("The FreeAgent expense ID (numeric) or full URL"),
  response_format: ResponseFormatSchema
}).strict();

// Attachment schema for expenses and bank transaction explanations
// PERFORMANCE NOTE: For large files, use gzip compression before Base64 encoding to significantly reduce size
// and speed up LLM processing (which processes character-by-character). The server will automatically decompress.
const AttachmentSchema = z.object({
  data: z.string().describe("Base64 encoded file content. For large files, gzip compress first then Base64 encode, and set is_gzipped=true"),
  is_gzipped: z.boolean()
    .optional()
    .describe("Set to true if the data is gzip-compressed before Base64 encoding (default: false). Server will automatically decompress before uploading to FreeAgent."),
  file_name: z.string().describe("Original filename"),
  content_type: z.enum(["application/pdf", "image/png", "image/jpeg", "image/gif"])
    .describe("MIME type of the file"),
  description: z.string().optional().describe("Optional description of the attachment")
}).strict();

export const CreateExpenseInputSchema = z.object({
  user: z.string()
    .min(1)
    .describe("User URL or ID who incurred the expense"),
  category: z.string()
    .min(1)
    .describe("Expense category URL or ID (use 'Mileage' for mileage expenses)"),
  dated_on: z.string()
    .regex(/^\d{4}-\d{2}-\d{2}$/)
    .describe("Date of expense in YYYY-MM-DD format"),
  description: z.string()
    .optional()
    .describe("Description of the expense"),
  gross_value: z.string()
    .optional()
    .describe("Total amount including tax (decimal string). IMPORTANT: Use NEGATIVE values for normal expenses (e.g., '-10.00' for a £10 expense). Positive values create refunds due FROM the claimant. Required unless category is 'Mileage'."),
  sales_tax_rate: z.string()
    .optional()
    .describe("Sales tax rate as decimal (e.g., '0.20' for 20%)"),
  manual_sales_tax_amount: z.string()
    .optional()
    .describe("Manual sales tax amount (overrides sales_tax_rate)"),
  currency: z.string()
    .length(3)
    .optional()
    .describe("Currency code (e.g., GBP, USD, EUR)"),
  ec_status: z.enum(["UK/Non-EC", "EC Goods", "EC Services", "Reverse Charge"])
    .optional()
    .describe("EC (European Community) status for the expense (Note: EC Goods and EC Services invalid for transactions dated 2021-01-01+ in Great Britain)"),
  receipt_reference: z.string()
    .optional()
    .describe("Receipt reference identifier"),
  attachment: AttachmentSchema
    .optional()
    .describe("File attachment (receipt) for the expense"),
  project: z.string()
    .optional()
    .describe("Project URL or ID to associate with expense"),
  // Recurring expense fields
  recurring: z.enum(["Weekly", "Two Weekly", "Four Weekly", "Two Monthly", "Quarterly", "Biannually", "Annually", "2-Yearly"])
    .optional()
    .describe("Recurring frequency for repeating expenses"),
  next_recurs_on: z.string()
    .regex(/^\d{4}-\d{2}-\d{2}$/)
    .optional()
    .describe("Next recurrence date in YYYY-MM-DD format (for recurring expenses)"),
  recurring_end_date: z.string()
    .regex(/^\d{4}-\d{2}-\d{2}$/)
    .optional()
    .describe("End date for recurring expenses in YYYY-MM-DD format"),
  // Mileage-specific fields
  mileage_vehicle_type: z.enum(["Car", "Motorcycle", "Bicycle"])
    .optional()
    .describe("Vehicle type for mileage expenses (API field: vehicle_type)"),
  miles: z.string()
    .optional()
    .describe("Distance traveled in miles (decimal string) (API field: mileage)"),
  initial_mileage: z.string()
    .optional()
    .describe("Starting odometer reading"),
  mileage_type: z.enum(["Business", "Personal"])
    .optional()
    .describe("Type of mileage"),
  engine_type: z.enum(["Petrol", "Diesel", "LPG", "Electric", "Electric (Home charger)", "Electric (Public charger)"])
    .optional()
    .describe("Engine type for mileage expenses (affects rate calculation)"),
  engine_size: z.string()
    .optional()
    .describe("Engine size (depends on engine_type selection)"),
  reclaim_mileage: z.number()
    .int()
    .min(0)
    .max(1)
    .optional()
    .describe("Mileage reclaim method: 0 = rebill only (default), 1 = AMAP rate")
}).strict();

export const UpdateExpenseInputSchema = z.object({
  expense_id: z.string()
    .min(1)
    .describe("The FreeAgent expense ID (numeric) or full URL"),
  user: z.string()
    .optional()
    .describe("User URL or ID who incurred the expense"),
  category: z.string()
    .optional()
    .describe("Expense category URL or ID"),
  dated_on: z.string()
    .regex(/^\d{4}-\d{2}-\d{2}$/)
    .optional()
    .describe("Date of expense in YYYY-MM-DD format"),
  description: z.string()
    .optional()
    .describe("Description of the expense"),
  gross_value: z.string()
    .optional()
    .describe("Total amount including tax (decimal string). IMPORTANT: Use NEGATIVE values for normal expenses (e.g., '-10.00' for a £10 expense). Positive values create refunds due FROM the claimant. Required unless category is 'Mileage'."),
  sales_tax_rate: z.string()
    .optional()
    .describe("Sales tax rate as decimal (e.g., '0.20' for 20%)"),
  manual_sales_tax_amount: z.string()
    .optional()
    .describe("Manual sales tax amount (overrides sales_tax_rate)"),
  currency: z.string()
    .length(3)
    .optional()
    .describe("Currency code (e.g., GBP, USD, EUR)"),
  ec_status: z.enum(["UK/Non-EC", "EC Goods", "EC Services", "Reverse Charge"])
    .optional()
    .describe("EC (European Community) status for the expense (Note: EC Goods and EC Services invalid for transactions dated 2021-01-01+ in Great Britain)"),
  receipt_reference: z.string()
    .optional()
    .describe("Receipt reference identifier"),
  project: z.string()
    .optional()
    .describe("Project URL or ID to associate with expense"),
  // Recurring expense fields
  recurring: z.enum(["Weekly", "Two Weekly", "Four Weekly", "Two Monthly", "Quarterly", "Biannually", "Annually", "2-Yearly"])
    .optional()
    .describe("Recurring frequency for repeating expenses"),
  next_recurs_on: z.string()
    .regex(/^\d{4}-\d{2}-\d{2}$/)
    .optional()
    .describe("Next recurrence date in YYYY-MM-DD format (for recurring expenses)"),
  recurring_end_date: z.string()
    .regex(/^\d{4}-\d{2}-\d{2}$/)
    .optional()
    .describe("End date for recurring expenses in YYYY-MM-DD format"),
  // Mileage-specific fields
  mileage_vehicle_type: z.enum(["Car", "Motorcycle", "Bicycle"])
    .optional()
    .describe("Vehicle type for mileage expenses (API field: vehicle_type)"),
  miles: z.string()
    .optional()
    .describe("Distance traveled in miles (decimal string) (API field: mileage)"),
  initial_mileage: z.string()
    .optional()
    .describe("Starting odometer reading"),
  mileage_type: z.enum(["Business", "Personal"])
    .optional()
    .describe("Type of mileage"),
  engine_type: z.enum(["Petrol", "Diesel", "LPG", "Electric", "Electric (Home charger)", "Electric (Public charger)"])
    .optional()
    .describe("Engine type for mileage expenses (affects rate calculation)"),
  engine_size: z.string()
    .optional()
    .describe("Engine size (depends on engine_type selection)"),
  reclaim_mileage: z.number()
    .int()
    .min(0)
    .max(1)
    .optional()
    .describe("Mileage reclaim method: 0 = rebill only (default), 1 = AMAP rate")
}).strict();

// Project schemas
export const ListProjectsInputSchema = z.object({
  page: PaginationSchema.shape.page,
  per_page: PaginationSchema.shape.per_page,
  view: z.enum(["active", "completed", "cancelled", "all"])
    .optional()
    .describe("Filter projects by status"),
  contact: z.string().optional().describe("Filter by contact URL or ID"),
  response_format: ResponseFormatSchema
}).strict();

export const GetProjectInputSchema = z.object({
  project_id: z.string()
    .min(1)
    .describe("The FreeAgent project ID (numeric) or full URL"),
  response_format: ResponseFormatSchema
}).strict();

export const CreateProjectInputSchema = z.object({
  contact: z.string()
    .min(1)
    .describe("Contact URL or ID this project is for"),
  name: z.string()
    .min(1)
    .describe("Name of the project"),
  budget: z.string()
    .describe("Budget amount (decimal string)"),
  budget_units: z.enum(["Hours", "Days", "Monetary"])
    .describe("Units for the budget"),
  status: z.enum(["Active", "Completed", "Cancelled", "Hidden"])
    .default("Active")
    .describe("Status of the project"),
  currency: z.string()
    .length(3)
    .default("GBP")
    .describe("Currency code (e.g., GBP, USD, EUR)"),
  uses_project_invoice_sequence: z.boolean()
    .default(false)
    .describe("Use project-specific invoice numbering"),
  is_ir35: z.boolean()
    .default(false)
    .describe("Whether project is subject to IR35"),
  contract_po_reference: z.string()
    .optional()
    .describe("Purchase order reference"),
  starts_on: z.string()
    .regex(/^\d{4}-\d{2}-\d{2}$/)
    .optional()
    .describe("Project start date (YYYY-MM-DD)"),
  ends_on: z.string()
    .regex(/^\d{4}-\d{2}-\d{2}$/)
    .optional()
    .describe("Project end date (YYYY-MM-DD)"),
  normal_billing_rate: z.string()
    .optional()
    .describe("Billing rate (decimal string)"),
  billing_period: z.enum(["hour", "day"])
    .optional()
    .describe("Billing period"),
  hours_per_day: z.string()
    .default("8")
    .describe("Hours per working day (decimal string)"),
  include_unbilled_time_in_profitability: z.boolean()
    .optional()
    .describe("Include unbilled time in profit calculations")
}).strict();

// Task schemas
export const ListTasksInputSchema = z.object({
  page: PaginationSchema.shape.page,
  per_page: PaginationSchema.shape.per_page,
  view: z.enum(["active", "completed", "hidden", "all"])
    .optional()
    .describe("Filter tasks by status"),
  project: z.string()
    .optional()
    .describe("Filter by project URL or ID"),
  updated_since: z.string()
    .regex(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}/)
    .optional()
    .describe("Filter tasks updated since this timestamp (ISO 8601)"),
  sort: z.enum(["name", "project", "billing_rate", "created_at", "updated_at"])
    .optional()
    .describe("Field to sort by"),
  response_format: ResponseFormatSchema
}).strict();

export const GetTaskInputSchema = z.object({
  task_id: z.string()
    .min(1)
    .describe("The FreeAgent task ID (numeric) or full URL"),
  response_format: ResponseFormatSchema
}).strict();

export const CreateTaskInputSchema = z.object({
  project: z.string()
    .min(1)
    .describe("Project URL or ID this task belongs to"),
  name: z.string()
    .min(1)
    .describe("Name of the task"),
  is_billable: z.boolean()
    .default(true)
    .describe("Whether this task is billable"),
  status: z.enum(["Active", "Completed", "Hidden"])
    .default("Active")
    .describe("Status of the task"),
  billing_rate: z.string()
    .optional()
    .describe("Billing rate (decimal string)"),
  billing_period: z.enum(["hour", "day"])
    .optional()
    .describe("Billing period (hour or day)")
}).strict();

// Category schemas
export const ListCategoriesInputSchema = z.object({
  view: z.enum(["all", "standard", "custom"])
    .optional()
    .describe("Filter categories by type (all, standard system categories, or custom user-created)"),
  response_format: ResponseFormatSchema
}).strict();

export const GetCategoryInputSchema = z.object({
  nominal_code: z.string()
    .min(1)
    .describe("The FreeAgent category nominal code or full URL"),
  response_format: ResponseFormatSchema
}).strict();

// Bank account schemas
export const ListBankAccountsInputSchema = z.object({
  response_format: ResponseFormatSchema
}).strict();

export const GetBankAccountInputSchema = z.object({
  bank_account_id: z.string()
    .min(1)
    .describe("The FreeAgent bank account ID (numeric) or full URL"),
  response_format: ResponseFormatSchema
}).strict();

// Bank transaction schemas
export const ListBankTransactionsInputSchema = z.object({
  bank_account: z.string()
    .min(1)
    .describe("Bank account URL or ID to list transactions for"),
  page: PaginationSchema.shape.page,
  per_page: PaginationSchema.shape.per_page,
  from_date: z.string()
    .regex(/^\d{4}-\d{2}-\d{2}$/)
    .optional()
    .describe("Filter transactions from this date (YYYY-MM-DD)"),
  to_date: z.string()
    .regex(/^\d{4}-\d{2}-\d{2}$/)
    .optional()
    .describe("Filter transactions to this date (YYYY-MM-DD)"),
  view: z.enum(["all", "unexplained"])
    .optional()
    .describe("Filter transactions by view"),
  response_format: ResponseFormatSchema
}).strict();

export const GetBankTransactionInputSchema = z.object({
  bank_transaction_id: z.string()
    .min(1)
    .describe("The FreeAgent bank transaction ID (numeric) or full URL"),
  response_format: ResponseFormatSchema
}).strict();

// Timeslip schemas
export const ListTimeslipsInputSchema = z.object({
  page: PaginationSchema.shape.page,
  per_page: PaginationSchema.shape.per_page,
  from_date: z.string()
    .regex(/^\d{4}-\d{2}-\d{2}$/)
    .optional()
    .describe("Filter timeslips from this date (YYYY-MM-DD)"),
  to_date: z.string()
    .regex(/^\d{4}-\d{2}-\d{2}$/)
    .optional()
    .describe("Filter timeslips to this date (YYYY-MM-DD)"),
  view: z.enum(["all", "unbilled", "running"])
    .optional()
    .describe("Filter timeslips by view"),
  user: z.string()
    .optional()
    .describe("Filter by user URL or ID"),
  project: z.string()
    .optional()
    .describe("Filter by project URL or ID"),
  response_format: ResponseFormatSchema
}).strict();

export const GetTimeslipInputSchema = z.object({
  timeslip_id: z.string()
    .min(1)
    .describe("The FreeAgent timeslip ID (numeric) or full URL"),
  response_format: ResponseFormatSchema
}).strict();

export const CreateTimeslipInputSchema = z.object({
  task: z.string()
    .min(1)
    .describe("Task URL or ID"),
  user: z.string()
    .min(1)
    .describe("User URL or ID who performed the work"),
  project: z.string()
    .min(1)
    .describe("Project URL or ID"),
  dated_on: z.string()
    .regex(/^\d{4}-\d{2}-\d{2}$/)
    .describe("Date of work in YYYY-MM-DD format"),
  hours: z.string()
    .describe("Hours worked (decimal string, e.g., '7.5')"),
  comment: z.string()
    .optional()
    .describe("Description or comment about the work performed")
}).strict();

// Bank transaction explanation schemas
export const ListBankTransactionExplanationsInputSchema = z.object({
  bank_account: z.string()
    .optional()
    .describe("Filter by bank account URL or ID"),
  from_date: z.string()
    .regex(/^\d{4}-\d{2}-\d{2}$/)
    .optional()
    .describe("Filter explanations from this date (YYYY-MM-DD)"),
  to_date: z.string()
    .regex(/^\d{4}-\d{2}-\d{2}$/)
    .optional()
    .describe("Filter explanations to this date (YYYY-MM-DD)"),
  page: PaginationSchema.shape.page,
  per_page: PaginationSchema.shape.per_page,
  response_format: ResponseFormatSchema
}).strict();

export const GetBankTransactionExplanationInputSchema = z.object({
  bank_transaction_explanation_id: z.string()
    .min(1)
    .describe("The FreeAgent bank transaction explanation ID (numeric) or full URL"),
  response_format: ResponseFormatSchema
}).strict();

// Nested depreciation profile for capital asset purchases explained through a
// bank transaction. FreeAgent has no standalone depreciation profile endpoint;
// the profile rides on the explanation (or bill/expense) that creates the asset.
export const DepreciationProfileSchema = z.object({
  method: z.enum(["straight_line", "reducing_balance", "no_depreciation"])
    .describe("Depreciation method. straight_line needs asset_life_years; reducing_balance needs annual_depreciation_percentage."),
  asset_life_years: z.number().int().min(2).max(25).optional()
    .describe("Years until the asset is fully depreciated (straight_line only, 2-25)."),
  annual_depreciation_percentage: z.number().int().min(1).max(99).optional()
    .describe("Annual reduction percentage (reducing_balance only, 1-99)."),
  frequency: z.enum(["monthly", "annually"]).optional()
    .describe("Posting frequency for depreciation journals (default monthly).")
}).strict();

export const CreateBankTransactionExplanationInputSchema = z.object({
  bank_transaction: z.string()
    .min(1)
    .describe("Bank transaction URL or ID to explain"),
  dated_on: z.string()
    .regex(/^\d{4}-\d{2}-\d{2}$/)
    .describe("Transaction date in YYYY-MM-DD format"),
  description: z.string()
    .optional()
    .describe("Description of the transaction"),
  gross_value: z.string()
    .describe("Transaction amount (decimal string, negative for debits)"),
  category: z.string()
    .optional()
    .describe("Category URL or ID for the transaction"),
  ec_status: z.enum(["UK/Non-EC", "EC Goods", "EC Services", "Reverse Charge", "EC VAT MOSS"])
    .optional()
    .describe("EC (European Community) status for the transaction (Note: EC Goods and EC Services invalid for transactions dated 2021-01-01+ in Great Britain)"),
  marked_for_review: z.boolean()
    .optional()
    .describe("Whether the explanation is marked for review (true if guessed/awaiting approval, false otherwise)"),
  receipt_reference: z.string()
    .optional()
    .describe("Reference identifier for the receipt or transaction"),
  // Link to other entities
  paid_invoice: z.string()
    .optional()
    .describe("Invoice URL or ID that this transaction pays"),
  paid_bill: z.string()
    .optional()
    .describe("Bill URL or ID that this transaction pays"),
  paid_user: z.string()
    .optional()
    .describe("User URL or ID for money paid to/from user"),
  project: z.string()
    .optional()
    .describe("Project URL or ID to associate with transaction"),
  // Tax information
  sales_tax_rate: z.string()
    .optional()
    .describe("Sales tax rate as decimal (e.g., '0.20' for 20%)"),
  sales_tax_value: z.string()
    .optional()
    .describe("Sales tax amount"),
  sales_tax_status: z.enum(["TAXABLE", "EXEMPT", "OUT_OF_SCOPE"])
    .optional()
    .describe("VAT treatment of the amount. TAXABLE (default) applies the rate; EXEMPT = VAT-exempt supply; OUT_OF_SCOPE = outside the scope of VAT entirely (e.g. Patreon and Google AdSense income). Distinct from a 0% rate."),
  // Transfer information
  transfer_bank_account: z.string()
    .optional()
    .describe("Destination bank account URL or ID for transfers"),
  // Capital asset depreciation (when the category is a capital asset category, e.g. 602-1)
  depreciation_profile: DepreciationProfileSchema
    .optional()
    .describe("Depreciation profile when this explanation creates a capital asset (category must be a capital asset sub-category like '602-1')."),
  // Attachment
  attachment: AttachmentSchema
    .optional()
    .describe("Optional file attachment for the explanation")
}).strict();

export const UpdateBankTransactionExplanationInputSchema = z.object({
  bank_transaction_explanation_id: z.string()
    .min(1)
    .describe("The FreeAgent bank transaction explanation ID (numeric) or full URL"),
  dated_on: z.string()
    .regex(/^\d{4}-\d{2}-\d{2}$/)
    .optional()
    .describe("Transaction date in YYYY-MM-DD format"),
  description: z.string()
    .optional()
    .describe("Description of the transaction"),
  gross_value: z.string()
    .optional()
    .describe("Transaction amount (decimal string, negative for debits)"),
  category: z.string()
    .optional()
    .describe("Category URL or ID for the transaction"),
  ec_status: z.enum(["UK/Non-EC", "EC Goods", "EC Services", "Reverse Charge", "EC VAT MOSS"])
    .optional()
    .describe("EC (European Community) status for the transaction (Note: EC Goods and EC Services invalid for transactions dated 2021-01-01+ in Great Britain)"),
  marked_for_review: z.boolean()
    .optional()
    .describe("Whether the explanation is marked for review (true if guessed/awaiting approval, false otherwise)"),
  receipt_reference: z.string()
    .optional()
    .describe("Reference identifier for the receipt or transaction"),
  // Link to other entities
  paid_invoice: z.string()
    .optional()
    .describe("Invoice URL or ID that this transaction pays"),
  paid_bill: z.string()
    .optional()
    .describe("Bill URL or ID that this transaction pays"),
  paid_user: z.string()
    .optional()
    .describe("User URL or ID for money paid to/from user"),
  project: z.string()
    .optional()
    .describe("Project URL or ID to associate with transaction"),
  // Tax information
  sales_tax_rate: z.string()
    .optional()
    .describe("Sales tax rate as decimal (e.g., '0.20' for 20%)"),
  sales_tax_value: z.string()
    .optional()
    .describe("Sales tax amount"),
  sales_tax_status: z.enum(["TAXABLE", "EXEMPT", "OUT_OF_SCOPE"])
    .optional()
    .describe("VAT treatment of the amount. TAXABLE (default) applies the rate; EXEMPT = VAT-exempt supply; OUT_OF_SCOPE = outside the scope of VAT entirely (e.g. Patreon and Google AdSense income). Distinct from a 0% rate."),
  // Transfer information
  transfer_bank_account: z.string()
    .optional()
    .describe("Destination bank account URL or ID for transfers"),
  // Capital asset depreciation
  depreciation_profile: DepreciationProfileSchema
    .optional()
    .describe("Depreciation profile when this explanation creates/updates a capital asset (category must be a capital asset sub-category like '602-1'). Assets created with a depreciation_profile can only be updated with one.")
}).strict();

export const UpdateTimeslipInputSchema = z.object({
  timeslip_id: z.string()
    .min(1)
    .describe("The FreeAgent timeslip ID (numeric) or full URL."),
  dated_on: z.string()
    .regex(/^\d{4}-\d{2}-\d{2}$/)
    .optional()
    .describe("Updated date of work in YYYY-MM-DD format."),
  hours: z.string()
    .optional()
    .describe("Updated hours worked (decimal string, e.g., '7.5')."),
  comment: z.string()
    .optional()
    .describe("Updated description or comment about the work performed."),
  task: z.string()
    .optional()
    .describe("Updated task URL or ID."),
  project: z.string()
    .optional()
    .describe("Updated project URL or ID."),
  billed_on_invoice: z.string()
    .optional()
    .describe("Link this timeslip to an invoice URL. Note: FreeAgent may reject writes to this field outside of its native 'invoice from timeslips' flow; the tool surfaces any rejection clearly.")
}).strict();

// Bill schemas
export const ListBillsInputSchema = z.object({
  page: PaginationSchema.shape.page,
  per_page: PaginationSchema.shape.per_page,
  view: z.enum(["recent", "open", "overdue", "paid", "all"])
    .optional()
    .describe("Filter bills by status view."),
  contact: z.string().optional().describe("Filter by contact (supplier) URL or ID."),
  from_date: z.string()
    .regex(/^\d{4}-\d{2}-\d{2}$/)
    .optional()
    .describe("Filter bills dated on or after this date (YYYY-MM-DD)."),
  to_date: z.string()
    .regex(/^\d{4}-\d{2}-\d{2}$/)
    .optional()
    .describe("Filter bills dated on or before this date (YYYY-MM-DD)."),
  sort: z.enum(["created_at", "updated_at", "dated_on", "due_on"])
    .optional()
    .describe("Field to sort by (prefix with '-' for descending)."),
  response_format: ResponseFormatSchema
}).strict();

export const GetBillInputSchema = z.object({
  bill_id: z.string()
    .min(1)
    .describe("The FreeAgent bill ID (numeric) or full URL."),
  response_format: ResponseFormatSchema
}).strict();

export const CreateBillInputSchema = z.object({
  contact: z.string()
    .min(1)
    .describe("Supplier contact URL or ID."),
  dated_on: z.string()
    .regex(/^\d{4}-\d{2}-\d{2}$/)
    .describe("Bill date in YYYY-MM-DD format."),
  due_on: z.string()
    .regex(/^\d{4}-\d{2}-\d{2}$/)
    .optional()
    .describe("Due date in YYYY-MM-DD format."),
  reference: z.string()
    .optional()
    .describe("Bill reference number (e.g. supplier's invoice number)."),
  currency: z.string()
    .length(3)
    .optional()
    .describe("Currency code (e.g. 'GBP', 'USD'). Defaults to the company's currency."),
  comments: z.string().optional().describe("Internal comments for the bill."),
  payment_terms_in_days: z.number().int().optional().describe("Payment terms in days."),
  ec_status: z.enum(["UK/Non-EC", "EC Goods", "EC Services", "Reverse Charge"])
    .optional()
    .describe("EC status. Defaults to 'UK/Non-EC'."),
  bill_items: z.array(z.object({
    category: z.string().describe("Category URL or nominal code for this line."),
    description: z.string().optional().describe("Line description."),
    price: z.string().describe("Unit price as decimal string."),
    quantity: z.string().describe("Quantity as decimal string."),
    sales_tax_rate: z.string().optional().describe("Sales tax rate as decimal (e.g. '0.20' for 20%).")
  })).min(1).describe("Array of bill line items.")
}).strict();

// Estimate schemas
export const ListEstimatesInputSchema = z.object({
  page: PaginationSchema.shape.page,
  per_page: PaginationSchema.shape.per_page,
  view: z.enum(["all", "draft", "sent", "approved", "rejected", "cancelled", "invoiced"])
    .optional()
    .describe("Filter estimates by status."),
  contact: z.string().optional().describe("Filter by contact URL or ID."),
  project: z.string().optional().describe("Filter by project URL or ID."),
  sort: z.enum(["created_at", "updated_at", "dated_on"])
    .optional()
    .describe("Field to sort by (prefix with '-' for descending)."),
  response_format: ResponseFormatSchema
}).strict();

export const GetEstimateInputSchema = z.object({
  estimate_id: z.string()
    .min(1)
    .describe("The FreeAgent estimate ID (numeric) or full URL."),
  response_format: ResponseFormatSchema
}).strict();

export const CreateEstimateInputSchema = z.object({
  contact: z.string()
    .min(1)
    .describe("Contact URL or ID to estimate for."),
  dated_on: z.string()
    .regex(/^\d{4}-\d{2}-\d{2}$/)
    .describe("Estimate date in YYYY-MM-DD format."),
  expires_on: z.string()
    .regex(/^\d{4}-\d{2}-\d{2}$/)
    .optional()
    .describe("Expiry date in YYYY-MM-DD format."),
  reference: z.string().optional().describe("Estimate reference (e.g. 'EST-001')."),
  currency: z.string()
    .length(3)
    .default("GBP")
    .describe("Currency code (e.g. 'GBP', 'USD')."),
  comments: z.string().optional().describe("Comments shown on the estimate."),
  terms_and_conditions: z.string().optional().describe("Terms & conditions text."),
  payment_terms_in_days: z.number().int().optional().describe("Payment terms in days."),
  discount_percent: z.string()
    .optional()
    .describe("Discount to apply, as a decimal string (e.g., '20' for 20%)."),
  ec_status: z.enum(["UK/Non-EC", "EC Goods", "EC Services", "Reverse Charge"])
    .optional()
    .describe("EC status. Defaults to 'UK/Non-EC'."),
  estimate_items: z.array(z.object({
    item_type: z.string().describe("Item type (e.g. 'Hours', 'Days', 'Products')."),
    description: z.string().describe("Item description."),
    price: z.string().describe("Price per unit."),
    quantity: z.string().describe("Quantity."),
    sales_tax_rate: z.string().optional().describe("Sales tax rate (e.g. '0.20' for 20%).")
  })).min(1).describe("Array of estimate line items.")
}).strict();

export const TransitionEstimateInputSchema = z.object({
  estimate_id: z.string()
    .min(1)
    .describe("The FreeAgent estimate ID (numeric) or full URL."),
  action: z.enum([
    "mark_as_sent",
    "mark_as_approved",
    "mark_as_rejected",
    "mark_as_cancelled",
    "mark_as_draft",
    "convert_to_invoice"
  ])
    .describe("Transition to apply. 'mark_as_sent' Draft→Sent, 'mark_as_approved' after client accepts, 'mark_as_rejected'/'mark_as_cancelled' close the estimate, 'mark_as_draft' rolls back, 'convert_to_invoice' creates an invoice from the approved estimate.")
}).strict();

// Recurring invoice schemas (read-only)
export const ListRecurringInvoicesInputSchema = z.object({
  page: PaginationSchema.shape.page,
  per_page: PaginationSchema.shape.per_page,
  view: z.enum(["all", "active", "cancelled"])
    .optional()
    .describe("Filter recurring invoices by status."),
  contact: z.string().optional().describe("Filter by contact URL or ID."),
  response_format: ResponseFormatSchema
}).strict();

export const GetRecurringInvoiceInputSchema = z.object({
  recurring_invoice_id: z.string()
    .min(1)
    .describe("The FreeAgent recurring invoice ID (numeric) or full URL."),
  response_format: ResponseFormatSchema
}).strict();

// Price list item schemas
export const ListPriceListItemsInputSchema = z.object({
  page: PaginationSchema.shape.page,
  per_page: PaginationSchema.shape.per_page,
  response_format: ResponseFormatSchema
}).strict();

export const GetPriceListItemInputSchema = z.object({
  price_list_item_id: z.string()
    .min(1)
    .describe("The FreeAgent price list item ID (numeric) or full URL."),
  response_format: ResponseFormatSchema
}).strict();

export const CreatePriceListItemInputSchema = z.object({
  description: z.string().min(1).describe("Item description (shown on invoices)."),
  price: z.string().describe("Unit price as decimal string."),
  item_type: z.string().default("Products").describe("Item type (e.g. 'Products', 'Hours', 'Days')."),
  sales_tax_rate: z.string().optional().describe("Sales tax rate as decimal (e.g. '0.20' for 20%)."),
  category: z.string().optional().describe("Category URL or nominal code.")
}).strict();

// Transition a FreeAgent invoice between lifecycle states.
export const TransitionInvoiceInputSchema = z.object({
  invoice_id: z.string()
    .min(1)
    .describe("The FreeAgent invoice ID (numeric) or full URL."),
  action: z.enum([
    "mark_as_sent",
    "mark_as_cancelled",
    "mark_as_draft",
    "mark_as_scheduled",
    "convert_to_credit_note"
  ])
    .describe("Transition to apply. 'mark_as_sent' moves Draft → Sent (and re-opens a cancelled invoice), 'mark_as_cancelled' WRITES OFF a sent invoice as unpaid (requires confirm: true), 'mark_as_draft' rolls back to Draft, 'mark_as_scheduled' queues a future send, 'convert_to_credit_note' creates a credit note against the invoice."),
  confirm: z.boolean()
    .optional()
    .describe("Required (true) for mark_as_cancelled, which WRITES OFF the invoice as unpaid. Confirm with the user first. Ignored for other actions."),
}).strict();

// Intent-bundle: draft an invoice from a contact's unbilled timeslips.
export const InvoiceFromTimeslipsInputSchema = z.object({
  contact: z.string()
    .min(1)
    .describe("Contact to invoice. Accepts a contact name, numeric ID, or URL."),
  project: z.string()
    .optional()
    .describe("Optional: limit to a single project (URL or ID). Omit to invoice across all of the contact's active projects."),
  from_date: z.string()
    .regex(/^\d{4}-\d{2}-\d{2}$/)
    .optional()
    .describe("Include timeslips dated on or after this date (YYYY-MM-DD). Defaults to the first day of the previous month."),
  to_date: z.string()
    .regex(/^\d{4}-\d{2}-\d{2}$/)
    .optional()
    .describe("Include timeslips dated on or before this date (YYYY-MM-DD). Defaults to today."),
  dated_on: z.string()
    .regex(/^\d{4}-\d{2}-\d{2}$/)
    .optional()
    .describe("Invoice date (YYYY-MM-DD). Defaults to today."),
  due_on: z.string()
    .regex(/^\d{4}-\d{2}-\d{2}$/)
    .optional()
    .describe("Invoice due date (YYYY-MM-DD)."),
  reference: z.string()
    .optional()
    .describe("Invoice reference number."),
  currency: z.string()
    .length(3)
    .optional()
    .describe("Currency code (e.g. 'GBP', 'USD'). Defaults to GBP."),
  payment_terms_in_days: z.number()
    .int()
    .optional()
    .describe("Payment terms in days."),
  discount_percent: z.string()
    .optional()
    .describe("Discount to apply to the drafted invoice, as a decimal string (e.g., '20' for 20%)."),
  link_timeslips: z.boolean()
    .default(false)
    .describe("If true, attempt to link the source timeslips to the new invoice by setting `billed_on_invoice` on each. FreeAgent sometimes rejects these writes — any failures are surfaced in the response.")
}).strict();

// Intent-bundle: log a regular expense with human-friendly inputs.
export const LogExpenseInputSchema = z.object({
  amount: z.string()
    .regex(/^\d+(\.\d{1,2})?$/, "Amount must be a positive decimal like '12.50'")
    .describe("Expense amount as a POSITIVE decimal in the major currency unit (e.g. '12.50'). The tool applies the correct sign for you — never pass a negative value."),
  kind: z.enum(["expense", "refund"])
    .default("expense")
    .describe("'expense' (default) = money out of pocket. 'refund' = money coming back to the claimant."),
  category: z.string()
    .min(1)
    .describe("Category name (e.g. 'Travel'), nominal code (e.g. '285'), or full URL. Resolved server-side."),
  description: z.string()
    .optional()
    .describe("Free-text description of the expense."),
  dated_on: z.string()
    .regex(/^\d{4}-\d{2}-\d{2}$/)
    .optional()
    .describe("Date of expense in YYYY-MM-DD format. Defaults to today."),
  user: z.string()
    .optional()
    .describe("User who incurred the expense. Accepts email, numeric ID, or URL. Defaults to the sole user on the account when there is exactly one."),
  currency: z.string()
    .length(3)
    .optional()
    .describe("Currency code (e.g. 'GBP', 'USD'). Defaults to the company's currency."),
  sales_tax_rate: z.string()
    .optional()
    .describe("Sales tax rate as decimal (e.g. '0.20' for 20%)."),
  ec_status: z.enum(["UK/Non-EC", "EC Goods", "EC Services", "Reverse Charge"])
    .optional()
    .describe("EC status. Defaults to 'UK/Non-EC'."),
  receipt_reference: z.string()
    .optional()
    .describe("Receipt reference identifier."),
  project: z.string()
    .optional()
    .describe("Project URL or ID to associate with the expense.")
}).strict();

// Intent-bundle: reconcile a bank transaction in one call.
export const ReconcileBankTransactionInputSchema = z.object({
  bank_transaction_id: z.string()
    .min(1)
    .describe("The FreeAgent bank transaction ID (numeric) or full URL to reconcile."),
  category: z.string()
    .optional()
    .describe("Category to post this transaction against. Accepts a category name (e.g. 'Travel'), nominal code (e.g. '285'), or full URL. Mutually exclusive with paid_invoice."),
  paid_invoice: z.string()
    .optional()
    .describe("Invoice this transaction pays. Accepts an invoice reference (e.g. 'INV-001'), numeric ID, or full URL. Mutually exclusive with category and paid_bill."),
  paid_bill: z.string()
    .optional()
    .describe("Supplier bill this transaction pays. Accepts a bill reference, numeric ID, or full URL. Mutually exclusive with category and paid_invoice."),
  description: z.string()
    .optional()
    .describe("Free-text description for the explanation."),
  marked_for_review: z.boolean()
    .optional()
    .describe("Set true to flag the explanation for human review (e.g. when the match is a guess)."),
  sales_tax_status: z.enum(["TAXABLE", "EXEMPT", "OUT_OF_SCOPE"])
    .optional()
    .describe("VAT treatment. OUT_OF_SCOPE for income outside the scope of VAT (e.g. Patreon, Google AdSense). Distinct from a 0% rate."),
  receipt_reference: z.string()
    .optional()
    .describe("Receipt or transaction reference identifier.")
}).strict();

// Company schema
export const GetCompanyInputSchema = z.object({
  response_format: ResponseFormatSchema
}).strict();

// User schemas
export const ListUsersInputSchema = z.object({
  response_format: ResponseFormatSchema
}).strict();

// Type exports
export type ListContactsInput = z.infer<typeof ListContactsInputSchema>;
export type GetContactInput = z.infer<typeof GetContactInputSchema>;
export type CreateContactInput = z.infer<typeof CreateContactInputSchema>;
export type ListInvoicesInput = z.infer<typeof ListInvoicesInputSchema>;
export type GetInvoiceInput = z.infer<typeof GetInvoiceInputSchema>;
export type CreateInvoiceInput = z.infer<typeof CreateInvoiceInputSchema>;
export type ListExpensesInput = z.infer<typeof ListExpensesInputSchema>;
export type GetExpenseInput = z.infer<typeof GetExpenseInputSchema>;
export type CreateExpenseInput = z.infer<typeof CreateExpenseInputSchema>;
export type UpdateExpenseInput = z.infer<typeof UpdateExpenseInputSchema>;
export type ListProjectsInput = z.infer<typeof ListProjectsInputSchema>;
export type GetProjectInput = z.infer<typeof GetProjectInputSchema>;
export type CreateProjectInput = z.infer<typeof CreateProjectInputSchema>;
export type ListTasksInput = z.infer<typeof ListTasksInputSchema>;
export type GetTaskInput = z.infer<typeof GetTaskInputSchema>;
export type CreateTaskInput = z.infer<typeof CreateTaskInputSchema>;
export type ListCategoriesInput = z.infer<typeof ListCategoriesInputSchema>;
export type GetCategoryInput = z.infer<typeof GetCategoryInputSchema>;
export type ListBankAccountsInput = z.infer<typeof ListBankAccountsInputSchema>;
export type GetBankAccountInput = z.infer<typeof GetBankAccountInputSchema>;
export type ListBankTransactionsInput = z.infer<typeof ListBankTransactionsInputSchema>;
export type GetBankTransactionInput = z.infer<typeof GetBankTransactionInputSchema>;
export type ListTimeslipsInput = z.infer<typeof ListTimeslipsInputSchema>;
export type GetTimeslipInput = z.infer<typeof GetTimeslipInputSchema>;
export type CreateTimeslipInput = z.infer<typeof CreateTimeslipInputSchema>;
export type UpdateTimeslipInput = z.infer<typeof UpdateTimeslipInputSchema>;
export type ListBankTransactionExplanationsInput = z.infer<typeof ListBankTransactionExplanationsInputSchema>;
export type GetBankTransactionExplanationInput = z.infer<typeof GetBankTransactionExplanationInputSchema>;
export type CreateBankTransactionExplanationInput = z.infer<typeof CreateBankTransactionExplanationInputSchema>;
export type UpdateBankTransactionExplanationInput = z.infer<typeof UpdateBankTransactionExplanationInputSchema>;
export type GetCompanyInput = z.infer<typeof GetCompanyInputSchema>;
export type ListUsersInput = z.infer<typeof ListUsersInputSchema>;
export type ReconcileBankTransactionInput = z.infer<typeof ReconcileBankTransactionInputSchema>;
export type LogExpenseInput = z.infer<typeof LogExpenseInputSchema>;
export type InvoiceFromTimeslipsInput = z.infer<typeof InvoiceFromTimeslipsInputSchema>;
export type TransitionInvoiceInput = z.infer<typeof TransitionInvoiceInputSchema>;
export type ListBillsInput = z.infer<typeof ListBillsInputSchema>;
export type GetBillInput = z.infer<typeof GetBillInputSchema>;
export type CreateBillInput = z.infer<typeof CreateBillInputSchema>;
export type ListEstimatesInput = z.infer<typeof ListEstimatesInputSchema>;
export type GetEstimateInput = z.infer<typeof GetEstimateInputSchema>;
export type CreateEstimateInput = z.infer<typeof CreateEstimateInputSchema>;
export type TransitionEstimateInput = z.infer<typeof TransitionEstimateInputSchema>;
export type ListRecurringInvoicesInput = z.infer<typeof ListRecurringInvoicesInputSchema>;
export type GetRecurringInvoiceInput = z.infer<typeof GetRecurringInvoiceInputSchema>;
export type ListPriceListItemsInput = z.infer<typeof ListPriceListItemsInputSchema>;
export type GetPriceListItemInput = z.infer<typeof GetPriceListItemInputSchema>;
export type CreatePriceListItemInput = z.infer<typeof CreatePriceListItemInputSchema>;
export type SearchToolsInput = z.infer<typeof SearchToolsInputSchema>;
export type CallToolInput = z.infer<typeof CallToolInputSchema>;

// ---------------------------------------------------------------------------
// Journal sets (added in freeagent-mcp-kittens fork)
// ---------------------------------------------------------------------------

export const JournalEntryInputSchema = z.object({
  category: z.string()
    .min(1)
    .describe("Accounting category for the entry. Accepts a category name (e.g. 'Corporation Tax'), nominal code (e.g. '625'), or full URL."),
  debit_value: z.number()
    .describe("Entry value. Positive = debit, negative = credit. All entries in a set must sum to zero."),
  description: z.string().optional()
    .describe("Free-text description for this entry."),
  user: z.string().optional()
    .describe("Required for user categories (salary, dividends, etc). Accepts a user name, email, numeric ID, or full URL.")
}).strict();

export const ListJournalSetsInputSchema = z.object({
  from_date: z.string().optional().describe("Filter sets dated on or after this date (YYYY-MM-DD)."),
  to_date: z.string().optional().describe("Filter sets dated on or before this date (YYYY-MM-DD)."),
  tag: z.string().optional().describe("Filter by application tag."),
  response_format: ResponseFormatSchema
}).strict();

export const GetJournalSetInputSchema = z.object({
  journal_set_id: z.string().min(1).describe("Journal set numeric ID or full URL."),
  response_format: ResponseFormatSchema
}).strict();

export const CreateJournalSetInputSchema = z.object({
  dated_on: z.string()
    .regex(/^\d{4}-\d{2}-\d{2}$/)
    .describe("Date the journal entries take effect (YYYY-MM-DD)."),
  description: z.string().min(1)
    .describe("Description of the journal set (e.g. 'FY24-25 Corporation Tax zeroing - IoM 0% rate')."),
  journal_entries: z.array(JournalEntryInputSchema)
    .min(2)
    .describe("The entries making up the set. Must balance: debit values must sum to zero."),
  tag: z.string().optional()
    .describe("CAUTION: tagged journal sets become UNEDITABLE in the FreeAgent web UI (API-only). Leave unset unless that is deliberate.")
}).strict().refine(
  (v) => Math.abs(v.journal_entries.reduce((s, e) => s + e.debit_value, 0)) < 0.005,
  { message: "Journal set does not balance: debit values must sum to zero (debits positive, credits negative)." }
);

export const UpdateJournalEntrySchema = z.object({
  url: z.string().optional()
    .describe("URL of an existing entry to modify or remove. Omit to add a new entry."),
  _destroy: z.boolean().optional()
    .describe("Set true (with url) to remove that entry from the set."),
  category: z.string().optional()
    .describe("Category name, nominal code, or URL (for new or modified entries)."),
  debit_value: z.number().optional()
    .describe("Entry value. Positive = debit, negative = credit."),
  description: z.string().optional(),
  user: z.string().optional()
    .describe("User name, email, ID, or URL for user categories.")
}).strict();

export const UpdateJournalSetInputSchema = z.object({
  journal_set_id: z.string().min(1).describe("Journal set numeric ID or full URL."),
  confirm: z.literal(true)
    .describe("Must be exactly true. Acknowledges this overwrites existing accounting data."),
  dated_on: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
  description: z.string().optional(),
  journal_entries: z.array(UpdateJournalEntrySchema).optional()
    .describe("Entries to add (no url), modify (url + fields), or remove (url + _destroy). The resulting set must still balance; FreeAgent rejects unbalanced sets.")
}).strict();

export const DeleteJournalSetInputSchema = z.object({
  journal_set_id: z.string().min(1).describe("Journal set numeric ID or full URL."),
  confirm: z.literal(true)
    .describe("Must be exactly true. Acknowledges this permanently deletes the journal set and all its entries.")
}).strict();

// ---------------------------------------------------------------------------
// Bank statement upload + explanation delete (fork additions)
// ---------------------------------------------------------------------------

export const StatementTransactionSchema = z.object({
  dated_on: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).describe("Transaction date (YYYY-MM-DD)."),
  amount: z.number().describe("Amount in the company's native currency. Negative = money out."),
  description: z.string().min(1).describe("Transaction description as it should appear in FreeAgent."),
  fitid: z.string().optional().describe("Unique transaction ID (FITID). Strongly recommended to prevent false de-duplication."),
  transaction_type: z.enum(["CREDIT","DEBIT","INT","DIV","FEE","SRVCHG","DEP","ATM","POS","XFER","CHECK","PAYMENT","CASH","DIRECTDEP","DIRECTDEBIT","REPEATPMT","OTHER"]).optional()
    .describe("OFX transaction type. Note some types force the sign (e.g. XFER always negative). Default OTHER (sign taken from amount).")
}).strict();

export const UploadBankStatementInputSchema = z.object({
  bank_account: z.string().min(1)
    .describe("Bank account numeric ID or full URL to upload into."),
  confirm: z.literal(true)
    .describe("Must be exactly true. Acknowledges this adds real transactions to the live bank account."),
  transactions: z.array(StatementTransactionSchema).min(1)
    .describe("Transactions to add. WARNING: FreeAgent de-duplicates against existing transactions with the same date+amount+description, silently dropping matches. To deliberately add a same-day twin, vary the description or supply a unique fitid. The tool verifies what actually imported and reports any dropped rows.")
}).strict();

export const DeleteBankTransactionExplanationInputSchema = z.object({
  bank_transaction_explanation_id: z.string().min(1)
    .describe("Explanation numeric ID or full URL to delete. The underlying bank transaction is NOT deleted; it returns to unexplained."),
  confirm: z.literal(true)
    .describe("Must be exactly true. Acknowledges this permanently deletes the explanation (unlinking any transfer pairing).")
}).strict();

export type ListJournalSetsInput = z.infer<typeof ListJournalSetsInputSchema>;
export type GetJournalSetInput = z.infer<typeof GetJournalSetInputSchema>;
export type CreateJournalSetInput = z.infer<typeof CreateJournalSetInputSchema>;
export type UpdateJournalSetInput = z.infer<typeof UpdateJournalSetInputSchema>;
export type DeleteJournalSetInput = z.infer<typeof DeleteJournalSetInputSchema>;
export type UploadBankStatementInput = z.infer<typeof UploadBankStatementInputSchema>;
export type DeleteBankTransactionExplanationInput = z.infer<typeof DeleteBankTransactionExplanationInputSchema>;

// ---------------------------------------------------------------------------
// Credit notes (fork addition: read access to the other half of invoicing)
// ---------------------------------------------------------------------------

export const ListCreditNotesInputSchema = z.object({
  page: PaginationSchema.shape.page,
  per_page: PaginationSchema.shape.per_page,
  view: z.enum(["all", "recent_open_or_overdue", "open", "overdue", "open_or_overdue", "draft", "refunded"])
    .optional()
    .describe("Filter credit notes by status view"),
  contact: z.string().optional().describe("Filter by contact URL or ID"),
  project: z.string().optional().describe("Filter by project URL or ID"),
  sort: z.enum(["created_at", "updated_at"])
    .optional()
    .describe("Field to sort by (prefix with '-' for descending)"),
  nested_credit_note_items: z.boolean()
    .default(false)
    .describe("Include full line items for each credit note in the listing (heavier response)"),
  response_format: ResponseFormatSchema
}).strict();

export const GetCreditNoteInputSchema = z.object({
  credit_note_id: z.string()
    .min(1)
    .describe("The FreeAgent credit note ID (numeric) or full URL"),
  response_format: ResponseFormatSchema
}).strict();

// ---------------------------------------------------------------------------
// Capital assets (fork addition; read-only in the FreeAgent API)
// ---------------------------------------------------------------------------

export const ListCapitalAssetsInputSchema = z.object({
  page: PaginationSchema.shape.page,
  per_page: PaginationSchema.shape.per_page,
  view: z.enum(["all", "disposed", "disposable"])
    .optional()
    .describe("Filter assets: all, already disposed, or currently disposable"),
  include_history: z.boolean()
    .default(false)
    .describe("Include each asset's lifecycle events (purchase, depreciation, allowances, disposal)"),
  response_format: ResponseFormatSchema
}).strict();

export const GetCapitalAssetInputSchema = z.object({
  capital_asset_id: z.string()
    .min(1)
    .describe("The FreeAgent capital asset ID (numeric) or full URL"),
  include_history: z.boolean()
    .default(true)
    .describe("Include the asset's lifecycle events (purchase, depreciation, allowances, disposal)"),
  response_format: ResponseFormatSchema
}).strict();

export const ListCapitalAssetTypesInputSchema = z.object({
  response_format: ResponseFormatSchema
}).strict();

// ---------------------------------------------------------------------------
// Accounting reports (fork addition: P&L, balance sheet, trial balance, cashflow)
// ---------------------------------------------------------------------------

export const GetProfitAndLossInputSchema = z.object({
  from_date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional()
    .describe("Period start (YYYY-MM-DD). Defaults to the current accounting year start."),
  to_date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional()
    .describe("Period end (YYYY-MM-DD). Defaults to today. Range must fit within one accounting year."),
  accounting_period: z.string().regex(/^\d{4}\/\d{2}$/).optional()
    .describe("Alternative to from_date/to_date: a whole accounting year, e.g. '2025/26'."),
  response_format: ResponseFormatSchema
}).strict();

export const GetBalanceSheetInputSchema = z.object({
  as_at_date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional()
    .describe("Balance sheet as at this date (YYYY-MM-DD). Defaults to today."),
  opening_balances: z.boolean().default(false)
    .describe("Return the company's fixed opening balances instead (ignores as_at_date)."),
  response_format: ResponseFormatSchema
}).strict();

export const GetTrialBalanceInputSchema = z.object({
  from_date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional()
    .describe("Period start (YYYY-MM-DD). Omit with to_date set to run from the accounting period start."),
  to_date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional()
    .describe("Period end (YYYY-MM-DD). Omit both dates for a summary as at today."),
  opening_balances: z.boolean().default(false)
    .describe("Return opening balances instead of the period summary (ignores dates)."),
  response_format: ResponseFormatSchema
}).strict();

export const GetCashflowInputSchema = z.object({
  from_date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional()
    .describe("Period start (YYYY-MM-DD)."),
  to_date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional()
    .describe("Period end (YYYY-MM-DD). Future-dated requests return 0 (no projections)."),
  response_format: ResponseFormatSchema
}).strict();

// ---------------------------------------------------------------------------
// Statutory returns, read-only (fork addition). Deliberately NO filing or
// mark-as-filed/paid writes: filing decisions stay with the user.
// ---------------------------------------------------------------------------

export const ListFinalAccountsReportsInputSchema = z.object({
  response_format: ResponseFormatSchema
}).strict();

export const GetFinalAccountsReportInputSchema = z.object({
  period_ends_on: z.string().regex(/^\d{4}-\d{2}-\d{2}$/)
    .describe("The accounting period end date identifying the report (YYYY-MM-DD)"),
  response_format: ResponseFormatSchema
}).strict();

export const ListCorporationTaxReturnsInputSchema = z.object({
  response_format: ResponseFormatSchema
}).strict();

export const GetCorporationTaxReturnInputSchema = z.object({
  period_ends_on: z.string().regex(/^\d{4}-\d{2}-\d{2}$/)
    .describe("The accounting period end date identifying the return (YYYY-MM-DD)"),
  response_format: ResponseFormatSchema
}).strict();

export const ListVatReturnsInputSchema = z.object({
  response_format: ResponseFormatSchema
}).strict();

export const GetVatReturnInputSchema = z.object({
  period_ends_on: z.string().regex(/^\d{4}-\d{2}-\d{2}$/)
    .describe("The VAT period end date identifying the return (YYYY-MM-DD)"),
  response_format: ResponseFormatSchema
}).strict();

export const ListSalesTaxPeriodsInputSchema = z.object({
  response_format: ResponseFormatSchema
}).strict();

// ---------------------------------------------------------------------------
// General ledger transactions (fork addition: the double-entry behind it all)
// ---------------------------------------------------------------------------

export const ListLedgerTransactionsInputSchema = z.object({
  page: PaginationSchema.shape.page,
  per_page: PaginationSchema.shape.per_page,
  from_date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional()
    .describe("Filter postings dated on or after this date (YYYY-MM-DD). Range must not exceed 12 months or span accounting years."),
  to_date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional()
    .describe("Filter postings dated on or before this date (YYYY-MM-DD)."),
  nominal_code: z.string().optional()
    .describe("Filter to a single category by nominal code (e.g. '001', '285')"),
  response_format: ResponseFormatSchema
}).strict();

export const GetLedgerTransactionInputSchema = z.object({
  transaction_id: z.string().min(1)
    .describe("The accounting transaction ID (numeric) or full URL"),
  response_format: ResponseFormatSchema
}).strict();

// ---------------------------------------------------------------------------
// Stock items (read-only in the FreeAgent API)
// ---------------------------------------------------------------------------

export const ListStockItemsInputSchema = z.object({
  page: PaginationSchema.shape.page,
  per_page: PaginationSchema.shape.per_page,
  sort: z.enum(["created_at", "updated_at", "description"])
    .optional()
    .describe("Field to sort by (prefix with '-' for descending)"),
  response_format: ResponseFormatSchema
}).strict();

export const GetStockItemInputSchema = z.object({
  stock_item_id: z.string().min(1)
    .describe("The FreeAgent stock item ID (numeric) or full URL"),
  response_format: ResponseFormatSchema
}).strict();

// ---------------------------------------------------------------------------
// Email addresses, users, attachments, notes (fork additions)
// ---------------------------------------------------------------------------

export const ListEmailAddressesInputSchema = z.object({
  response_format: ResponseFormatSchema
}).strict();

export const GetUserInputSchema = z.object({
  user_id: z.string().min(1)
    .describe("The FreeAgent user ID (numeric), full URL, or 'me' for the authenticated user"),
  response_format: ResponseFormatSchema
}).strict();

export const GetAttachmentInputSchema = z.object({
  attachment_id: z.string().min(1)
    .describe("The FreeAgent attachment ID (numeric) or full URL"),
  response_format: ResponseFormatSchema
}).strict();

export const DeleteAttachmentInputSchema = z.object({
  attachment_id: z.string().min(1)
    .describe("The FreeAgent attachment ID (numeric) or full URL to delete"),
  confirm: z.literal(true)
    .describe("Must be exactly true. Acknowledges this permanently deletes the attached file.")
}).strict();

// NOTE: no .refine() here — register.ts consumes Schema.shape, which ZodEffects
// (the result of .refine) does not expose. The exactly-one-parent rule is
// enforced in the handlers instead.
export const ListNotesInputSchema = z.object({
  contact: z.string().optional().describe("Contact URL or ID whose notes to list. Provide exactly one of contact or project."),
  project: z.string().optional().describe("Project URL or ID whose notes to list. Provide exactly one of contact or project."),
  response_format: ResponseFormatSchema
}).strict();

export const CreateNoteInputSchema = z.object({
  contact: z.string().optional().describe("Contact URL or ID to attach the note to. Provide exactly one of contact or project."),
  project: z.string().optional().describe("Project URL or ID to attach the note to. Provide exactly one of contact or project."),
  note: z.string().min(1).describe("The content of the note")
}).strict();

export const UpdateNoteInputSchema = z.object({
  note_id: z.string().min(1).describe("The FreeAgent note ID (numeric) or full URL"),
  note: z.string().min(1).describe("Replacement content for the note")
}).strict();

export const DeleteNoteInputSchema = z.object({
  note_id: z.string().min(1).describe("The FreeAgent note ID (numeric) or full URL to delete"),
  confirm: z.literal(true)
    .describe("Must be exactly true. Acknowledges this permanently deletes the note.")
}).strict();

// ---------------------------------------------------------------------------
// Update tools for existing resources (fork additions)
// ---------------------------------------------------------------------------

export const UpdateInvoiceItemSchema = z.object({
  id: z.string().optional()
    .describe("ID of an existing invoice item to modify or remove. Omit to add a new item."),
  _destroy: z.literal(1).optional()
    .describe("Set to 1 (with id) to delete that line item."),
  item_type: z.string().optional()
    .describe("Hours, Days, Weeks, Months, Years, Products, Services, Training, Expenses, Comment, Bills, Discount, Credit, Stock, VAT"),
  description: z.string().optional(),
  price: z.string().optional().describe("Unit price (decimal string)"),
  quantity: z.string().optional().describe("Quantity (decimal string)"),
  sales_tax_rate: z.string().optional().describe("Sales tax rate percentage (e.g. '20.0')"),
  sales_tax_status: z.enum(["TAXABLE", "EXEMPT", "OUT_OF_SCOPE"]).optional(),
  category: z.string().optional().describe("Category URL or nominal code for the line item")
}).strict();

export const UpdateInvoiceInputSchema = z.object({
  invoice_id: z.string().min(1)
    .describe("The FreeAgent invoice ID (numeric) or full URL"),
  contact: z.string().optional().describe("New contact URL or ID"),
  dated_on: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional().describe("New invoice date (YYYY-MM-DD)"),
  due_on: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional().describe("New due date (YYYY-MM-DD)"),
  payment_terms_in_days: z.number().int().optional(),
  reference: z.string().optional().describe("New invoice reference"),
  po_reference: z.string().optional().describe("New PO reference"),
  comments: z.string().optional(),
  discount_percent: z.string().optional(),
  invoice_items: z.array(UpdateInvoiceItemSchema).optional()
    .describe("Line items to add (no id), modify (id + fields), or remove (id + _destroy: 1). Status changes are NOT possible here; use freeagent_transition_invoice.")
}).strict();

export const UpdateBillItemSchema = z.object({
  id: z.string().optional()
    .describe("ID of an existing bill item to modify or remove. Omit to add a new item."),
  _destroy: z.literal(1).optional()
    .describe("Set to 1 (with id) to delete that line item."),
  category: z.string().optional().describe("Category URL or nominal code"),
  description: z.string().optional(),
  total_value: z.string().optional().describe("Gross value of the line (decimal string)"),
  sales_tax_rate: z.string().optional().describe("Sales tax rate percentage (e.g. '20.0')"),
  sales_tax_status: z.enum(["TAXABLE", "EXEMPT", "OUT_OF_SCOPE"]).optional()
}).strict();

export const UpdateBillInputSchema = z.object({
  bill_id: z.string().min(1)
    .describe("The FreeAgent bill ID (numeric) or full URL"),
  contact: z.string().optional().describe("New contact URL or ID"),
  reference: z.string().optional(),
  dated_on: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional().describe("New bill date (YYYY-MM-DD)"),
  due_on: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional().describe("New due date (YYYY-MM-DD)"),
  comments: z.string().optional(),
  bill_items: z.array(UpdateBillItemSchema).optional()
    .describe("Line items to add (no id), modify (id + fields), or remove (id + _destroy: 1).")
}).strict();

export const UpdateProjectInputSchema = z.object({
  project_id: z.string().min(1)
    .describe("The FreeAgent project ID (numeric) or full URL"),
  name: z.string().optional(),
  status: z.enum(["Active", "Completed", "Cancelled", "Hidden"]).optional(),
  budget: z.string().optional().describe("Budget amount (decimal string)"),
  budget_units: z.enum(["Hours", "Days", "Monetary"]).optional(),
  normal_billing_rate: z.string().optional(),
  billing_period: z.enum(["hour", "day"]).optional(),
  hours_per_day: z.string().optional(),
  starts_on: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
  ends_on: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
  contract_po_reference: z.string().optional(),
  is_ir35: z.boolean().optional()
}).strict();

export const UpdateTaskInputSchema = z.object({
  task_id: z.string().min(1)
    .describe("The FreeAgent task ID (numeric) or full URL"),
  name: z.string().optional(),
  status: z.enum(["Active", "Completed", "Hidden"]).optional(),
  is_billable: z.boolean().optional(),
  billing_rate: z.string().optional(),
  billing_period: z.enum(["hour", "day"]).optional()
}).strict();

export const UpdatePriceListItemInputSchema = z.object({
  price_list_item_id: z.string().min(1)
    .describe("The FreeAgent price list item ID (numeric) or full URL"),
  description: z.string().optional(),
  item_type: z.string().optional()
    .describe("Hours, Days, Weeks, Months, Years, Products, Services, Training, Expenses, Stock"),
  price: z.string().optional().describe("Unit price (decimal string)"),
  sales_tax_rate: z.string().optional().describe("Sales tax rate percentage (e.g. '20.0')"),
  category: z.string().optional().describe("Category URL or nominal code")
}).strict();

export type ListCreditNotesInput = z.infer<typeof ListCreditNotesInputSchema>;
export type GetCreditNoteInput = z.infer<typeof GetCreditNoteInputSchema>;
export type ListCapitalAssetsInput = z.infer<typeof ListCapitalAssetsInputSchema>;
export type GetCapitalAssetInput = z.infer<typeof GetCapitalAssetInputSchema>;
export type ListCapitalAssetTypesInput = z.infer<typeof ListCapitalAssetTypesInputSchema>;
export type GetProfitAndLossInput = z.infer<typeof GetProfitAndLossInputSchema>;
export type GetBalanceSheetInput = z.infer<typeof GetBalanceSheetInputSchema>;
export type GetTrialBalanceInput = z.infer<typeof GetTrialBalanceInputSchema>;
export type GetCashflowInput = z.infer<typeof GetCashflowInputSchema>;
export type ListFinalAccountsReportsInput = z.infer<typeof ListFinalAccountsReportsInputSchema>;
export type GetFinalAccountsReportInput = z.infer<typeof GetFinalAccountsReportInputSchema>;
export type ListCorporationTaxReturnsInput = z.infer<typeof ListCorporationTaxReturnsInputSchema>;
export type GetCorporationTaxReturnInput = z.infer<typeof GetCorporationTaxReturnInputSchema>;
export type ListVatReturnsInput = z.infer<typeof ListVatReturnsInputSchema>;
export type GetVatReturnInput = z.infer<typeof GetVatReturnInputSchema>;
export type ListSalesTaxPeriodsInput = z.infer<typeof ListSalesTaxPeriodsInputSchema>;
export type ListLedgerTransactionsInput = z.infer<typeof ListLedgerTransactionsInputSchema>;
export type GetLedgerTransactionInput = z.infer<typeof GetLedgerTransactionInputSchema>;
export type ListStockItemsInput = z.infer<typeof ListStockItemsInputSchema>;
export type GetStockItemInput = z.infer<typeof GetStockItemInputSchema>;
export type ListEmailAddressesInput = z.infer<typeof ListEmailAddressesInputSchema>;
export type GetUserInput = z.infer<typeof GetUserInputSchema>;
export type GetAttachmentInput = z.infer<typeof GetAttachmentInputSchema>;
export type DeleteAttachmentInput = z.infer<typeof DeleteAttachmentInputSchema>;
export type ListNotesInput = z.infer<typeof ListNotesInputSchema>;
export type CreateNoteInput = z.infer<typeof CreateNoteInputSchema>;
export type UpdateNoteInput = z.infer<typeof UpdateNoteInputSchema>;
export type DeleteNoteInput = z.infer<typeof DeleteNoteInputSchema>;
export type UpdateInvoiceInput = z.infer<typeof UpdateInvoiceInputSchema>;
export type UpdateBillInput = z.infer<typeof UpdateBillInputSchema>;
export type UpdateProjectInput = z.infer<typeof UpdateProjectInputSchema>;
export type UpdateTaskInput = z.infer<typeof UpdateTaskInputSchema>;
export type UpdatePriceListItemInput = z.infer<typeof UpdatePriceListItemInputSchema>;
