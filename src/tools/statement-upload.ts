/**
 * Bank statement upload + explanation delete (fork additions).
 *
 * upload_bank_statement wraps POST /bank_transactions/statement. FreeAgent
 * silently de-duplicates uploaded rows against existing transactions with the
 * same date + amount + description, which is exactly how legitimate same-day
 * twins get lost. This tool therefore verifies the import afterwards using the
 * last_uploaded filter and reports any rows that did not survive.
 *
 * delete_bank_transaction_explanation removes a single explanation, returning
 * its transaction to unexplained. It never deletes bank transactions.
 */

import type { FreeAgentApiClient } from "../services/api-client.js";
import { fetchAllPages } from "../services/api-client.js";
import type {
  UploadBankStatementInput,
  DeleteBankTransactionExplanationInput,
} from "../schemas/index.js";
import type { FreeAgentBankTransactionExplanation } from "../types.js";
import { extractIdFromUrl } from "../services/formatter.js";

interface UploadedTransaction {
  url: string;
  dated_on: string;
  amount: string;
  description: string;
  transaction_id?: string;
}

function accountId(idOrUrl: string): string {
  return idOrUrl.startsWith("http") ? extractIdFromUrl(idOrUrl) : idOrUrl;
}

/** Injectable for tests; real uploads wait between verification polls. */
export const defaultSleep = (ms: number): Promise<void> =>
  new Promise((resolve) => setTimeout(resolve, ms));

/** Poll delays for the post-upload verification (FreeAgent imports async). */
const VERIFY_DELAYS_MS = [3000, 6000, 9000];

export async function uploadBankStatement(
  client: FreeAgentApiClient,
  params: UploadBankStatementInput,
  sleep: (ms: number) => Promise<void> = defaultSleep
): Promise<string> {
  const account = accountId(params.bank_account);

  const statement = params.transactions.map((t) => {
    const row: Record<string, unknown> = {
      dated_on: t.dated_on,
      amount: t.amount,
      description: t.description,
    };
    if (t.fitid) row.fitid = t.fitid;
    if (t.transaction_type) row.transaction_type = t.transaction_type;
    return row;
  });

  // FreeAgent processes statement imports ASYNCHRONOUSLY, so querying
  // last_uploaded=true straight after the POST races the import and can
  // return the PREVIOUS upload (observed live, 19 Jul 2026). Instead:
  // snapshot the affected date range before uploading, then poll the same
  // range afterwards and diff by transaction ID. New IDs = this upload.
  const dates = params.transactions.map((t) => t.dated_on).sort();
  const range = { bank_account: account, from_date: dates[0], to_date: dates[dates.length - 1] };

  // Paginate the snapshot and every poll: a single-page (100-row) read made
  // the verification lie for busy date ranges — wrong import counts and false
  // dedupe warnings (audit B-HIGH-2).
  const before = await fetchAllPages<UploadedTransaction>(
    client, "/bank_transactions", range, "bank_transactions"
  );
  const preExisting = new Set(before.items.map((t) => t.url));

  await client.post(`/bank_transactions/statement?bank_account=${account}`, {
    statement,
  });

  let imported: UploadedTransaction[] = [];
  for (const delayMs of VERIFY_DELAYS_MS) {
    await sleep(delayMs);
    const check = await fetchAllPages<UploadedTransaction>(
      client, "/bank_transactions", range, "bank_transactions"
    );
    imported = check.items.filter((t) => !preExisting.has(t.url));
    // Stop early once every sent row is accounted for; a shortfall may just
    // mean the import is still processing, so keep polling until the delays
    // are exhausted before concluding rows were de-duplicated away.
    if (imported.length >= params.transactions.length) break;
  }

  const lines = [
    `✅ Statement uploaded to bank account ${account}.`,
    "",
    `**Sent**: ${params.transactions.length} transaction(s)`,
    `**Imported in this upload**: ${imported.length}`,
    "",
    "| Date | Amount | Description | ID |",
    "|---|---|---|---|",
    ...imported.map(
      (t) =>
        `| ${t.dated_on} | ${t.amount} | ${t.description} | ${extractIdFromUrl(t.url)} |`
    ),
  ];

  if (imported.length < params.transactions.length) {
    lines.push(
      "",
      `⚠️ ${params.transactions.length - imported.length} row(s) did not appear within the verification window. The most likely cause is FreeAgent's silent de-duplication (same date + amount + description as an existing transaction) — to add a deliberate same-day twin, re-send with a different description. A slow import is also possible: re-check with freeagent_list_bank_transactions for the affected dates before re-sending.`
    );
  }
  if (imported.length > params.transactions.length) {
    lines.push(
      "",
      `⚠️ More new transactions appeared in the date range than were sent (${imported.length} vs ${params.transactions.length}). Another upload or bank feed may have landed concurrently; review the table above.`
    );
  }

  return lines.join("\n");
}

export async function deleteBankTransactionExplanation(
  client: FreeAgentApiClient,
  params: DeleteBankTransactionExplanationInput
): Promise<string> {
  const id = params.bank_transaction_explanation_id.startsWith("http")
    ? extractIdFromUrl(params.bank_transaction_explanation_id)
    : params.bank_transaction_explanation_id;

  // Read before deleting so the reply carries an audit trail of what was removed.
  const before = await client.get<{
    bank_transaction_explanation: FreeAgentBankTransactionExplanation;
  }>(`/bank_transaction_explanations/${id}`);
  const exp = before.data.bank_transaction_explanation;

  await client.delete(`/bank_transaction_explanations/${id}`);

  return (
    `🗑️ Deleted bank transaction explanation ${id}. ` +
    `The underlying bank transaction is now unexplained.\n\n` +
    `Record of what was removed:\n` +
    `- **Date**: ${exp.dated_on}\n` +
    `- **Value**: ${exp.gross_value}\n` +
    `- **Type**: ${exp.type ?? "-"}\n` +
    `- **Description**: ${exp.description ?? "-"}\n` +
    `- **Bank transaction**: ${exp.bank_transaction}\n` +
    (exp.linked_transfer_account
      ? `- **Was linked to transfer account**: ${exp.linked_transfer_account} (pairing now broken)\n`
      : "")
  );
}
