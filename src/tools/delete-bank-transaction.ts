/**
 * Bank transaction delete (fork addition, Oct 2026).
 *
 * Until v1.2.3 the design rule was "no tool may ever delete a bank
 * transaction". Two real cases on 2 Oct 2026 needed it:
 *
 * - FreeAgent-created transfer counterparts. Explaining one side of a transfer
 *   when the real other side is already explained makes FreeAgent invent a
 *   manual "///" transaction in the other account, which throws both balances
 *   out.
 * - Duplicates from overlapping bank feed and statement uploads.
 *
 * The rule is now "delete only with guards". Every refusal happens before the
 * first change, so a refusal never leaves the books half-edited:
 *
 * - confirm: true plus a written reason, echoed in the reply and the log.
 * - Manual transactions only, unless allow_imported: true together with
 *   duplicate_of, the imported copy to keep. It must be in the same account,
 *   for the same amount, dated within 3 days, with an identical normalised
 *   description,
 *   and still exist. Imported rows mirror the bank's own record, so deleting
 *   the wrong one moves the balance away from the bank.
 * - FreeAgent only deletes unexplained transactions. Explanations are removed
 *   first only with delete_explanations: true. Every explanation, and the
 *   partner explanation of any transfer, is re-read in full and refused if it
 *   carries a paid_* link (invoice, bill, user and so on), an asset, stock,
 *   property or rebill link, is_deletable: false, a receipt attachment, or a
 *   lock. The only locks allowed are the structural ones every transfer
 *   explanation carries.
 *
 * The final delete isn't atomic: FreeAgent can still reject it after the
 * explanations have gone. So once anything has changed, every exit re-reads
 * the transaction and reports its real state (gone, still there, or
 * unknown), the full pre-change records of everything removed or possibly
 * removed, and the transfer partner's actual state. "Deleted" is reported only
 * when a GET of the transaction returns 404.
 *
 * Not yet verified against the live API, and handled whichever way it goes:
 * - whether deleting one side of a transfer explanation removes, or just
 *   unpairs, the partner explanation (the partner's transaction is re-read
 *   and its actual state reported);
 * - whether FreeAgent removes a manual transaction together with its last
 *   explanation (the transaction is re-read before the delete call);
 *
 * The delete route is the plural DELETE /v2/bank_transactions/:id, matching
 * GET. The docs show a singular /v2/bank_transaction/:id under a heading
 * about deleting an explanation; calling an ambiguous route with a
 * transaction ID could hit an unrelated record, so it is never used.
 */

import type { FreeAgentApiClient } from "../services/api-client.js";
import { isNotFoundError } from "../services/api-client.js";
import type { DeleteBankTransactionInput } from "../schemas/index.js";
import type { FreeAgentBankTransactionExplanation } from "../types.js";
import { extractIdFromUrl } from "../services/formatter.js";

type ExplanationForDelete = FreeAgentBankTransactionExplanation & {
  bank_account?: string;
  entry_type?: string;
  is_deletable?: boolean;
  is_locked?: boolean;
  locked_attributes?: string[];
  linked_transfer_explanation?: string;
  has_pending_operation?: boolean;
  attachment?: unknown;
  /** From 1 Dec 2026 FreeAgent's default payload returns this instead of `attachment`. */
  attachments?: unknown[];
};

interface TransactionForDelete {
  url: string;
  bank_account: string;
  dated_on: string;
  amount?: string;
  unexplained_amount?: string;
  description?: string;
  is_manual?: boolean;
  bank_transaction_explanations?: Array<string | { url: string }>;
}

interface ParsedId {
  id: string;
  /** Host of the URL the caller passed, if they passed a URL. */
  host?: string;
}

interface PartnerInfo {
  account?: string;
  explanationId?: string;
  transactionId?: string;
  record?: ExplanationForDelete;
}

type FinalState =
  | { kind: "gone" }
  | { kind: "exists"; tx: TransactionForDelete }
  | { kind: "unknown"; error: string };

