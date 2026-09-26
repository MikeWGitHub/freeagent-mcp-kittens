/**
 * Credit Note Tools (read-only fork addition).
 *
 * Credit notes are the other half of invoicing: FreeAgent creates them via
 * the invoice convert_to_credit_note transition, but without these tools they
 * were invisible to the MCP — cancellation chains had to be inferred from
 * long_status strings on the parent invoices (as happened live with the
 * Access UK 143/144/145 → 147/148/149 reconstruction, Jul 2026).
 */

import type { FreeAgentApiClient } from "../services/api-client.js";
import type { FreeAgentCreditNote } from "../types.js";
import type { ListCreditNotesInput, GetCreditNoteInput } from "../schemas/index.js";
import {
  formatDate,
  formatCurrency,
  formatResponse,
  truncateIfNeeded,
  createPaginationMetadata,
  extractIdFromUrl,
} from "../services/formatter.js";

export async function listCreditNotes(
  client: FreeAgentApiClient,
  params: ListCreditNotesInput
): Promise<string> {
  const queryParams: Record<string, string | number> = {
    page: params.page,
    per_page: params.per_page,
  };
  if (params.view) queryParams.view = params.view;
  if (params.contact) {
    queryParams.contact = client.resourceUrl("contacts", params.contact);
  }
  if (params.project) {
    queryParams.project = client.resourceUrl("projects", params.project);
  }
  if (params.sort) queryParams.sort = params.sort;
  if (params.nested_credit_note_items) queryParams.nested_credit_note_items = "true";

  const response = await client.get<{ credit_notes: FreeAgentCreditNote[] }>(
    "/credit_notes",
    queryParams
  );
  const creditNotes = response.data.credit_notes ?? [];
  const pagination = client.parsePaginationHeaders(response.headers, params.page, params.per_page);

  const formatted = formatResponse(
    {
      credit_notes: creditNotes,
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
      const lines: string[] = ["# FreeAgent Credit Notes", ""];

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

      if (creditNotes.length === 0) {
        lines.push("No credit notes found.");
        return lines.join("\n");
      }

      for (const cn of creditNotes) {
        const id = extractIdFromUrl(cn.url);
        lines.push(`## Credit Note ${cn.reference ?? id} (ID: ${id})`);
        lines.push(`- **Status**: ${cn.long_status ?? cn.status ?? "-"}`);
        lines.push(`- **Date**: ${formatDate(cn.dated_on)}`);
        if (cn.total_value) {
          lines.push(`- **Total**: ${formatCurrency(cn.total_value, cn.currency ?? "GBP")}`);
        }
        if (cn.due_value && parseFloat(cn.due_value) !== 0) {
          lines.push(`- **Still to refund**: ${formatCurrency(cn.due_value, cn.currency ?? "GBP")}`);
        }
        if (cn.po_reference) lines.push(`- **PO reference**: ${cn.po_reference}`);
        lines.push(`- **Contact**: ${extractIdFromUrl(cn.contact)}`);
        lines.push(`- **URL**: ${cn.url}`);
        lines.push("");
      }

      return lines.join("\n");
    }
  );

  return truncateIfNeeded(formatted, {
    count: creditNotes.length,
    total: pagination.totalCount,
  });
}

export async function getCreditNote(
  client: FreeAgentApiClient,
  params: GetCreditNoteInput
): Promise<string> {
  const endpoint = params.credit_note_id.startsWith("http")
    ? params.credit_note_id.replace(/^https?:\/\/[^/]+\/v2/, "")
    : `/credit_notes/${params.credit_note_id}`;

  const response = await client.get<{ credit_note: FreeAgentCreditNote }>(endpoint);
  const cn = response.data.credit_note;

  return formatResponse({ credit_note: cn }, params.response_format, () => {
    const id = extractIdFromUrl(cn.url);
    const currency = cn.currency ?? "GBP";
    const lines: string[] = [
      `# Credit Note: ${cn.reference ?? id}`,
      "",
      `**ID**: ${id}`,
      `**Status**: ${cn.long_status ?? cn.status ?? "-"}`,
      `**URL**: ${cn.url}`,
      "",
      "## Details",
      `- **Date**: ${formatDate(cn.dated_on)}`,
    ];
    if (cn.due_on) lines.push(`- **Due**: ${formatDate(cn.due_on)}`);
    if (cn.po_reference) lines.push(`- **PO reference**: ${cn.po_reference}`);
    if (cn.ec_status) lines.push(`- **EC status**: ${cn.ec_status}`);

    lines.push("", "## Amounts");
    if (cn.net_value) lines.push(`- **Net**: ${formatCurrency(cn.net_value, currency)}`);
    if (cn.sales_tax_value) lines.push(`- **Sales tax**: ${formatCurrency(cn.sales_tax_value, currency)}`);
    if (cn.total_value) lines.push(`- **Total**: ${formatCurrency(cn.total_value, currency)}`);
    if (cn.refunded_value) lines.push(`- **Refunded**: ${formatCurrency(cn.refunded_value, currency)}`);
    if (cn.due_value) lines.push(`- **Still to refund**: ${formatCurrency(cn.due_value, currency)}`);
    if (cn.refunded_on) lines.push(`- **Refunded on**: ${formatDate(cn.refunded_on)}`);
    if (cn.written_off_date) lines.push(`- **Written off**: ${formatDate(cn.written_off_date)}`);

    lines.push("", "## Related", `- **Contact**: ${cn.contact}`);
    if (cn.project) lines.push(`- **Project**: ${cn.project}`);

    if (cn.credit_note_items && cn.credit_note_items.length > 0) {
      lines.push("", "## Line Items");
      for (const item of cn.credit_note_items) {
        lines.push(`- **${item.description}**`);
        if (item.item_type) lines.push(`  - Type: ${item.item_type}`);
        if (item.quantity !== undefined && item.price !== undefined) {
          lines.push(`  - ${item.quantity} × ${formatCurrency(item.price, currency)}`);
        }
        if (item.sales_tax_rate) lines.push(`  - Sales tax rate: ${item.sales_tax_rate}%`);
      }
    }

    if (cn.comments) lines.push("", "## Comments", cn.comments);

    return lines.join("\n");
  });
}
