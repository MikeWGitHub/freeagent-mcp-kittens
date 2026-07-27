/**
 * General Ledger Transaction Tools (read-only fork addition).
 *
 * Exposes GET /v2/accounting/transactions — the actual double-entry postings
 * behind invoices, credit notes, explanations, and journals. One lookup here
 * replaces inferring a document chain from statuses (as the Abbey
 * 020→021→022→023 reconstruction required, Jul 2026).
 *
 * API constraint: date ranges must not exceed 12 months or span accounting
 * years.
 */

import type { FreeAgentApiClient } from "../services/api-client.js";
import type { FreeAgentLedgerTransaction } from "../types.js";
import type { ListLedgerTransactionsInput, GetLedgerTransactionInput } from "../schemas/index.js";
import {
  formatResponse,
  truncateIfNeeded,
  createPaginationMetadata,
  extractIdFromUrl,
} from "../services/formatter.js";

export async function listLedgerTransactions(
  client: FreeAgentApiClient,
  params: ListLedgerTransactionsInput
): Promise<string> {
  const queryParams: Record<string, string | number> = {
    page: params.page,
    per_page: params.per_page,
  };
  if (params.from_date) queryParams.from_date = params.from_date;
  if (params.to_date) queryParams.to_date = params.to_date;
  if (params.nominal_code) queryParams.nominal_code = params.nominal_code;

  const response = await client.get<{ transactions: FreeAgentLedgerTransaction[] }>(
    "/accounting/transactions",
    queryParams
  );
  const transactions = response.data.transactions ?? [];
  const pagination = client.parsePaginationHeaders(response.headers);

  const formatted = formatResponse(
    {
      transactions,
      pagination: {
        page: params.page,
        per_page: params.per_page,
        total_count: pagination.totalCount,
        has_more: pagination.hasMore,
        next_page: pagination.nextPage,
      },
    },
    params.response_format,
    () => {
      const lines: string[] = ["# General Ledger Transactions", ""];
      if (params.nominal_code) lines.push(`**Nominal code**: ${params.nominal_code}`, "");
      if (pagination.totalCount !== undefined) {
        lines.push(
          createPaginationMetadata({
            page: params.page,
            perPage: params.per_page,
            totalCount: pagination.totalCount,
            hasMore: pagination.hasMore,
            nextPage: pagination.nextPage,
          }),
          ""
        );
      }
      if (transactions.length === 0) {
        lines.push("No ledger transactions found.");
        return lines.join("\n");
      }

      lines.push("| Date | Code | Category | Debit (−=credit) | Description | ID |", "|---|---|---|---|---|---|");
      for (const tx of transactions) {
        lines.push(
          `| ${tx.dated_on} | ${tx.nominal_code ?? "-"} | ${tx.category_name ?? "-"} | ${tx.debit_value ?? "-"} | ${tx.description ?? "-"} | ${extractIdFromUrl(tx.url)} |`
        );
      }
      return lines.join("\n");
    }
  );

  return truncateIfNeeded(formatted, {
    count: transactions.length,
    total: pagination.totalCount,
  });
}

export async function getLedgerTransaction(
  client: FreeAgentApiClient,
  params: GetLedgerTransactionInput
): Promise<string> {
  const id = params.transaction_id.startsWith("http")
    ? extractIdFromUrl(params.transaction_id)
    : params.transaction_id;

  const response = await client.get<{ transaction: FreeAgentLedgerTransaction }>(
    `/accounting/transactions/${id}`
  );
  const tx = response.data.transaction;

  return formatResponse({ transaction: tx }, params.response_format, () => {
    const lines: string[] = [
      `# Ledger Transaction ${extractIdFromUrl(tx.url)}`,
      "",
      `- **Date**: ${tx.dated_on}`,
      `- **Category**: ${tx.category_name ?? "-"} (${tx.nominal_code ?? "-"})`,
      `- **Debit value** (negative = credit): ${tx.debit_value ?? "-"}`,
      `- **Description**: ${tx.description ?? "-"}`,
    ];
    if (tx.source_item_url) lines.push(`- **Source item**: ${tx.source_item_url}`);
    if (tx.foreign_currency_data) {
      lines.push(
        `- **Foreign currency**: ${tx.foreign_currency_data.debit_value ?? "-"} ${tx.foreign_currency_data.currency_code ?? ""}`
      );
    }
    lines.push(`- **URL**: ${tx.url}`);
    return lines.join("\n");
  });
}
