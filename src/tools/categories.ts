import { FreeAgentApiClient } from "../services/api-client.js";
import { ResponseFormat } from "../constants.js";
import type { FreeAgentCategory } from "../types.js";
import { unwrapSingleCategory } from "../services/resolvers.js";

/**
 * auto_sales_tax_rate is a number for some accounts but a descriptive string
 * ("Standard rate") for others; multiplying the string produced "NaN%"
 * (audit B-MED-2). Render numbers as percentages and strings verbatim.
 */
export function formatAutoSalesTaxRate(rate: number | string): string {
  const n = typeof rate === "number" ? rate : Number(rate);
  // FreeAgent rates are percentages ("20.0"); only a value in (0, 1) looks like
  // a fraction, so scale that one and show everything else as-is (v1.2.3:
  // a numeric 20 used to render as 2000.0%).
  if (Number.isFinite(n)) return `${(n > 0 && n < 1 ? n * 100 : n).toFixed(1)}%`;
  return String(rate);
}
import type { ListCategoriesInput, GetCategoryInput } from "../schemas/index.js";

/**
 * List all categories in FreeAgent
 */
export async function listCategories(
  apiClient: FreeAgentApiClient,
  params: ListCategoriesInput
): Promise<string> {
  const response = await apiClient.get<Record<string, FreeAgentCategory[]>>(
    "/categories",
    params.sub_accounts ? { sub_accounts: true } : undefined
  );

  // Categories are returned in four separate arrays
  const adminExpenses = response.data.admin_expenses_categories || [];
  const costOfSales = response.data.cost_of_sales_categories || [];
  const income = response.data.income_categories || [];
  const general = response.data.general_categories || [];

  // Combine all categories based on view filter
  let allCategories: (FreeAgentCategory & { type: string })[] = [];

  if (!params.view || params.view === "all") {
    allCategories = [
      ...adminExpenses.map((c: FreeAgentCategory) => ({ ...c, type: "Admin Expenses" })),
      ...costOfSales.map((c: FreeAgentCategory) => ({ ...c, type: "Cost of Sales" })),
      ...income.map((c: FreeAgentCategory) => ({ ...c, type: "Income" })),
      ...general.map((c: FreeAgentCategory) => ({ ...c, type: "General" }))
    ];
  } else if (params.view === "standard") {
    // Standard categories are the first three types
    allCategories = [
      ...adminExpenses.map((c: FreeAgentCategory) => ({ ...c, type: "Admin Expenses" })),
      ...costOfSales.map((c: FreeAgentCategory) => ({ ...c, type: "Cost of Sales" })),
      ...income.map((c: FreeAgentCategory) => ({ ...c, type: "Income" }))
    ];
  } else if (params.view === "custom") {
    // Custom categories would typically be in general
    allCategories = general.map((c: FreeAgentCategory) => ({ ...c, type: "General" }));
  }

  if (allCategories.length === 0) {
    return "No categories found.";
  }

  if (params.response_format === ResponseFormat.JSON) {
    return JSON.stringify({
      admin_expenses_categories: adminExpenses,
      cost_of_sales_categories: costOfSales,
      income_categories: income,
      general_categories: general,
      total_count: allCategories.length
    }, null, 2);
  }

  const categoryList = allCategories
    .map((category: FreeAgentCategory & { type: string }) => {
      const parts = [
        `Category: ${category.description}`,
        `  Type: ${category.type}`,
        `  Nominal Code: ${category.nominal_code}`,
        `  URL: ${category.url}`,
      ];

      if (category.group_description) {
        parts.push(`  Group: ${category.group_description}`);
      }

      if (category.allowable_for_tax !== undefined) {
        parts.push(`  Allowable for Tax: ${category.allowable_for_tax ? "Yes" : "No"}`);
      }

      if (category.tax_reporting_name) {
        parts.push(`  Tax Reporting: ${category.tax_reporting_name}`);
      }

      if (category.auto_sales_tax_rate !== undefined) {
        parts.push(`  Auto Sales Tax Rate: ${formatAutoSalesTaxRate(category.auto_sales_tax_rate)}`);
      }

      return parts.join("\n");
    })
    .join("\n\n");

  return `Found ${allCategories.length} category(ies):\n\n${categoryList}`;
}

/**
 * Get details of a specific category
 */
export async function getCategory(
  apiClient: FreeAgentApiClient,
  params: GetCategoryInput
): Promise<string> {
  const nominalCode = params.nominal_code.replace(/^.*\/categories\//, "");
  // The single-category endpoint wraps its result under a type-dependent key
  // (income_categories, admin_expenses_categories, ...), never "category".
  // Reading response.data.category made this tool systematically return
  // undefined fields (audit B-CRIT-1); share the resolver's unwrap instead.
  const response = await apiClient.get<Record<string, FreeAgentCategory | FreeAgentCategory[] | undefined>>(
    `/categories/${nominalCode}`
  );
  const category = unwrapSingleCategory(response.data);
  if (!category) {
    throw new Error(
      `Category ${nominalCode} was returned in an unrecognised shape or does not exist. ` +
      `Call freeagent_list_categories to see available nominal codes.`
    );
  }

  if (params.response_format === ResponseFormat.JSON) {
    return JSON.stringify(category, null, 2);
  }

  const details = [
    `Category Details:`,
    `  Description: ${category.description}`,
    `  Nominal Code: ${category.nominal_code}`,
    `  URL: ${category.url}`,
  ];

  if (category.group_description) {
    details.push(`  Group: ${category.group_description}`);
  }

  if (category.allowable_for_tax !== undefined) {
    details.push(`  Allowable for Tax: ${category.allowable_for_tax ? "Yes" : "No"}`);
  }

  if (category.tax_reporting_name) {
    details.push(`  Tax Reporting Name: ${category.tax_reporting_name}`);
  }

  if (category.auto_sales_tax_rate !== undefined) {
    details.push(`  Auto Sales Tax Rate: ${formatAutoSalesTaxRate(category.auto_sales_tax_rate)}`);
  }

  if (category.bank_account) {
    details.push(`  Bank Account: ${category.bank_account}`);
  }

  if (category.capital_asset_type) {
    details.push(`  Capital Asset Type: ${category.capital_asset_type}`);
  }

  if (category.user) {
    details.push(`  User: ${category.user}`);
  }

  if (category.created_at) details.push(`  Created: ${category.created_at}`);
  if (category.updated_at) details.push(`  Updated: ${category.updated_at}`);

  return details.join("\n");
}