/** Locks every transfer explanation carries; they don't block a transfer's delete. */
const TRANSFER_STRUCTURAL_LOCKS = new Set(["type", "linked_transfer_account", "transfer_value"]);

/** Links besides paid_* whose removal would silently break other records. */
const OTHER_LINK_KEYS = [
  "direct_contact",
  "capital_asset",
  "disposed_asset",
  "stock_item",
  "property",
  "rebill_type",
  "rebill_to_project",
] as const;

/** How far apart (in days) a duplicate and the copy kept may be dated. */
const DUPLICATE_WINDOW_DAYS = 3;

/** Minimum normalised description length for the duplicate check. */
const DESCRIPTION_MIN_CHARS = 6;

const NOTHING_DELETED = "Nothing was deleted.";

const TRANSFER_ADVICE =
  "Before explaining that partner as a transfer again, make sure its real counterpart is " +
  "unexplained, so FreeAgent pairs the two instead of creating another '///' transaction.";

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function toId(idOrUrl: string): string {
  return idOrUrl.startsWith("http") ? extractIdFromUrl(idOrUrl) : idOrUrl;
}

function hostOf(url: string): string | undefined {
  try {
    return new URL(url).host.toLowerCase();
  } catch {
    return undefined;
  }
}

/** Accepts a numeric ID or a .../v2/bank_transactions/:id URL, nothing else. */
export function parseBankTransactionId(input: string, label = "bank_transaction_id"): ParsedId {
  const value = input.trim();
  if (/^\d+$/.test(value)) return { id: value };
  const match = value.match(/^https?:\/\/([^/]+)\/v2\/bank_transactions\/(\d+)\/?$/);
  if (match) return { id: match[2], host: match[1].toLowerCase() };
  throw new Error(
    `${label} must be a numeric bank transaction ID or a .../v2/bank_transactions/:id URL; got "${input}". ${NOTHING_DELETED}`
  );
}

function checkHost(parsed: ParsedId, tx: TransactionForDelete, label: string): void {
  const txHost = hostOf(tx.url);
  if (parsed.host && txHost && parsed.host !== txHost) {
    throw new Error(
      `Refused: ${label} is a ${parsed.host} URL, but this server talks to ${txHost} ` +
        `(a different FreeAgent environment). Pass the ID from the right environment. ${NOTHING_DELETED}`
    );
  }
}

function describeTransaction(tx: TransactionForDelete): string {
  return `${tx.dated_on}, ${tx.amount ?? "?"}, "${tx.description ?? ""}"`;
}

function isTransfer(exp: ExplanationForDelete): boolean {
  return Boolean(exp.linked_transfer_account || exp.linked_transfer_explanation || exp.transfer_bank_account);
}

function describeExplanation(exp: ExplanationForDelete): string {
  const transfer = isTransfer(exp)
    ? `, transfer with ${exp.linked_transfer_account ?? exp.transfer_bank_account ?? "another account"}` +
      (exp.linked_transfer_explanation
        ? ` (partner explanation ${toId(exp.linked_transfer_explanation)})`
        : "")
    : "";
  return (
    `  - explanation ${toId(exp.url)}: ${exp.dated_on}, ${exp.gross_value}, ` +
    `${exp.type ?? exp.entry_type ?? "-"}, "${exp.description ?? ""}"${transfer}`
  );
}

/** Drop signed attachment URLs before anything is echoed or logged. */
function sanitise<T>(value: T): T {
  return JSON.parse(
    JSON.stringify(value, (key, v) => (key.startsWith("content_src") ? undefined : v))
  ) as T;
}

function auditLog(message: string, data: Record<string, unknown>): void {
  console.error(
    JSON.stringify({ timestamp: new Date().toISOString(), level: "info", message, data: sanitise(data) })
  );
}

