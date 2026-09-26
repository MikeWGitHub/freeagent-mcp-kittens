/**
 * Price List Item Tools.
 *
 * Catalog entries that can be reused across invoices and estimates.
 */

import type { FreeAgentApiClient } from "../services/api-client.js";
import type { FreeAgentPriceListItem } from "../types.js";
import type {
  ListPriceListItemsInput,
  GetPriceListItemInput,
  CreatePriceListItemInput,
  UpdatePriceListItemInput,
} from "../schemas/index.js";
import {
  formatResponse,
  createPaginationMetadata,
  extractIdFromUrl,
} from "../services/formatter.js";

export async function listPriceListItems(
  client: FreeAgentApiClient,
  params: ListPriceListItemsInput
): Promise<string> {
  const { page, per_page, response_format } = params;

  const response = await client.get<{ price_list_items: FreeAgentPriceListItem[] }>(
    "/price_list_items",
    { page: page.toString(), per_page: per_page.toString() }
  );
  const items = response.data.price_list_items ?? [];
  const pagination = client.parsePaginationHeaders(response.headers, page, per_page);

  return formatResponse(
    {
      price_list_items: items,
      pagination: {
        page,
        per_page,
        total_count: pagination.totalCount,
        has_more: pagination.hasMore,
        next_page: pagination.nextPage,
      },
    },
    response_format,
    () => {
      const lines: string[] = ["# FreeAgent Price List", ""];
      if (pagination.totalCount !== undefined) {
        lines.push(
          createPaginationMetadata({
            page,
            perPage: per_page,
            totalCount: pagination.totalCount,
            hasMore: pagination.hasMore,
            nextPage: pagination.nextPage,
          })
        );
        lines.push("");
      }
      if (items.length === 0) {
        lines.push("No price list items found.");
        return lines.join("\n");
      }
      for (const item of items) {
        const id = extractIdFromUrl(item.url);
        lines.push(`- **${item.description}** (${item.item_type}): ${item.price} (ID: ${id})`);
      }
      return lines.join("\n");
    }
  );
}

export async function getPriceListItem(
  client: FreeAgentApiClient,
  params: GetPriceListItemInput
): Promise<string> {
  const { price_list_item_id, response_format } = params;
  const url = price_list_item_id.startsWith("http")
    ? price_list_item_id
    : `/price_list_items/${price_list_item_id}`;

  const response = await client.get<{ price_list_item: FreeAgentPriceListItem }>(url);
  const item = response.data.price_list_item;

  return formatResponse(
    item,
    response_format,
    () => {
      const lines = [`# Price List Item`, ""];
      lines.push(`- **Description**: ${item.description}`);
      lines.push(`- **Type**: ${item.item_type}`);
      lines.push(`- **Price**: ${item.price}`);
      if (item.sales_tax_rate) lines.push(`- **Sales tax rate**: ${item.sales_tax_rate}`);
      if (item.category) lines.push(`- **Category**: ${item.category}`);
      return lines.join("\n");
    }
  );
}

export async function createPriceListItem(
  client: FreeAgentApiClient,
  params: CreatePriceListItemInput
): Promise<string> {
  const payload: Record<string, unknown> = {
    description: params.description,
    price: params.price,
    item_type: params.item_type,
  };
  if (params.sales_tax_rate) payload.sales_tax_rate = params.sales_tax_rate;
  if (params.category) payload.category = params.category;

  const response = await client.post<{ price_list_item: FreeAgentPriceListItem }>(
    "/price_list_items",
    { price_list_item: payload }
  );
  const item = response.data.price_list_item;
  const id = extractIdFromUrl(item.url);

  return (
    `✅ Created price list item ${id}\n\n` +
    `**Description**: ${item.description}\n` +
    `**Type**: ${item.item_type}\n` +
    `**Price**: ${item.price}\n` +
    `**URL**: ${item.url}`
  );
}

/**
 * Update an existing price list (catalog) item. Only provided fields change.
 */
export async function updatePriceListItem(
  client: FreeAgentApiClient,
  params: UpdatePriceListItemInput
): Promise<string> {
  const id = params.price_list_item_id.startsWith("http")
    ? extractIdFromUrl(params.price_list_item_id)
    : params.price_list_item_id;

  const { price_list_item_id: _itemId, ...fields } = params;
  void _itemId;
  const itemData: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(fields)) {
    if (value !== undefined) itemData[key] = value;
  }
  if (Object.keys(itemData).length === 0) {
    throw new Error("No fields to update: provide at least one updatable field.");
  }

  const response = await client.put<{ price_list_item: FreeAgentPriceListItem }>(
    `/price_list_items/${id}`,
    { price_list_item: itemData }
  );
  const item = response.data.price_list_item;

  return (
    `\u2705 Price list item "${item.description}" updated (ID: ${id})\n\n` +
    `**Type**: ${item.item_type}\n` +
    `**Price**: ${item.price}\n` +
    `**URL**: ${item.url}`
  );
}
