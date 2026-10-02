# Changelog

All notable changes to this fork are documented here. Versions are git tags; see GitHub Releases for full notes.

## [1.2.4] - 2026-10-02

- **New tool: `freeagent_delete_bank_transaction`.** Replaces the old "never delete a bank transaction" rule with a guarded delete. Needed on 2 Oct 2026 to remove FreeAgent-created `///` transfer counterparts (FreeAgent invents a manual transaction in the other account when one side of a transfer is explained while the real other side is already explained) and feed/statement-upload duplicates. Reviewed in three independent Claude rounds and two Grok rounds before release; Grok's prefix-match blocker and seven other findings fixed, one nit (block project-tagged explanations) declined because a project tag is reporting only and `delete_explanations` already lists every explanation removed.
  - Requires `confirm: true` and a `reason`, echoed in the reply and logged to stderr (signed attachment URLs stripped).
  - Manual transactions only, unless `allow_imported: true` with `duplicate_of` naming the imported copy to keep. It must be in the same account, for the same amount, dated within 3 days, with an identical description after removing spaces and punctuation, and still exist. For a manual transaction, `duplicate_of` is optional and checked on account, amount and date only; the reply says so instead of calling it a duplicate. A URL from another FreeAgent environment (for example sandbox) is refused.
  - Explanations are removed first only with `delete_explanations: true`. Every explanation, and a transfer's partner explanation, is re-read in full before anything changes. It is refused if it carries any `paid_*` link, an asset, stock, property or rebill link, `is_deletable: false`, a receipt attachment, `is_locked`, or locked attributes beyond the structural locks a transfer explanation has.
  - The final delete isn't atomic. Once anything has changed, every exit re-reads the transaction and reports its real state (gone, still there, or unknown), the full pre-change records of everything removed or possibly removed, and the transfer partner's actual state. "Deleted" is reported only when a GET returns 404. An errored delete that succeeded on the server is detected, and so is a transaction FreeAgent removes along with its last explanation.
  - Uses `DELETE /v2/bank_transactions/:id` only. The docs show a singular `/bank_transaction/:id` under a heading about deleting explanations, so that route is never called with a transaction ID.
  - Advises re-explaining a transfer partner only when that partner still exists and is now unexplained.
  - A receipt blocks the delete whether FreeAgent returns it as `attachment`, `attachment_count` or (from 1 Dec 2026, when the default payload changes) a non-empty `attachments` array.
  - The reply says which way the account balance moves ("goes up by 35.00"), not "the reverse of -35.0".
  - Annotated `idempotentHint: false`: a repeat call after a successful delete 404s and reports an error, so clients must not retry it automatically.
- The tool refuses to run on the hosted (Vercel) deployment for now (60 s limit), and `freeagent_call_tool` refuses it in tool-search mode, so the client always asks the human before each call.
- `api-client`: 404s and statuses without a dedicated message now raise `ApiRequestError` (same messages, plus `status`). `isNotFoundError()`, `errorStatus()` and `NOT_FOUND_MESSAGE` are exported, so callers don't have to match message text.
- Tests: 47 new (321 total). The test fake now behaves like FreeAgent: a transaction with explanations can't be deleted, an explanation delete 404s once it's gone, and the unexplained amount is recomputed from what's left.

## [1.2.3] - 2026-09-26

Fixes from an independent review of v1.2.2 (Grok), each checked against the FreeAgent API docs and live behaviour before changing.

