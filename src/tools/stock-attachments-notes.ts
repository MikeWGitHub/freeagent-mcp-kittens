/**
 * Stock Items (read-only), Attachments (get/delete), and Notes (CRUD) —
 * fork additions.
 *
 * - Stock items are read-only in the FreeAgent API.
 * - Attachments have no list endpoint; their URLs surface on parent
 *   resources. get resolves the (time-limited) download URLs; delete
 *   permanently removes the file.
 * - Notes attach to exactly one contact or project and are the natural home
 *   for audit-trail commentary (e.g. why a write-off was reversed).
 */

import type { FreeAgentApiClient } from "../services/api-client.js";
import type { FreeAgentStockItem, FreeAgentAttachment, FreeAgentNote } from "../types.js";
import type {
  ListStockItemsInput,
  GetStockItemInput,
  GetAttachmentInput,
  DeleteAttachmentInput,
  ListNotesInput,
  CreateNoteInput,
  UpdateNoteInput,
  DeleteNoteInput,
} from "../schemas/index.js";
import {
  formatResponse,
  truncateIfNeeded,
  createPaginationMetadata,
  extractIdFromUrl,
} from "../services/formatter.js";

// ---------------------------------------------------------------------------
// Stock items
// ---------------------------------------------------------------------------

export async function listStockItems(
  client: FreeAgentApiClient,
  params: ListStockItemsInput
): Promise<string> {
  const queryParams: Record<string, string | number> = {
    page: params.page,
    per_page: params.per_page,
  };
  if (params.sort) queryParams.sort = params.sort;

  const response = await client.get<{ stock_items: FreeAgentStockItem[] }>(
    "/stock_items",
    queryParams
  );
  const items = response.data.stock_items ?? [];
  const pagination = client.parsePaginationHeaders(response.headers);

  const formatted = formatResponse(
    {
      stock_items: items,
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
      const lines: string[] = ["# FreeAgent Stock Items", ""];
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
      if (items.length === 0) {
        lines.push("No stock items found.");
        return lines.join("\n");
      }
      for (const item of items) {
        lines.push(`## ${item.description ?? "Stock item"} (ID: ${extractIdFromUrl(item.url)})`);
        if (item.stock_on_hand !== undefined) lines.push(`- **On hand**: ${item.stock_on_hand}`);
        if (item.opening_quantity !== undefined) lines.push(`- **Opening quantity**: ${item.opening_quantity}`);
        if (item.opening_balance !== undefined) lines.push(`- **Opening balance**: ${item.opening_balance}`);
        if (item.cost_of_sale_category) lines.push(`- **Cost of sale category**: ${item.cost_of_sale_category}`);
        lines.push("");
      }
      return lines.join("\n");
    }
  );

  return truncateIfNeeded(formatted, { count: items.length, total: pagination.totalCount });
}

export async function getStockItem(
  client: FreeAgentApiClient,
  params: GetStockItemInput
): Promise<string> {
  const id = params.stock_item_id.startsWith("http")
    ? extractIdFromUrl(params.stock_item_id)
    : params.stock_item_id;

  const response = await client.get<{ stock_item: FreeAgentStockItem }>(`/stock_items/${id}`);
  const item = response.data.stock_item;

  return formatResponse({ stock_item: item }, params.response_format, () => {
    const lines: string[] = [
      `# Stock Item: ${item.description ?? extractIdFromUrl(item.url)}`,
      "",
      `- **On hand**: ${item.stock_on_hand ?? "-"}`,
      `- **Opening quantity**: ${item.opening_quantity ?? "-"}`,
      `- **Opening balance**: ${item.opening_balance ?? "-"}`,
    ];
    if (item.cost_of_sale_category) lines.push(`- **Cost of sale category**: ${item.cost_of_sale_category}`);
    lines.push(`- **URL**: ${item.url}`);
    return lines.join("\n");
  });
}

// ---------------------------------------------------------------------------
// Attachments
// ---------------------------------------------------------------------------

export async function getAttachment(
  client: FreeAgentApiClient,
  params: GetAttachmentInput
): Promise<string> {
  const id = params.attachment_id.startsWith("http")
    ? extractIdFromUrl(params.attachment_id)
    : params.attachment_id;

  const response = await client.get<{ attachment: FreeAgentAttachment }>(`/attachments/${id}`);
  const att = response.data.attachment;

  return formatResponse({ attachment: att }, params.response_format, () => {
    const lines: string[] = [
      `# Attachment: ${att.file_name ?? extractIdFromUrl(att.url)}`,
      "",
      `- **Content type**: ${att.content_type ?? "-"}`,
      `- **Size**: ${att.file_size !== undefined ? `${att.file_size} bytes` : "-"}`,
    ];
    if (att.description) lines.push(`- **Description**: ${att.description}`);
    if (att.content_src) lines.push(`- **Download**: ${att.content_src}`);
    if (att.expires_at) lines.push(`- **Download URL expires**: ${att.expires_at} (re-fetch this attachment for fresh URLs after expiry)`);
    lines.push(`- **URL**: ${att.url}`);
    return lines.join("\n");
  });
}