async function getTransaction(client: FreeAgentApiClient, id: string): Promise<TransactionForDelete> {
  const res = await client.get<{ bank_transaction?: TransactionForDelete }>(`/bank_transactions/${id}`);
  const tx = res.data?.bank_transaction;
  if (!tx) throw new Error(`FreeAgent returned no bank_transaction for ${id}.`);
  return tx;
}

async function readTransactionState(client: FreeAgentApiClient, id: string): Promise<FinalState> {
  try {
    return { kind: "exists", tx: await getTransaction(client, id) };
  } catch (error) {
    if (isNotFoundError(error)) return { kind: "gone" };
    return { kind: "unknown", error: errorMessage(error) };
  }
}

async function getExplanation(client: FreeAgentApiClient, idOrUrl: string): Promise<ExplanationForDelete> {
  const res = await client.get<{ bank_transaction_explanation: ExplanationForDelete }>(
    `/bank_transaction_explanations/${toId(idOrUrl)}`
  );
  return res.data.bank_transaction_explanation;
}

/**
 * Always re-read each explanation in full: the copy embedded in a transaction
 * may be a summary without the link, lock and attachment fields checked here.
 */
async function loadExplanations(
  client: FreeAgentApiClient,
  tx: TransactionForDelete
): Promise<ExplanationForDelete[]> {
  const result: ExplanationForDelete[] = [];
  for (const entry of tx.bank_transaction_explanations ?? []) {
    result.push(await getExplanation(client, typeof entry === "string" ? entry : entry.url));
  }
  return result;
}

/** Reasons an explanation must not be deleted by this tool. */
function blockers(exp: ExplanationForDelete, label: string): string[] {
  const name = `${label} ${toId(exp.url)}`;
  const found: string[] = [];
  const fields = Object.entries(exp) as Array<[string, unknown]>;
  for (const [key, value] of fields) {
    if (key.startsWith("paid_") && value) {
      found.push(`${name} carries ${key} ${String(value)}; deleting it would reopen that balance`);
    }
  }
  const byKey = new Map(fields);
  for (const key of OTHER_LINK_KEYS) {
    const value = byKey.get(key);
    if (value) found.push(`${name} is linked to ${key} ${String(value)}`);
  }
  if (exp.is_deletable === false) found.push(`${name} is marked not deletable by FreeAgent`);
  if (exp.has_pending_operation) found.push(`${name} has a pending operation in FreeAgent`);
  if (exp.is_locked) found.push(`${name} is locked by FreeAgent`);
  const exempt = isTransfer(exp) ? TRANSFER_STRUCTURAL_LOCKS : new Set<string>();
  const locks = (exp.locked_attributes ?? []).filter((a) => !exempt.has(a));
  if (locks.length > 0) found.push(`${name} has locked attributes (${locks.join(", ")})`);
  const hasAttachments = Array.isArray(exp.attachments) && exp.attachments.length > 0;
  if (exp.attachment || hasAttachments || (exp.attachment_count ?? 0) > 0) {
    found.push(
      label === "explanation"
        ? `${name} has a receipt attachment; move it to the copy you are keeping first`
        : `${name} has a receipt attachment that could be lost with the pairing`
    );
  }
  return found;
}

/** Which way the account's FreeAgent balance moves when this transaction is removed. */
function balanceEffect(amount: string | undefined): string {
  const value = Number(amount);
  if (amount === undefined || !Number.isFinite(value) || value === 0) {
    return "The account's FreeAgent balance changes by the reverse of this transaction's amount.";
  }
  const size = Math.abs(value).toFixed(2);
  return value < 0
    ? `The account's FreeAgent balance goes up by ${size} (a ${size} payment out was removed).`
    : `The account's FreeAgent balance goes down by ${size} (a ${size} receipt was removed).`;
}

function normaliseDescription(description: string | undefined): string {
  return (description ?? "").toUpperCase().replace(/[^A-Z0-9]/g, "");
}

