/**
 * Accounting Report Tools (read-only fork addition).
 *
 * Profit & Loss, Balance Sheet, Trial Balance, and Cashflow. These are
 * summary endpoints — one call replaces adding up hundreds of invoices by
 * hand (as the Access UK reconciliation of Jul 2026 required), and gives a
 * cheap post-reconciliation sanity check.
 *
 * API notes:
 * - P&L and Trial Balance date ranges must fit within one accounting year.
 * - Balance Sheet takes a single as_at_date.
 * - Cashflow returns 0 for future-dated requests (no projections).
 */

import type { FreeAgentApiClient } from "../services/api-client.js";
import { fetchAllPages } from "../services/api-client.js";
import type {
  FreeAgentProfitAndLossSummary,
  FreeAgentTrialBalanceRow,
  FreeAgentCashflow,
} from "../types.js";
import type {
  GetProfitAndLossInput,
  GetBalanceSheetInput,
  GetTrialBalanceInput,
  GetCashflowInput,
} from "../schemas/index.js";
import { formatResponse, truncateIfNeeded } from "../services/formatter.js";

export async function getProfitAndLoss(
  client: FreeAgentApiClient,
  params: GetProfitAndLossInput
): Promise<string> {
  const queryParams: Record<string, string> = {};
  if (params.from_date) queryParams.from_date = params.from_date;
  if (params.to_date) queryParams.to_date = params.to_date;
  if (params.accounting_period) queryParams.accounting_period = params.accounting_period;

  const response = await client.get<{ profit_and_loss_summary: FreeAgentProfitAndLossSummary }>(
    "/accounting/profit_and_loss/summary",
    queryParams
  );
  const summary = response.data.profit_and_loss_summary;

  return formatResponse({ profit_and_loss_summary: summary }, params.response_format, () => {
    const lines: string[] = [
      "# Profit & Loss Summary",
      "",
      `**Period**: ${summary.from ?? "-"} to ${summary.to ?? "-"}`,
      "",
      `- **Income**: ${summary.income ?? "-"}`,
      `- **Expenses**: ${summary.expenses ?? "-"}`,
      `- **Operating profit**: ${summary.operating_profit ?? "-"}`,
    ];
    if (summary.less && summary.less.length > 0) {
      lines.push("", "## Less");
      for (const item of summary.less) {
        lines.push(`- **${item.title ?? "-"}**: ${item.total ?? "-"}`);
      }
    }
    lines.push(
      "",
      `- **Retained profit for period**: ${summary.retained_profit ?? "-"}`,
      `- **Retained profit brought forward**: ${summary.retained_profit_brought_forward ?? "-"}`,
      `- **Retained profit carried forward**: ${summary.retained_profit_carried_forward ?? "-"}`
    );
    return lines.join("\n");
  });
}

/**
 * Renders the balance sheet's nested structure generically: FreeAgent groups
 * accounts under capital_assets / current_assets / current_liabilities /
 * owners_equity with totals alongside, and the exact keys vary by company
 * type, so this walks whatever comes back rather than assuming a shape.
 */
function renderBalanceSheetSection(lines: string[], key: string, value: unknown): void {
  const title = key.replace(/_/g, " ").replace(/^./, (c) => c.toUpperCase());
  if (value === null || value === undefined) return;
  if (typeof value !== "object") {
    lines.push(`- **${title}**: ${String(value)}`);
    return;
  }
  if (Array.isArray(value)) {
    lines.push(`## ${title}`);
    for (const row of value) {
      if (row && typeof row === "object") {
        const r = row as Record<string, unknown>;
        const name = r.name ?? r.description ?? r.title ?? "-";
        const total = r.total ?? r.value ?? r.net_book_value ?? "-";
        lines.push(`- ${String(name)}: ${String(total)}`);
      } else {
        lines.push(`- ${String(row)}`);
      }
    }
    lines.push("");
    return;
  }
  lines.push(`## ${title}`);
  for (const [subKey, subValue] of Object.entries(value as Record<string, unknown>)) {
    if (subValue !== null && typeof subValue === "object") {
      renderBalanceSheetSection(lines, subKey, subValue);
    } else {
      lines.push(`- **${subKey.replace(/_/g, " ")}**: ${String(subValue)}`);
    }
  }
  lines.push("");
}

export async function getBalanceSheet(
  client: FreeAgentApiClient,
  params: GetBalanceSheetInput
): Promise<string> {
  const endpoint = params.opening_balances
    ? "/accounting/balance_sheet/opening_balances"
    : "/accounting/balance_sheet";
  const queryParams: Record<string, string> = {};
  if (!params.opening_balances && params.as_at_date) queryParams.as_at_date = params.as_at_date;

  const response = await client.get<{ balance_sheet: Record<string, unknown> }>(
    endpoint,
    queryParams
  );
  const sheet = response.data.balance_sheet ?? {};

  return formatResponse({ balance_sheet: sheet }, params.response_format, () => {
    const lines: string[] = [
      params.opening_balances ? "# Balance Sheet (Opening Balances)" : "# Balance Sheet",
      "",
    ];
    for (const [key, value] of Object.entries(sheet)) {
      renderBalanceSheetSection(lines, key, value);
    }
    return lines.join("\n");
  });
}

