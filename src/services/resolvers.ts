/**
 * Shared resolvers for intent-bundle tools.
 *
 * These take a human-friendly hint (name, code, email) and return the canonical
 * FreeAgent URL required by the API. Keeping them here lets multiple tools
 * (reconcile_bank_transaction, log_expense, ...) share one lookup strategy and
 * one set of error messages.
 */

import type { FreeAgentApiClient } from "./api-client.js";
import { fetchAllPages } from "./api-client.js";
import type { FreeAgentBill, FreeAgentCategory, FreeAgentContact, FreeAgentUser } from "../types.js";

interface CategoryListResponse {
  admin_expenses_categories?: FreeAgentCategory[];
  cost_of_sales_categories?: FreeAgentCategory[];
  income_categories?: FreeAgentCategory[];
  general_categories?: FreeAgentCategory[];
}

function flattenCategories(data: CategoryListResponse): FreeAgentCategory[] {
  return [
    ...(data.admin_expenses_categories ?? []),
    ...(data.cost_of_sales_categories ?? []),
    ...(data.income_categories ?? []),
    ...(data.general_categories ?? []),
  ];
}

/**
 * GET /categories/:nominal_code wraps the result under a key that depends on
 * the category's type (income_categories, admin_expenses_categories, ...),
 * NOT under "category" (dev.freeagent.com/docs/categories). Accept any of the
 * known keys, tolerating both object and single-element array. Shared with
 * getCategory in tools/categories.ts, which read the wrong key until Jul 2026
 * (audit B-CRIT-1).
 */
export function unwrapSingleCategory(
  data: Record<string, FreeAgentCategory | FreeAgentCategory[] | undefined>
): FreeAgentCategory | undefined {
  const wrapped =
    data.category ??
    data.income_categories ??
    data.cost_of_sales_categories ??
    data.admin_expenses_categories ??
    data.general_categories;
  return Array.isArray(wrapped) ? wrapped[0] : wrapped;
}

/**
 * Resolve a category hint (URL, nominal code, name) to its canonical URL.
 *
 * Prefers an exact case-insensitive match on description before falling back
 * to substring matching. Throws a clear, suggestion-rich error when the hint
 * is ambiguous or matches nothing.
 */
export async function resolveCategory(
  client: FreeAgentApiClient,
  hint: string
): Promise<string> {
  if (hint.startsWith("http")) return hint;

  // Nominal codes, including sub-coded accounts such as 602-3 (capital asset
  // types), 750-1 (banks) or 902-1 (users), resolve via GET /categories/:code.
  if (/^\d+(-\d+)?$/.test(hint)) {
    const category = unwrapSingleCategory(
      (await client.get<Record<string, FreeAgentCategory | FreeAgentCategory[] | undefined>>(
        `/categories/${hint}`
      )).data
    );
    if (!category?.url) {
      throw new Error(
        `Category ${hint} was returned in an unrecognised shape. ` +
        `Pass the category name or full URL instead, or check dev.freeagent.com/docs/categories.`
      );
    }
    return category.url;
  }

  // Name search: top-level categories first; fall back to sub-accounts
  // (sub_accounts=true replaces e.g. 602 with 602-1..602-4) so names such as
  // "Motor Vehicle Purchase" can be found too.
  const response = await client.get<CategoryListResponse>("/categories");
  const lower = hint.toLowerCase();
  let all = flattenCategories(response.data);
  if (!all.some((c) => c.description.toLowerCase().includes(lower))) {
    const sub = await client.get<CategoryListResponse>("/categories", { sub_accounts: true });
    all = flattenCategories(sub.data);
  }

  const exact = all.filter((c) => c.description.toLowerCase() === lower);
  if (exact.length === 1) return exact[0].url;
  if (exact.length > 1) {
    const codes = exact.map((c) => `${c.nominal_code} (${c.description})`).join(", ");
    throw new Error(
      `Category name "${hint}" is ambiguous. Matches: ${codes}. Pass the nominal code instead.`
    );
  }

  const partial = all.filter((c) => c.description.toLowerCase().includes(lower));
  if (partial.length === 1) return partial[0].url;
  if (partial.length > 1) {
    const suggestions = partial
      .slice(0, 8)
      .map((c) => `${c.nominal_code} (${c.description})`)
      .join(", ");
    throw new Error(
      `Category name "${hint}" matches multiple categories: ${suggestions}. ` +
        `Pass the nominal code or the exact description.`
    );
  }

  throw new Error(
    `No category matches "${hint}". Call freeagent_list_categories to see available categories.`
  );
}