async function checkDuplicate(
  client: FreeAgentApiClient,
  id: string,
  tx: TransactionForDelete,
  duplicateOf: string,
  requireImportedKeep: boolean
): Promise<TransactionForDelete> {
  const parsed = parseBankTransactionId(duplicateOf, "duplicate_of");
  checkHost(parsed, tx, "duplicate_of");
  if (parsed.id === id) {
    throw new Error(`Refused: duplicate_of must be a different transaction from ${id}. ${NOTHING_DELETED}`);
  }
  let keep: TransactionForDelete;
  try {
    keep = await getTransaction(client, parsed.id);
  } catch (error) {
    if (isNotFoundError(error)) {
      throw new Error(
        `Refused: duplicate_of ${parsed.id} does not exist, so ${id} may be the only copy. ${NOTHING_DELETED}`
      );
    }
    throw error;
  }
  const problems: string[] = [];
  if (requireImportedKeep && keep.is_manual !== false) {
    problems.push(
      `the copy to keep (${parsed.id}) is manual: delete the manual one instead, which needs no allow_imported`
    );
  }
  if (!tx.bank_account || keep.bank_account !== tx.bank_account) {
    problems.push(`different accounts (${keep.bank_account} vs ${tx.bank_account})`);
  }
  const a = Number(tx.amount);
  const b = Number(keep.amount);
  if (!tx.amount || !keep.amount || !Number.isFinite(a) || !Number.isFinite(b) || Math.abs(a - b) >= 0.005) {
    problems.push(`different amounts (${keep.amount} vs ${tx.amount})`);
  }
  const days = Math.abs(Date.parse(keep.dated_on) - Date.parse(tx.dated_on)) / 86_400_000;
  if (!(days <= DUPLICATE_WINDOW_DAYS)) {
    problems.push(`dated ${keep.dated_on} vs ${tx.dated_on} (more than ${DUPLICATE_WINDOW_DAYS} days apart)`);
  }
  // Imported pairs: the normalised descriptions must be identical. A prefix
  // match would accept "AMAZON 123" against "AMAZON 1234". Manual rows carry
  // typed descriptions, so they are matched on account, amount and date only,
  // and the reply says so rather than calling the other row a duplicate.
  if (requireImportedKeep) {
    const d1 = normaliseDescription(tx.description);
    const d2 = normaliseDescription(keep.description);
    if (d1.length < DESCRIPTION_MIN_CHARS || d1 !== d2) {
      problems.push(`descriptions don't match ("${keep.description ?? ""}" vs "${tx.description ?? ""}")`);
    }
  }
  if (problems.length > 0) {
    throw new Error(
      `Refused: ${id} doesn't look like a duplicate of ${parsed.id}: ${problems.join("; ")}. ${NOTHING_DELETED}`
    );
  }
  return keep;
}

async function prefetchPartner(
  client: FreeAgentApiClient,
  exp: ExplanationForDelete
): Promise<PartnerInfo | undefined> {
  if (!isTransfer(exp)) return undefined;
  const info: PartnerInfo = { account: exp.linked_transfer_account ?? exp.transfer_bank_account };
  if (!exp.linked_transfer_explanation) return info;
  info.explanationId = toId(exp.linked_transfer_explanation);
  try {
    const partner = await getExplanation(client, info.explanationId);
    info.record = partner;
    if (partner.bank_transaction) info.transactionId = toId(partner.bank_transaction);
    info.account = partner.bank_account ?? info.account;
  } catch (error) {
    if (!isNotFoundError(error)) throw error;
  }
  return info;
}

interface PartnerReport {
  note: string;
  /** True only when the partner transaction still exists and is now unexplained. */
  needsReexplaining: boolean;
}

