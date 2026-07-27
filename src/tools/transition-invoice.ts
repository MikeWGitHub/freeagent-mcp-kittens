/**
 * Transition a FreeAgent invoice between lifecycle states.
 *
 * Wraps PUT /v2/invoices/:id/transitions/:action with no request body.
 * Supported actions mirror FreeAgent's UI: mark_as_sent, mark_as_cancelled,
 * mark_as_draft, mark_as_scheduled, convert_to_credit_note.
 */

import type { FreeAgentApiClient } from "../services/api-client.js";
import type { FreeAgentInvoice } from "../types.js";
import type { TransitionInvoiceInput } from "../schemas/index.js";
import { extractIdFromUrl } from "../services/formatter.js";

export async function transitionInvoice(
  client: FreeAgentApiClient,
  params: TransitionInvoiceInput
): Promise<string> {
  // mark_as_cancelled WRITES OFF a sent invoice as unpaid (it does not merely
  // void it) and reversing it via the API is undocumented — observed live:
  // invoice 142 written off in error, Apr 2026. Gate it behind an explicit
  // confirm (audit S-MED-2).
  if (params.action === "mark_as_cancelled" && params.confirm !== true) {
    throw new Error(
      "mark_as_cancelled writes the invoice off as unpaid, which has accounting consequences " +
      "and is hard to reverse via the API. Confirm with the user, then re-call with confirm: true."
    );
  }
  const id = params.invoice_id.startsWith("http")
    ? extractIdFromUrl(params.invoice_id)
    : params.invoice_id;

  const path = `/invoices/${id}/transitions/${params.action}`;
  const response = await client.put<{ invoice: FreeAgentInvoice }>(path);
  const invoice = response.data.invoice;

  return (
    `✅ ${params.action} applied to invoice ${extractIdFromUrl(invoice.url)}\n\n` +
    `**Status**: ${invoice.status}\n` +
    `**Date**: ${invoice.dated_on}\n` +
    `**Total**: ${invoice.currency} ${invoice.total_value}\n` +
    `**URL**: ${invoice.url}`
  );
}