/**
 * Resolve a user hint (URL, numeric ID, email) to its canonical URL. When
 * `hint` is undefined, returns the sole user on the account, or throws if
 * there are zero or many users.
 */
export async function resolveUser(
  client: FreeAgentApiClient,
  hint?: string
): Promise<string> {
  if (hint?.startsWith("http")) return hint;

  if (hint && /^\d+$/.test(hint)) {
    const response = await client.get<{ user: FreeAgentUser }>(`/users/${hint}`);
    return response.data.user.url;
  }

  const response = await client.get<{ users: FreeAgentUser[] }>("/users");
  const users = response.data.users ?? [];

  if (hint) {
    const lower = hint.toLowerCase();
    const matches = users.filter(
      (u) =>
        u.email.toLowerCase() === lower ||
        `${u.first_name} ${u.last_name}`.toLowerCase() === lower
    );
    if (matches.length === 1) return matches[0].url;
    if (matches.length > 1) {
      throw new Error(
        `User "${hint}" is ambiguous across ${matches.length} accounts. Pass the user ID or URL.`
      );
    }
    throw new Error(
      `No user matches "${hint}". Call freeagent_list_users to see available users.`
    );
  }

  if (users.length === 1) return users[0].url;
  if (users.length === 0) {
    throw new Error("No users found on this FreeAgent account.");
  }
  throw new Error(
    `This account has ${users.length} users; pass the \`user\` parameter (email, ID, or URL) to disambiguate.`
  );
}

function contactLabel(c: FreeAgentContact): string {
  if (c.organisation_name) return c.organisation_name;
  const parts = [c.first_name, c.last_name].filter(Boolean);
  return parts.join(" ") || "Unnamed contact";
}

/**
 * Resolve a contact hint (URL, numeric ID, organisation or person name) to
 * its canonical URL.
 */
export async function resolveContact(
  client: FreeAgentApiClient,
  hint: string
): Promise<string> {
  if (hint.startsWith("http")) return hint;

  if (/^\d+$/.test(hint)) {
    const response = await client.get<{ contact: FreeAgentContact }>(
      `/contacts/${hint}`
    );
    return response.data.contact.url;
  }

  // Page through ALL contacts: a first-page-only read matched the wrong (or
  // no) contact for accounts with >100 contacts (audit B-HIGH-3).
  const { items: contacts, capped } = await fetchAllPages<FreeAgentContact>(client, "/contacts", {}, "contacts");
  const lower = hint.toLowerCase();

  const exact = contacts.filter((c) => contactLabel(c).toLowerCase() === lower);
  if (exact.length === 1) return exact[0].url;
  if (exact.length > 1) {
    throw new Error(
      `Contact name "${hint}" matches ${exact.length} contacts exactly. Pass the contact ID or URL.`
    );
  }

  const partial = contacts.filter((c) =>
    contactLabel(c).toLowerCase().includes(lower)
  );
  if (partial.length === 1) return partial[0].url;
  if (partial.length > 1) {
    const suggestions = partial
      .slice(0, 8)
      .map(contactLabel)
      .join(", ");
    throw new Error(
      `Contact "${hint}" matches multiple contacts: ${suggestions}. Pass the contact ID or URL.`
    );
  }

  throw new Error(
    `No contact matches "${hint}" (searched ${contacts.length} contacts${capped ? ", list capped at 1000 — pass an ID or URL" : ""}). ` +
    `Call freeagent_list_contacts to see available contacts.`
  );
}

/**
 * Resolve a bill hint (URL, numeric ID, reference) to its canonical URL.
 * When `hint` looks like a reference, only open/overdue bills are searched.
 */
export async function resolveBill(
  client: FreeAgentApiClient,
  hint: string
): Promise<string> {
  if (hint.startsWith("http")) return hint;

  if (/^\d+$/.test(hint)) {
    const response = await client.get<{ bill: FreeAgentBill }>(`/bills/${hint}`);
    return response.data.bill.url;
  }

  // Page through all open bills, not just the first 100 (audit B-HIGH-3).
  const { items: bills, pagesFetched, capped } = await fetchAllPages<FreeAgentBill>(client, "/bills", { view: "open" }, "bills");
  const matches = bills.filter((b) => b.reference === hint);

  if (matches.length === 1) return matches[0].url;
  if (matches.length > 1) {
    throw new Error(
      `Bill reference "${hint}" matches ${matches.length} open bills. Pass the bill ID or URL instead.`
    );
  }
  throw new Error(
    `No open bill has reference "${hint}" (searched ${bills.length} open bills across ${pagesFetched} page(s)${capped ? ", capped" : ""}). ` +
    `Check the reference, or pass the bill ID/URL directly.`
  );
}