- **Depreciation profiles now take effect.** `depreciation_profile` on bank explanation create/update is sent nested under `capital_asset`, where FreeAgent reads it. At the root it was silently ignored and the sub-category default (3 years) applied; seen live on 26 Sep 2026.
- **Journals can post to capital asset categories.** Entries accept `capital_asset_type` (URL, ID or name, e.g. "Motor Vehicles") and stock entries accept `stock_item` / `stock_altering_quantity`. A sub-coded category such as `602-3` is sent as the parent category plus its capital asset type. A bare 601-607 entry without a type is refused with a clear message instead of FreeAgent's misleading 404.
- **Sub-coded categories resolve.** Nominal codes like `602-3`, `750-1` and `902-1` go to `/categories/:code`; name searches fall back to `sub_accounts=true`; `list_categories` takes `sub_accounts`.
- **create_bill works.** Lines send `total_value` (gross) or `total_value_ex_tax` (net), exactly one, positive. The old `price`/`quantity` shape was always rejected by FreeAgent and is now refused by the schema.
- **Invoice lines can set VAT.** `create_invoice` items accept `sales_tax_rate` (percentage-guarded), `sales_tax_status` and `category`; `price` is documented as net of VAT.
- **Sign conventions documented.** Bank explanation `gross_value` is negative for money out (the opposite of journals); `sales_tax_value` carries the same sign.
- **discount_percent is percentage-guarded** like `sales_tax_rate` (create/update invoice, create estimate, invoice_from_timeslips): `"0.20"` is rejected.
- **Pagination.** `list_journal_sets` follows every page. `list_projects` / `list_tasks` say when more pages exist. `parsePaginationHeaders` accepts relative or unquoted `Link` headers and falls back to `X-Total-Count` when no usable `Link` arrives (list calls were seen reporting `has_more: false` on every page).
- **Transport:** redirects are never followed, so a 3xx cannot carry the bearer to another host.
- **Display:** a numeric category `auto_sales_tax_rate` of 20 renders as 20.0%, not 2000.0%.
- Tests: 23 new payload-level tests (274 total).
- Reviewed but not changed: raw "URL or ID" arguments on explanation/expense/bill create. FreeAgent accepted bare IDs and nominal codes in live calls on 26 Sep 2026, so this is not the 422 the review predicted. `initial_mileage` naming left for a separate check.

## [1.2.2] - 2026-09-26

VAT rate format fix. FreeAgent takes `sales_tax_rate` as a percentage string ("20.0" = 20%), but eight tool schema fields described it as a decimal fraction ("0.20" for 20%). Following that description records VAT at 0.2%: three live bank explanations were written that way on 18 Sep 2026 and corrected by hand on 26 Sep 2026.

- New shared `SalesTaxRateSchema` / `OptionalSalesTaxRateSchema`: percentage strings only (0 to 100); values strictly between 0 and 1 are rejected with an error explaining the percentage format, so a decimal fraction can no longer reach the API. Used by expense create/update, log_expense, bank-transaction explanation create/update, bill and estimate line items, and price list item create/update, plus invoice and bill line-item updates.
- Tool descriptions now say "'20.0' for 20%" and warn against decimal fractions.
- Display fix: expense and explanation output no longer multiplies the stored rate by 100 (a 20% rate showed as "2000%").
- TOOLS.md parameter docs corrected.
- Tests: schema accepts/rejects cases, and every tool shape that exposes `sales_tax_rate` rejects "0.20".

## [1.2.1] - 2026-08-21

Ship tag for the v1.2 backlog. Tag `v1.2.0` was cut before the review follow-up and is not rewritten.

- Trial balance never claims "(balances)" when pagination is capped or a single 25/100-row page arrives without Link headers; warning sits at the top of the markdown; `truncateIfNeeded` applies.
- Shared `buildAttachmentPayload` for explanation create/update and expense create.
- `/health` reports whether static bearer is enabled, not the scope. Auth success log uses `mode: "static"` and does not log tokens.
- Tests: `registerAllTools({ scope: "read" })` does not register writes; `callTool` on a read catalog rejects write tools.
- Version identity is 1.2.1 in `package.json`, `SERVER_VERSION`, CHANGELOG, and `/health`. Tags `v1.1.2` and `v1.2.0` were not rewritten.

## [1.2.0] - 2026-08-21

Backlog: trial balance completeness, explanation attachments on update, invoice reminder setting, journal create confirm, hosted static-bearer auth.

