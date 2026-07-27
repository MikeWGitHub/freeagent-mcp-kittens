/**
 * Statutory Return Tools (read-only fork addition).
 *
 * Final Accounts Reports, Corporation Tax Returns, VAT Returns, and Sales
 * Tax Periods. DELIBERATELY read-only: the API offers mark_as_filed /
 * mark_as_paid transitions, but filing decisions stay with the user (see the
 * skill's "No filing" rule), so those writes are not exposed.
 *
 * Intended IoM workflow: read the CT return's amount_due, sanity check it,
 * then zero it with freeagent_create_journal_set (IoM CT rate is 0%).
 */

import type { FreeAgentApiClient } from "../services/api-client.js";
import type { FreeAgentAnnualReturn, FreeAgentVatReturn, FreeAgentSalesTaxPeriod } from "../types.js";
import type {
  ListFinalAccountsReportsInput,
  GetFinalAccountsReportInput,
  ListCorporationTaxReturnsInput,
  GetCorporationTaxReturnInput,
  ListVatReturnsInput,
  GetVatReturnInput,
  ListSalesTaxPeriodsInput,
} from "../schemas/index.js";
import { formatDate, formatResponse, extractIdFromUrl } from "../services/formatter.js";

function renderAnnualReturnLines(item: FreeAgentAnnualReturn): string[] {
  const lines = [
    `- **Period**: ${formatDate(item.period_starts_on ?? "")} to ${formatDate(item.period_ends_on)}`,
    `- **Filing status**: ${item.filing_status ?? "-"}`,
  ];
  if (item.filing_due_on) lines.push(`- **Filing due**: ${formatDate(item.filing_due_on)}`);
  if (item.filed_at) lines.push(`- **Filed at**: ${item.filed_at}`);
  if (item.filed_reference) lines.push(`- **Filed reference**: ${item.filed_reference}`);
  if (item.amount_due !== undefined) lines.push(`- **Amount due**: ${item.amount_due}`);
  if (item.payment_due_on) lines.push(`- **Payment due**: ${formatDate(item.payment_due_on)}`);
  if (item.payment_status) lines.push(`- **Payment status**: ${item.payment_status}`);
  return lines;
}

function makeAnnualReturnList(
  path: string,
  wrapperKey: "final_accounts_reports" | "corporation_tax_returns",
  heading: string
) {
  return async (
    client: FreeAgentApiClient,
    params: ListFinalAccountsReportsInput | ListCorporationTaxReturnsInput
  ): Promise<string> => {
    const response = await client.get<Record<string, FreeAgentAnnualReturn[]>>(path);
    const items = response.data[wrapperKey] ?? [];

    return formatResponse({ [wrapperKey]: items }, params.response_format, () => {
      const lines: string[] = [`# ${heading}`, ""];
      if (items.length === 0) {
        lines.push("None found.");
        return lines.join("\n");
      }
      for (const item of items) {
        lines.push(`## Period ending ${item.period_ends_on}`);
        lines.push(...renderAnnualReturnLines(item));
        lines.push("");
      }
      return lines.join("\n");
    });
  };
}

function makeAnnualReturnGet(
  pathPrefix: string,
  wrapperKey: "final_accounts_report" | "corporation_tax_return",
  heading: string
) {
  return async (
    client: FreeAgentApiClient,
    params: GetFinalAccountsReportInput | GetCorporationTaxReturnInput
  ): Promise<string> => {
    const response = await client.get<Record<string, FreeAgentAnnualReturn>>(
      `${pathPrefix}/${params.period_ends_on}`
    );
    const item = response.data[wrapperKey];

    return formatResponse({ [wrapperKey]: item }, params.response_format, () => {
      const lines = [`# ${heading}: period ending ${item.period_ends_on}`, ""];
      lines.push(...renderAnnualReturnLines(item));
      lines.push("", `**URL**: ${item.url}`);
      return lines.join("\n");
    });
  };
}

export const listFinalAccountsReports = makeAnnualReturnList(
  "/final_accounts_reports",
  "final_accounts_reports",
  "Final Accounts Reports"
);
export const getFinalAccountsReport = makeAnnualReturnGet(
  "/final_accounts_reports",
  "final_accounts_report",
  "Final Accounts Report"
);
export const listCorporationTaxReturns = makeAnnualReturnList(
  "/corporation_tax_returns",
  "corporation_tax_returns",
  "Corporation Tax Returns"
);
export const getCorporationTaxReturn = makeAnnualReturnGet(
  "/corporation_tax_returns",
  "corporation_tax_return",
  "Corporation Tax Return"
);