/**
 * Capital asset categories 601-607 need a capital_asset_type on journal entries
 * (dev.freeagent.com/docs/journal_sets); FreeAgent answers a bare 602 with a
 * misleading 404. Stock categories need stock_item + stock_altering_quantity.
 */
const CAPITAL_ASSET_CODE = /^60[1-7]$/;

function nominalCodeFromCategory(hintOrUrl: string): string | undefined {
  const m = hintOrUrl.match(/(?:^|\/categories\/)(\d+(?:-\d+)?)$/);
  return m ? m[1] : undefined;
}

/**
 * Resolve a capital asset type hint (URL, numeric ID, or name such as
 * "Motor Vehicles") to its URL.
 */
export async function resolveCapitalAssetType(
  client: FreeAgentApiClient,
  hint: string
): Promise<string> {
  if (hint.startsWith("http")) return hint;
  if (/^\d+$/.test(hint)) return client.resourceUrl("capital_asset_types", hint);
  const response = await client.get<{ capital_asset_types?: { url: string; name: string }[] }>(
    "/capital_asset_types"
  );
  const types = response.data.capital_asset_types ?? [];
  const lower = hint.toLowerCase();
  const exact = types.filter((t) => t.name.toLowerCase() === lower);
  const matches = exact.length > 0 ? exact : types.filter((t) => t.name.toLowerCase().includes(lower));
  if (matches.length === 1) return matches[0].url;
  const names = types.map((t) => t.name).join(", ");
  throw new Error(
    matches.length > 1
      ? `Capital asset type "${hint}" is ambiguous. Choose one of: ${names}.`
      : `No capital asset type matches "${hint}". Available: ${names}.`
  );
}

/**
 * Resolve a journal entry's category, adding capital_asset_type where FreeAgent
 * requires it. A sub-coded capital asset category ("602-3") is sent as its
 * parent category plus the sub-account's capital_asset_type, mirroring how
 * user categories are sent as the parent (902) plus a user.
 */
export async function resolveJournalCategory(
  client: FreeAgentApiClient,
  hint: string,
  capitalAssetTypeHint?: string
): Promise<{ category: string; capital_asset_type?: string }> {
  const code = nominalCodeFromCategory(hint);
  const sub = code?.match(/^(60[1-7])-(\d+)$/);
  if (sub) {
    const category = unwrapSingleCategory(
      (await client.get<Record<string, FreeAgentCategory | FreeAgentCategory[] | undefined>>(
        `/categories/${code}`
      )).data
    ) as (FreeAgentCategory & { capital_asset_type?: string }) | undefined;
    const typeUrl = capitalAssetTypeHint
      ? await resolveCapitalAssetType(client, capitalAssetTypeHint)
      : category?.capital_asset_type;
    if (!typeUrl) {
      throw new Error(
        `Category ${code} did not return a capital_asset_type. Pass capital_asset_type explicitly (e.g. 'Motor Vehicles').`
      );
    }
    return { category: client.resourceUrl("categories", sub[1]), capital_asset_type: typeUrl };
  }

  const url = await resolveCategory(client, hint);
  const resolvedCode = nominalCodeFromCategory(url) ?? code;
  if (resolvedCode && CAPITAL_ASSET_CODE.test(resolvedCode)) {
    if (!capitalAssetTypeHint) {
      throw new Error(
        `Category ${resolvedCode} is a capital asset category: FreeAgent requires a capital asset type. ` +
          `Pass the sub-coded category (e.g. '${resolvedCode}-3' for Motor Vehicles; see freeagent_list_categories with sub_accounts: true) ` +
          `or set capital_asset_type (e.g. 'Motor Vehicles').`
      );
    }
    return { category: url, capital_asset_type: await resolveCapitalAssetType(client, capitalAssetTypeHint) };
  }
  return capitalAssetTypeHint
    ? { category: url, capital_asset_type: await resolveCapitalAssetType(client, capitalAssetTypeHint) }
    : { category: url };
}