async function describePartnerAfter(client: FreeAgentApiClient, partner: PartnerInfo): Promise<PartnerReport> {
  if (!partner.transactionId) {
    return {
      note:
        `⚠️ This was one side of a transfer with ${partner.account ?? "another account"}, but its partner ` +
        `transaction couldn't be identified. Check that account.`,
      needsReexplaining: false,
    };
  }
  const state = await readTransactionState(client, partner.transactionId);
  if (state.kind === "gone") {
    return {
      note:
        `⚠️ Transfer partner: transaction ${partner.transactionId} in ${partner.account ?? "the other account"} ` +
        `no longer exists (FreeAgent removed it with the pairing). If it was a real bank line, re-add it from the statement.`,
      needsReexplaining: false,
    };
  }
  if (state.kind === "unknown") {
    return {
      note: `⚠️ Transfer partner: couldn't check transaction ${partner.transactionId} (${state.error}). Check it in the web UI.`,
      needsReexplaining: false,
    };
  }
  const unexplained = Number(state.tx.unexplained_amount ?? "0");
  return unexplained !== 0
    ? {
        note:
          `⚠️ Transfer partner: transaction ${partner.transactionId} in ${state.tx.bank_account} ` +
          `(${describeTransaction(state.tx)}) is now unexplained (${state.tx.unexplained_amount}).`,
        needsReexplaining: true,
      }
    : {
        note:
          `Transfer partner: transaction ${partner.transactionId} in ${state.tx.bank_account} is still explained. ` +
          `Check its explanation doesn't still point at the transfer that was removed.`,
        needsReexplaining: false,
      };
}

/** The plural route, matching GET. See the module header for why the singular route isn't used. */
async function deleteTransactionRoute(client: FreeAgentApiClient, id: string): Promise<void> {
  await client.delete(`/bank_transactions/${id}`);
}

interface Checked {
  id: string;
  tx: TransactionForDelete;
  origin: string;
  kept?: TransactionForDelete;
  explanations: ExplanationForDelete[];
  partners: Map<string, PartnerInfo>;
}

/** Every check that must pass before anything changes. Only GETs happen here. */
async function runChecks(
  client: FreeAgentApiClient,
  params: DeleteBankTransactionInput
): Promise<Checked> {
  const parsed = parseBankTransactionId(params.bank_transaction_id);
  const id = parsed.id;
  const tx = await getTransaction(client, id);
  checkHost(parsed, tx, "bank_transaction_id");
  const origin = tx.is_manual
    ? "manual"
    : "not marked manual: from the bank feed or a statement upload";

  let kept: TransactionForDelete | undefined;
  if (!tx.is_manual) {
    if (!params.allow_imported) {
      throw new Error(
        `Refused: transaction ${id} (${describeTransaction(tx)}) is ${origin}. Imported ` +
          `transactions mirror the bank's own record, so deleting one moves the FreeAgent ` +
          `balance away from the bank. If it is a genuine duplicate, call again with ` +
          `allow_imported: true, duplicate_of: <ID of the imported copy to keep>, and a reason. ${NOTHING_DELETED}`
      );
    }
    if (!params.duplicate_of) {
      throw new Error(
        `Refused: allow_imported needs duplicate_of, the ID of the transaction ${id} duplicates ` +
          `(the copy to keep). ${NOTHING_DELETED}`
      );
    }
    kept = await checkDuplicate(client, id, tx, params.duplicate_of, true);
  } else if (params.duplicate_of) {
    kept = await checkDuplicate(client, id, tx, params.duplicate_of, false);
  }

  const explanations = await loadExplanations(client, tx);
  const partners = new Map<string, PartnerInfo>();
  for (const exp of explanations) {
    const partner = await prefetchPartner(client, exp);
    if (partner) partners.set(exp.url, partner);
  }

  const blocked = [
    ...explanations.flatMap((e) => blockers(e, "explanation")),
    ...[...partners.values()].flatMap((p) => (p.record ? blockers(p.record, "partner explanation") : [])),
  ];
  if (blocked.length > 0) {
    throw new Error(
      `Refused: transaction ${id} (${describeTransaction(tx)}) can't be deleted by this tool:\n` +
        blocked.map((b) => `  - ${b}`).join("\n") +
        `\nHandle it in the FreeAgent web UI. ${NOTHING_DELETED}`
    );
  }

  if (explanations.length > 0 && !params.delete_explanations) {
    throw new Error(
      `Refused: transaction ${id} (${describeTransaction(tx)}) has ${explanations.length} ` +
        `explanation(s), and FreeAgent only deletes unexplained transactions:\n` +
        explanations.map(describeExplanation).join("\n") +
        (partners.size > 0
          ? `\nDeleting a transfer explanation also affects the other account: its partner ` +
            `transaction will be unexplained, unpaired or removed.`
          : "") +
        `\nCall again with delete_explanations: true to remove them first. ${NOTHING_DELETED}`
    );
  }

  return { id, tx, origin, kept, explanations, partners };
}

