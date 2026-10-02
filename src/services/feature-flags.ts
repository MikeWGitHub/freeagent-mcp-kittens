/**
 * Per-machine opt-in for tools that are off by default (v1.2.5).
 *
 * `freeagent_delete_bank_transaction` is only exposed where the machine opts
 * in, so a fresh clone (for example an unattended bookkeeping agent) never
 * gets it by accident and a lost setting fails safe.
 *
 * Opt in with either:
 * - `FREEAGENT_ENABLE_DELETE=true` (or `1`) in the MCP server's environment, or
 * - an empty file named `.freeagent-enable-delete` in the server's root folder
 *   (next to package.json). It is gitignored, so it survives `git pull` and
 *   rebuilds but never travels with the repo.
 *
 * `FREEAGENT_ENABLE_DELETE=false` (or `0`) turns it off even if the file exists.
 */

import { existsSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

export const DELETE_TOOL_NAME = "freeagent_delete_bank_transaction";
export const ENABLE_DELETE_ENV = "FREEAGENT_ENABLE_DELETE";
export const ENABLE_DELETE_MARKER = ".freeagent-enable-delete";

/** Server root: two levels up from src/services or dist/services. */
export const DEFAULT_MARKER_PATH = resolve(
  dirname(fileURLToPath(import.meta.url)),
  "..",
  "..",
  ENABLE_DELETE_MARKER
);

export function isDeleteEnabled(
  env: NodeJS.ProcessEnv = process.env,
  markerPath: string = DEFAULT_MARKER_PATH
): boolean {
  const raw = env[ENABLE_DELETE_ENV]?.trim().toLowerCase();
  if (raw === "true" || raw === "1") return true;
  if (raw === "false" || raw === "0") return false;
  return existsSync(markerPath);
}

export const DELETE_DISABLED_MESSAGE =
  `freeagent_delete_bank_transaction is turned off on this machine. To turn it on, set ${ENABLE_DELETE_ENV}=true ` +
  `in this MCP server's environment or create an empty ${ENABLE_DELETE_MARKER} file in the server folder, then restart the client.`;
