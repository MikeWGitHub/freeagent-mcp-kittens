/**
 * Capital Asset Tools (read-only fork addition).
 *
 * The FreeAgent API exposes capital assets read-only: assets are CREATED by
 * explaining a bank transaction (or bill/expense) against a capital asset
 * sub-category such as 602-1, optionally with a nested depreciation_profile.
 * These tools make the resulting asset register and its depreciation history
 * visible. Capital asset types support full CRUD but only list is exposed
 * here; managing custom types is a rare web-UI job.
 */

import type { FreeAgentApiClient } from "../services/api-client.js";
import type { FreeAgentCapitalAsset, FreeAgentCapitalAssetType } from "../types.js";
import type {
  ListCapitalAssetsInput,
  GetCapitalAssetInput,
  ListCapitalAssetTypesInput,
} from "../schemas/index.js";
import {
  formatDate,
  formatResponse,
  truncateIfNeeded,
  createPaginationMetadata,
  extractIdFromUrl,
} from "../services/formatter.js";

function describeProfile(asset: FreeAgentCapitalAsset): string | undefined {
  const p = asset.depreciation_profile;
  if (!p) return undefined;
  const bits: string[] = [p.method];
  if (p.asset_life_years) bits.push(`${p.asset_life_years} years`);
  if (p.annual_depreciation_percentage) bits.push(`${p.annual_depreciation_percentage}%/year`);
  if (p.frequency) bits.push(p.frequency);
  return bits.join(", ");
}

export async function listCapitalAssets(
  client: FreeAgentApiClient,
  params: ListCapitalAssetsInput
): Promise<string> {
  const queryParams: Record<string, string | number> = {
    page: params.page,
    per_page: params.per_page,
  };
  if (params.view) queryParams.view = params.view;
  if (params.include_history) queryParams.include_history = "true";

  const response = await client.get<{ capital_assets: FreeAgentCapitalAsset[] }>(
    "/capital_assets",
    queryParams
  );
  const assets = response.data.capital_assets ?? [];
  const pagination = client.parsePaginationHeaders(response.headers);

  const formatted = formatResponse(
    {
      capital_assets: assets,
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
      const lines: string[] = ["# FreeAgent Capital Assets", ""];

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

      if (assets.length === 0) {
        lines.push("No capital assets found.");
        return lines.join("\n");
      }

      for (const asset of assets) {
        const id = extractIdFromUrl(asset.url);
        lines.push(`## ${asset.description ?? `Asset ${id}`} (ID: ${id})`);
        if (asset.asset_type) lines.push(`- **Type**: ${asset.asset_type}`);
        if (asset.purchased_on) lines.push(`- **Purchased**: ${formatDate(asset.purchased_on)}`);
        if (asset.disposed_on) lines.push(`- **Disposed**: ${formatDate(asset.disposed_on)}`);
        const profile = describeProfile(asset);
        if (profile) lines.push(`- **Depreciation**: ${profile}`);
        if (asset.capital_asset_history && asset.capital_asset_history.length > 0) {
          lines.push(`- **History**:`);
          for (const event of asset.capital_asset_history) {
            lines.push(
              `  - ${event.date ?? "-"} ${event.type ?? ""}: ${event.value ?? "-"}` +
                (event.description ? ` (${event.description})` : "")
            );
          }
        }
        lines.push(`- **URL**: ${asset.url}`);
        lines.push("");
      }

      return lines.join("\n");
    }
  );

  return truncateIfNeeded(formatted, {
    count: assets.length,
    total: pagination.totalCount,
  });
}

export async function getCapitalAsset(
  client: FreeAgentApiClient,
  params: GetCapitalAssetInput
): Promise<string> {
  const id = params.capital_asset_id.startsWith("http")
    ? extractIdFromUrl(params.capital_asset_id)
    : params.capital_asset_id;

  const queryParams: Record<string, string> = {};
  if (params.include_history) queryParams.include_history = "true";

  const response = await client.get<{ capital_asset: FreeAgentCapitalAsset }>(
    `/capital_assets/${id}`,
    queryParams
  );
  const asset = response.data.capital_asset;

  return formatResponse({ capital_asset: asset }, params.response_format, () => {
    const lines: string[] = [
      `# Capital Asset: ${asset.description ?? extractIdFromUrl(asset.url)}`,
      "",
      `**URL**: ${asset.url}`,
      "",
    ];
    if (asset.asset_type) lines.push(`- **Type**: ${asset.asset_type}`);
    if (asset.purchased_on) lines.push(`- **Purchased**: ${formatDate(asset.purchased_on)}`);
    if (asset.disposed_on) lines.push(`- **Disposed**: ${formatDate(asset.disposed_on)}`);
    const profile = describeProfile(asset);
    if (profile) lines.push(`- **Depreciation**: ${profile}`);

    if (asset.capital_asset_history && asset.capital_asset_history.length > 0) {
      lines.push("", "## History", "", "| Date | Event | Value | Tax value | Detail |", "|---|---|---|---|---|");
      for (const event of asset.capital_asset_history) {
        lines.push(
          `| ${event.date ?? "-"} | ${event.type ?? "-"} | ${event.value ?? "-"} | ${event.tax_value ?? "-"} | ${event.description ?? "-"} |`
        );
      }
    }

    return lines.join("\n");
  });
}

export async function listCapitalAssetTypes(
  client: FreeAgentApiClient,
  params: ListCapitalAssetTypesInput
): Promise<string> {
  const response = await client.get<{ capital_asset_types: FreeAgentCapitalAssetType[] }>(
    "/capital_asset_types"
  );
  const types = response.data.capital_asset_types ?? [];

  return formatResponse({ capital_asset_types: types }, params.response_format, () => {
    const lines: string[] = ["# FreeAgent Capital Asset Types", ""];
    if (types.length === 0) {
      lines.push("No capital asset types found.");
      return lines.join("\n");
    }
    for (const t of types) {
      lines.push(
        `- **${t.name}**${t.system_default ? " (system default)" : " (custom)"} — ID ${extractIdFromUrl(t.url)}`
      );
    }
    return lines.join("\n");
  });
}