export async function deleteBankTransaction(
  client: FreeAgentApiClient,
  params: DeleteBankTransactionInput
): Promise<string> {
  const reason = params.reason.trim();

  // The hosted (serverless) deployment has a 60 s limit, too tight for this
  // tool's sequential calls plus rate-limit backoff: it could be cut off
  // between changes, losing the final report.
  if (process.env.VERCEL) {
    throw new Error(
      `freeagent_delete_bank_transaction isn't available on the hosted deployment yet. Use the local server. ${NOTHING_DELETED}`
    );
  }

  let checked: Checked;
  try {
    checked = await runChecks(client, params);
  } catch (error) {
    const message = errorMessage(error);
    throw new Error(message.includes(NOTHING_DELETED) ? message : `${message} ${NOTHING_DELETED}`);
  }
  const { id, tx, origin, kept, explanations, partners } = checked;

  // ---- Changes. From here on, every exit reads the real state. ----
  const removed: ExplanationForDelete[] = [];
  let uncertain: ExplanationForDelete | undefined;
  let failure: string | undefined;
  let removedWithExplanation = false;

  try {
    for (const exp of explanations) {
      uncertain = exp;
      try {
        await client.delete(`/bank_transaction_explanations/${toId(exp.url)}`);
      } catch (error) {
        // Already gone, e.g. removed by FreeAgent along with an earlier one.
        if (!isNotFoundError(error)) throw error;
      }
      removed.push(exp);
      uncertain = undefined;
    }
    // FreeAgent may remove a manual transaction together with its last explanation.
    const midState = removed.length > 0 ? await readTransactionState(client, id) : undefined;
    if (midState?.kind === "gone") {
      removedWithExplanation = true;
    } else {
      await deleteTransactionRoute(client, id);
    }
  } catch (error) {
    failure = errorMessage(error);
  }

  // An explanation delete that errored may still have succeeded on the server.
  let attemptedStillPresent: ExplanationForDelete | undefined;
  if (uncertain) {
    const pending: ExplanationForDelete = uncertain;
    try {
      await getExplanation(client, pending.url);
      uncertain = undefined; // it still exists, so it wasn't removed (as of this re-read)
      attemptedStillPresent = pending;
    } catch (error) {
      if (isNotFoundError(error)) {
        removed.push(pending);
        uncertain = undefined;
      }
    }
  }

  const partnerReports: PartnerReport[] = [];
  for (const exp of uncertain ? [...removed, uncertain] : removed) {
    const partner = partners.get(exp.url);
    if (partner) partnerReports.push(await describePartnerAfter(client, partner));
  }
  const partnerNotes = partnerReports.map((r) => r.note);

  const final = await readTransactionState(client, id);
  const touchedPartners = [...partners.entries()]
    .filter(([url]) => removed.some((e) => e.url === url) || uncertain?.url === url)
    .map(([, p]) => p.record)
    .filter((r): r is ExplanationForDelete => Boolean(r));

  const record = [
    final.kind === "gone" ? `Record of what was removed:` : `Record:`,
    `- **Transaction**: ${id} (${origin})`,
    `- **Account**: ${tx.bank_account}`,
    `- **Date**: ${tx.dated_on}`,
    `- **Amount**: ${tx.amount ?? "?"}`,
    `- **Description**: ${tx.description ?? "-"}`,
    ...(kept
      ? [
          tx.is_manual
            ? `- **Checked against**: ${toId(kept.url)} (${describeTransaction(kept)}); same account, amount and date window only, descriptions not compared`
            : `- **Duplicate of (kept)**: ${toId(kept.url)} (${describeTransaction(kept)})`,
        ]
      : []),
    `- **Explanations removed**: ${removed.length}`,
    ...removed.map(describeExplanation),
    ...(uncertain
      ? [
          `- **Explanation that may also have been removed** (its delete errored and it couldn't be re-read):`,
          describeExplanation(uncertain),
        ]
      : []),
    ...(removed.length > 0 || uncertain || attemptedStillPresent || touchedPartners.length > 0
      ? [
          "",
          "Full pre-change records (for restoring if ever needed):",
          "```json",
          JSON.stringify(
            sanitise({
              explanations: uncertain ? [...removed, uncertain] : removed,
              ...(attemptedStillPresent ? { delete_attempted_but_still_present: attemptedStillPresent } : {}),
              transfer_partner_explanations: touchedPartners,
            }),
            null,
            2
          ),
          "```",
        ]
      : []),
  ];
  const transferLines =
    partnerNotes.length > 0
      ? ["", ...partnerNotes, ...(partnerReports.some((r) => r.needsReexplaining) ? [TRANSFER_ADVICE] : [])]
      : [];

  auditLog("freeagent_delete_bank_transaction", {
    transaction_id: id,
    outcome: final.kind === "gone" ? "deleted" : "failed",
    final_state: final.kind,
    reason,
    origin,
    kept_copy: kept ? toId(kept.url) : undefined,
    failure,
    transaction: tx,
    removed_explanations: removed,
    possibly_removed_explanation: uncertain,
    transfer_partner_explanations: touchedPartners,
    partner_notes: partnerNotes,
  });

  if (final.kind === "gone") {
    const notes: string[] = [];
    if (kept) {
      const keptState = await readTransactionState(client, toId(kept.url));
      if (keptState.kind === "gone") {
        notes.push(
          `⚠️ The ${tx.is_manual ? "transaction it was checked against" : "copy you kept"} (${toId(kept.url)}) no longer exists either. Check whether another delete removed it, and re-add it from the bank statement if so.`
        );
      } else if (keptState.kind === "unknown") {
        notes.push(
          `⚠️ Couldn't re-check ${toId(kept.url)} after the delete (${keptState.error}). Confirm it still exists in the web UI.`
        );
      }
    }
    if (removedWithExplanation) {
      notes.push("FreeAgent removed the transaction itself when its last explanation was deleted.");
    }
    if (failure) {
      notes.push(`A delete call reported an error (${failure}), but the transaction is confirmed gone.`);
    }
    return [
      `🗑️ Deleted bank transaction ${id}. Verified: it no longer exists.`,
      ...notes,
      ``,
      `Reason given: ${reason}`,
      ``,
      ...record,
      ...transferLines,
      ``,
      balanceEffect(tx.amount),
    ].join("\n");
  }

  const changed = removed.length > 0 || Boolean(uncertain);
  const stateLine =
    final.kind === "exists"
      ? `Transaction ${id} still exists` +
        (changed
          ? `, now with unexplained amount ${final.tx.unexplained_amount ?? "?"}. The pre-change records are below if anything needs restoring.`
          : failure
            ? `. Nothing appears to have changed (re-read after the error).`
            : `. Nothing was changed.`)
      : `Transaction ${id}'s state could not be confirmed (${final.error}). Check it in the FreeAgent web UI before retrying.`;
  throw new Error(
    [
      `Delete of bank transaction ${id} did not complete: ${failure ?? "FreeAgent accepted the delete, but the transaction still exists."}`,
      stateLine,
      ``,
      `Reason given: ${reason}`,
      ``,
      ...record,
      ...transferLines,
    ].join("\n")
  );
}
