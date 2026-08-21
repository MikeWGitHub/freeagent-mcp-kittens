# Changelog

All notable changes to this fork are documented here. Versions are git tags; see GitHub Releases for full notes.

## [1.2.0] - 2026-08-21

Backlog: trial balance completeness, explanation attachments on update, invoice reminder setting, journal create confirm, hosted static-bearer auth.

- `freeagent_get_trial_balance` auto-paginates via `fetchAllPages` (10-page / 1,000-row cap) and warns when capped instead of silently returning the first 25 rows.
- `freeagent_update_bank_transaction_explanation` accepts the same `attachment` block as create (8MB decoded-size limit, gzip `maxOutputLength` guard, same content types).
- `freeagent_update_invoice` exposes optional `send_reminder_emails` (toggles automatic overdue reminders; does not send immediately; no confirm gate).
- `freeagent_create_journal_set` requires `confirm: true`, matching update/delete. Handler debit/credit balance check is unchanged.
- Hosted static bearer auth: `MCP_STATIC_BEARER` + `FREEAGENT_REFRESH_TOKEN` + `MCP_STATIC_SCOPE` (`read` / `read_draft` / `full`). Timing-safe compare, module-scope access-token cache, `read_draft` forces `marked_for_review` on explanation create. OAuth/JWT path unchanged; unset `MCP_STATIC_BEARER` is inert; missing refresh token fails closed.
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