export async function deleteAttachment(
  client: FreeAgentApiClient,
  params: DeleteAttachmentInput
): Promise<string> {
  const id = params.attachment_id.startsWith("http")
    ? extractIdFromUrl(params.attachment_id)
    : params.attachment_id;

  // Read before deleting so the reply carries an audit trail of what was removed.
  const before = await client.get<{ attachment: FreeAgentAttachment }>(`/attachments/${id}`);
  const att = before.data.attachment;

  await client.delete(`/attachments/${id}`);

  return (
    `🗑️ Deleted attachment ${id}.\n\n` +
    `Record of what was removed:\n` +
    `- **File name**: ${att.file_name ?? "-"}\n` +
    `- **Content type**: ${att.content_type ?? "-"}\n` +
    `- **Size**: ${att.file_size !== undefined ? `${att.file_size} bytes` : "-"}\n` +
    (att.description ? `- **Description**: ${att.description}\n` : "")
  );
}

// ---------------------------------------------------------------------------
// Notes
// ---------------------------------------------------------------------------

function parentQuery(
  client: FreeAgentApiClient,
  contact?: string,
  project?: string
): Record<string, string> {
  if (Boolean(contact) === Boolean(project)) {
    throw new Error("Provide exactly one of `contact` or `project` — notes belong to one parent.");
  }
  if (contact) {
    return { contact: client.resourceUrl("contacts", contact) };
  }
  return { project: client.resourceUrl("projects", project!) };
}

export async function listNotes(
  client: FreeAgentApiClient,
  params: ListNotesInput
): Promise<string> {
  const response = await client.get<{ notes: FreeAgentNote[] }>(
    "/notes",
    parentQuery(client, params.contact, params.project)
  );
  const notes = response.data.notes ?? [];

  return formatResponse({ notes }, params.response_format, () => {
    const lines: string[] = ["# Notes", ""];
    if (notes.length === 0) {
      lines.push("No notes found.");
      return lines.join("\n");
    }
    for (const note of notes) {
      lines.push(`## Note ${extractIdFromUrl(note.url)}`);
      if (note.author) lines.push(`- **Author**: ${note.author}`);
      if (note.created_at) lines.push(`- **Created**: ${note.created_at}`);
      lines.push("", note.note, "");
    }
    return lines.join("\n");
  });
}

export async function createNote(
  client: FreeAgentApiClient,
  params: CreateNoteInput
): Promise<string> {
  const query = parentQuery(client, params.contact, params.project);
  const queryString = new URLSearchParams(query).toString();

  const response = await client.post<{ note: FreeAgentNote }>(`/notes?${queryString}`, {
    note: { note: params.note },
  });
  const note = response.data.note;

  return (
    `✅ Note ${extractIdFromUrl(note.url)} created on ${params.contact ? "contact" : "project"}.\n\n` +
    `${note.note}`
  );
}

export async function updateNote(
  client: FreeAgentApiClient,
  params: UpdateNoteInput
): Promise<string> {
  const id = params.note_id.startsWith("http") ? extractIdFromUrl(params.note_id) : params.note_id;

  await client.put(`/notes/${id}`, { note: { note: params.note } });

  return `✅ Note ${id} updated.\n\n${params.note}`;
}

export async function deleteNote(
  client: FreeAgentApiClient,
  params: DeleteNoteInput
): Promise<string> {
  const id = params.note_id.startsWith("http") ? extractIdFromUrl(params.note_id) : params.note_id;

  // Read before deleting so the reply carries an audit trail of what was removed.
  const before = await client.get<{ note: FreeAgentNote }>(`/notes/${id}`);
  const note = before.data.note;

  await client.delete(`/notes/${id}`);

  return (
    `🗑️ Deleted note ${id}.\n\n` +
    `Record of what was removed:\n` +
    `- **Author**: ${note.author ?? "-"}\n` +
    `- **Parent**: ${note.parent_url ?? "-"}\n` +
    `- **Content**: ${note.note}`
  );
}