export async function listVatReturns(
  client: FreeAgentApiClient,
  params: ListVatReturnsInput
): Promise<string> {
  const response = await client.get<{ vat_returns: FreeAgentVatReturn[] }>("/vat_returns");
  const returns = response.data.vat_returns ?? [];

  return formatResponse({ vat_returns: returns }, params.response_format, () => {
    const lines: string[] = ["# VAT Returns", ""];
    if (returns.length === 0) {
      lines.push("No VAT returns found.");
      return lines.join("\n");
    }
    for (const vr of returns) {
      lines.push(`## Period ending ${vr.period_ends_on}`);
      lines.push(`- **Period**: ${formatDate(vr.period_starts_on ?? "")} to ${formatDate(vr.period_ends_on)}`);
      lines.push(`- **Filing status**: ${vr.filing_status ?? "-"}`);
      if (vr.filing_due_on) lines.push(`- **Filing due**: ${formatDate(vr.filing_due_on)}`);
      for (const p of vr.payments ?? []) {
        lines.push(
          `- **Payment** ${p.label ?? ""}: ${p.amount_due ?? "-"} due ${p.due_on ? formatDate(p.due_on) : "-"} (${p.status ?? "-"})` +
            (p.amount_due !== undefined && Number(p.amount_due) < 0 ? " — refund" : "")
        );
      }
      lines.push("");
    }
    return lines.join("\n");
  });
}

export async function getVatReturn(
  client: FreeAgentApiClient,
  params: GetVatReturnInput
): Promise<string> {
  const response = await client.get<{ vat_return: FreeAgentVatReturn }>(
    `/vat_returns/${params.period_ends_on}`
  );
  const vr = response.data.vat_return;

  return formatResponse({ vat_return: vr }, params.response_format, () => {
    const lines: string[] = [
      `# VAT Return: period ending ${vr.period_ends_on}`,
      "",
      `- **Period**: ${formatDate(vr.period_starts_on ?? "")} to ${formatDate(vr.period_ends_on)}`,
      `- **Filing status**: ${vr.filing_status ?? "-"}`,
    ];
    if (vr.filing_due_on) lines.push(`- **Filing due**: ${formatDate(vr.filing_due_on)}`);
    if (vr.filed_at) lines.push(`- **Filed at**: ${vr.filed_at}`);
    if (vr.filed_reference) lines.push(`- **Filed reference**: ${vr.filed_reference}`);

    if (vr.payments && vr.payments.length > 0) {
      lines.push("", "## Payments");
      for (const p of vr.payments) {
        lines.push(
          `- ${p.label ?? "Payment"}: ${p.amount_due ?? "-"} due ${p.due_on ? formatDate(p.due_on) : "-"} (${p.status ?? "-"})` +
            (p.amount_due !== undefined && Number(p.amount_due) < 0 ? " — refund" : "")
        );
      }
    }

    if (vr.breakdown?.rows && vr.breakdown.rows.length > 0) {
      lines.push("", `## ${vr.breakdown.title ?? "Breakdown"}`, "", "| Box | Title | Value |", "|---|---|---|");
      for (const row of vr.breakdown.rows) {
        lines.push(`| ${row.box_number ?? "-"} | ${row.title ?? "-"} | ${row.value ?? "-"} |`);
      }
    }

    lines.push("", `**URL**: ${vr.url}`);
    return lines.join("\n");
  });
}

export async function listSalesTaxPeriods(
  client: FreeAgentApiClient,
  params: ListSalesTaxPeriodsInput
): Promise<string> {
  const response = await client.get<{ sales_tax_periods: FreeAgentSalesTaxPeriod[] }>(
    "/sales_tax_periods"
  );
  const periods = response.data.sales_tax_periods ?? [];

  return formatResponse({ sales_tax_periods: periods }, params.response_format, () => {
    const lines: string[] = ["# Sales Tax Periods", ""];
    if (periods.length === 0) {
      lines.push("No sales tax periods found.");
      return lines.join("\n");
    }
    for (const p of periods) {
      lines.push(`## Effective from ${p.effective_date ?? "-"} (ID: ${extractIdFromUrl(p.url)})`);
      lines.push(`- **${p.sales_tax_name ?? "Tax"}**: ${p.sales_tax_registration_status ?? "-"}`);
      if (p.sales_tax_registration_number) lines.push(`- **Registration number**: ${p.sales_tax_registration_number}`);
      const rates = [p.sales_tax_rate_1, p.sales_tax_rate_2, p.sales_tax_rate_3].filter(
        (r) => r !== undefined && r !== null
      );
      if (rates.length > 0) lines.push(`- **Rates**: ${rates.join("%, ")}%`);
      if (p.sales_tax_is_value_added !== undefined) {
        lines.push(`- **Value added (reclaimable)**: ${p.sales_tax_is_value_added}`);
      }
      if (p.is_locked) lines.push(`- **Locked**: yes${p.locked_reason ? ` (${p.locked_reason})` : ""}`);
      lines.push("");
    }
    return lines.join("\n");
  });
}
