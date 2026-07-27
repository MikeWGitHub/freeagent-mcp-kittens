/**
 * Company and User Information Tools
 */

import type { FreeAgentApiClient } from "../services/api-client.js";
import type { FreeAgentCompany, FreeAgentUser } from "../types.js";
import {
  formatDate,
  formatResponse,
  truncateIfNeeded
} from "../services/formatter.js";
import type { GetCompanyInput, ListUsersInput, GetUserInput, ListEmailAddressesInput } from "../schemas/index.js";

/**
 * Get company information
 */
export async function getCompany(
  client: FreeAgentApiClient,
  params: GetCompanyInput
): Promise<string> {
  const response = await client.get<{ company: FreeAgentCompany }>("/company");
  const company = response.data.company;

  const formattedResponse = formatResponse(
    { company },
    params.response_format,
    () => {
      const lines: string[] = [
        `# Company: ${company.name}`,
        "",
        `**Subdomain**: ${company.subdomain}`,
        `**Type**: ${company.type}`,
        `**Currency**: ${company.currency}`,
        "",
        "## Key Dates",
        `- **Company Start**: ${formatDate(company.company_start_date)}`,
        `- **FreeAgent Start**: ${formatDate(company.freeagent_start_date)}`,
        `- **First Year End**: ${formatDate(company.first_accounting_year_end)}`,
        ""
      ];

      if (company.company_registration_number) {
        lines.push(`**Registration Number**: ${company.company_registration_number}`, "");
      }

      lines.push("## Tax & Accounting");
      lines.push(`- **Sales Tax Status**: ${company.sales_tax_registration_status}`);
      lines.push(`- **Mileage Units**: ${company.mileage_units}`);

      return lines.join("\n");
    }
  );

  return formattedResponse;
}

/**
 * List all users
 */
export async function listUsers(
  client: FreeAgentApiClient,
  params: ListUsersInput
): Promise<string> {
  const response = await client.get<{ users: FreeAgentUser[] }>("/users");
  const users = response.data.users || [];

  const formattedResponse = formatResponse(
    { users },
    params.response_format,
    () => {
      const lines: string[] = ["# FreeAgent Users", ""];

      if (users.length === 0) {
        lines.push("No users found.");
        return lines.join("\n");
      }

      for (const user of users) {
        lines.push(`## ${user.first_name} ${user.last_name}`);
        lines.push(`- **Email**: ${user.email}`);
        lines.push(`- **Role**: ${user.role}`);
        lines.push(`- **Permission Level**: ${user.permission_level}`);
        lines.push(`- **URL**: ${user.url}`);
        lines.push("");
      }

      return lines.join("\n");
    }
  );

  return truncateIfNeeded(formattedResponse, { count: users.length });
}

/**
 * Get a single user by ID, URL, or 'me' (the authenticated user).
 */
export async function getUser(
  client: FreeAgentApiClient,
  params: GetUserInput
): Promise<string> {
  const endpoint = params.user_id === "me"
    ? "/users/me"
    : params.user_id.startsWith("http")
      ? params.user_id.replace(/^https?:\/\/[^/]+\/v2/, "")
      : `/users/${params.user_id}`;

  const response = await client.get<{ user: FreeAgentUser }>(endpoint);
  const user = response.data.user;

  return formatResponse({ user }, params.response_format, () => {
    const lines: string[] = [
      `# User: ${user.first_name} ${user.last_name}`,
      "",
      `- **Email**: ${user.email}`,
      `- **Role**: ${user.role}`,
      `- **Permission level**: ${user.permission_level}`,
      `- **URL**: ${user.url}`,
    ];
    return lines.join("\n");
  });
}

/**
 * List the account's verified sender email addresses (the addresses
 * FreeAgent is allowed to send invoices/estimates from).
 */
export async function listEmailAddresses(
  client: FreeAgentApiClient,
  params: ListEmailAddressesInput
): Promise<string> {
  const response = await client.get<{ email_addresses: string[] }>("/email_addresses");
  const addresses = response.data.email_addresses ?? [];

  return formatResponse({ email_addresses: addresses }, params.response_format, () => {
    const lines: string[] = ["# Verified Sender Email Addresses", ""];
    if (addresses.length === 0) {
      lines.push("No verified sender email addresses found.");
    } else {
      for (const address of addresses) lines.push(`- ${address}`);
    }
    return lines.join("\n");
  });
}