const TRIAL_BALANCE_CAP_WARNING =
  "⚠️ Trial balance pagination hit the 10-page / 1,000-row cap; later rows are omitted. Narrow the date range for a complete statement.";

function trialBalanceHeaderAbsentWarning(rowCount: number): string {
  return (
    `⚠️ Trial balance returned exactly ${rowCount} rows on a single page with no pagination Link header. ` +
    "FreeAgent's public docs do not document pagination for this endpoint; if the statement looks short, later rows may still be missing."
  );
}

export async function getTrialBalance(
  client: FreeAgentApiClient,
  params: GetTrialBalanceInput
): Promise<string> {
  const endpoint = params.opening_balances
    ? "/accounting/trial_balance/summary/opening_balances"
    : "/accounting/trial_balance/summary";
  const queryParams: Record<string, string> = {};
  if (!params.opening_balances) {
    if (params.from_date) queryParams.from_date = params.from_date;
    if (params.to_date) queryParams.to_date = params.to_date;
  }

  // Production saw a silent 25-row first page. Official trial-balance docs do
  // not mention pagination; we still request per_page=100 via fetchAllPages
  // and follow Link: rel="next" when present.
  const { items: rows, capped, pagesFetched } = await fetchAllPages<FreeAgentTrialBalanceRow>(
    client,
    endpoint,
    queryParams,
    "trial_balance_summary"
  );

  const headerAbsent =
    !capped && pagesFetched === 1 && (rows.length === 25 || rows.length === 100);
  const incomplete = capped || headerAbsent;
  const warning = capped
    ? TRIAL_BALANCE_CAP_WARNING
    : headerAbsent
      ? trialBalanceHeaderAbsentWarning(rows.length)
      : undefined;

  const payload: {
    trial_balance_summary: FreeAgentTrialBalanceRow[];
    warning?: string;
  } = { trial_balance_summary: rows };
  if (warning) payload.warning = warning;

  return formatResponse(payload, params.response_format, () => {
    const lines: string[] = [
      params.opening_balances ? "# Trial Balance (Opening Balances)" : "# Trial Balance Summary",
      "",
    ];
    if (params.from_date || params.to_date) {
      lines.push(`**Period**: ${params.from_date ?? "(period start)"} to ${params.to_date ?? "(today)"}`, "");
    }
    if (warning) {
      lines.push(warning, "");
    }
    if (rows.length === 0) {
      lines.push("No trial balance rows returned.");
      return truncateIfNeeded(lines.join("\n"), { count: 0 });
    }
    const sum = rows.reduce((acc, r) => acc + (Number(r.total) || 0), 0);
    const sumNote = incomplete
      ? "⚠️ (incomplete — not a balance check)"
      : Math.abs(sum) < 0.005
        ? "(balances)"
        : "⚠️ (does not balance)";
    lines.push(`**Sum of returned rows**: ${sum.toFixed(2)} ${sumNote}`, "");
    lines.push("| Code | Account | Total |", "|---|---|---|");
    for (const row of rows) {
      lines.push(
        `| ${row.display_nominal_code ?? row.nominal_code ?? "-"} | ${row.name ?? "-"} | ${row.total ?? "-"} |`
      );
    }
    return truncateIfNeeded(lines.join("\n"), { count: rows.length });
  });
}

export async function getCashflow(
  client: FreeAgentApiClient,
  params: GetCashflowInput
): Promise<string> {
  const queryParams: Record<string, string> = {};
  if (params.from_date) queryParams.from_date = params.from_date;
  if (params.to_date) queryParams.to_date = params.to_date;

  const response = await client.get<{ cashflow: FreeAgentCashflow }>("/cashflow", queryParams);
  const cashflow = response.data.cashflow;

  return formatResponse({ cashflow }, params.response_format, () => {
    const lines: string[] = [
      "# Cashflow",
      "",
      `**Period**: ${cashflow.from ?? "-"} to ${cashflow.to ?? "-"}`,
      "",
      `- **Incoming**: ${cashflow.incoming?.total ?? "-"}`,
      `- **Outgoing**: ${cashflow.outgoing?.total ?? "-"}`,
      `- **Net balance**: ${cashflow.balance ?? "-"}`,
    ];
    const incoming = cashflow.incoming?.months ?? [];
    const outgoing = cashflow.outgoing?.months ?? [];
    if (incoming.length > 0 || outgoing.length > 0) {
      lines.push("", "## Monthly breakdown", "", "| Month | In | Out |", "|---|---|---|");
      const byMonth = new Map<string, { in?: string; out?: string }>();
      for (const m of incoming) {
        byMonth.set(`${m.year}-${String(m.month).padStart(2, "0")}`, { in: m.total });
      }
      for (const m of outgoing) {
        const key = `${m.year}-${String(m.month).padStart(2, "0")}`;
        byMonth.set(key, { ...(byMonth.get(key) ?? {}), out: m.total });
      }
      for (const [month, vals] of [...byMonth.entries()].sort()) {
        lines.push(`| ${month} | ${vals.in ?? "-"} | ${vals.out ?? "-"} |`);
      }
    }
    return lines.join("\n");
  });
}