- `freeagent_get_trial_balance` auto-paginates via `fetchAllPages` (10-page / 1,000-row cap). Cap and missing-`Link`-header cases warn instead of silently truncating; the sum line never claims "(balances)" on incomplete data. Markdown is truncated at the usual 25k character limit.
- `freeagent_update_bank_transaction_explanation` accepts the same `attachment` block as create (8MB decoded-size limit, gzip `maxOutputLength` guard, same content types). Expense create shares the same helper.
- `freeagent_update_invoice` exposes optional `send_reminder_emails` (toggles automatic overdue reminders; does not send immediately; no confirm gate).
- **Breaking:** `freeagent_create_journal_set` now requires `confirm: true`, matching update/delete. Handler debit/credit balance check is unchanged. Callers that omitted `confirm` will be rejected.
- Hosted static bearer auth: `MCP_STATIC_BEARER` + `FREEAGENT_REFRESH_TOKEN` + `MCP_STATIC_SCOPE` (`read` default / `read_draft` / `full`). Timing-safe compare, module-scope access-token cache (one FreeAgent identity per process, not multi-tenant). `read_draft` is a **write** (`create_bank_transaction_explanation` with `marked_for_review` forced true). OAuth/JWT path unchanged; unset `MCP_STATIC_BEARER` is inert; missing refresh token fails closed. `/health` reports whether static bearer is enabled, not the scope.
- `api/index.ts` is type-checked via `tsconfig.api.json` (`bun run typecheck`).
- Removed unused `oauth-proxy.ts` and `freeagent-auth.ts`.
- README tool catalogue regenerated to 88 tools, matching TOOLS.md.
- Version identity is 1.2.0 in `package.json`, `SERVER_VERSION`, CHANGELOG, and `/health`.

## [1.1.2] - 2026-07-27

Residual fixes from the second static audit pass (v1.1.1 review).

- Confirm gates: `update_journal_set` and `upload_bank_statement` now require `confirm: true`; `transition_invoice` carries `destructiveHint` (mark_as_cancelled writes off).
- Journal balance is now enforced in the handlers for BOTH create and update (the schema-level refine does not survive the `.shape` registration path); update pre-reads the set and simulates the modification before writing.
- Pagination caps are surfaced everywhere: statement verification warns when the 1000-row window was hit; invoice_from_timeslips refuses to invoice from a truncated timeslip or project list; resolver errors say how much was searched.
- Partial results no longer lead with ✅ (statement shortfalls, timeslip link failures).
- Expense create/update success lines read the API's `mileage` field, completing the v1.1.1 mileage fix.
- Attachment decompression is bounded (`maxOutputLength` 8MB) against gzip bombs; `jwt.verify` pins HS256; the 429-exhausted message reports the parsed wait instead of echoing the raw header.
- `/health` rewrite added to vercel.json; deploy docs now cover `JWT_SECRET`, `PRODUCTION_URL`, and the exact `/oauth/callback` redirect path; stale 1.0.0 version examples corrected.

## [1.1.1] - 2026-07-27

Remediation of the first independent static audit: `get_category` unwrap, full pagination in resolvers/statement verification/invoice_from_timeslips, sandbox-aware `resourceUrl()`, SSRF host allowlist at the request interceptor, `mark_as_cancelled` confirm gate, JWT_SECRET fail-closed on Vercel, 429 jitter + Vercel sleep cap, unified `SERVER_VERSION`, tool-search annotations, docs corrections.

## [1.1.0] - 2026-07-27

Coverage expansion from 55 to 88 catalog tools: credit notes, P&L / balance sheet / trial balance / cashflow, general ledger transactions, capital assets + depreciation profiles, statutory returns (read-only), stock items, attachments, notes, users, email addresses, and update tools for invoices/bills/projects/tasks/price list items. Plus `sales_tax_status` support and the reconcile zero-amount fix.
