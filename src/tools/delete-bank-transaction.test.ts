/**
 * Tests for freeagent_delete_bank_transaction (Oct 2026). The cases mirror the
 * live repairs it was built for: FreeAgent-created "///" transfer
 * counterparts (manual, explained as a transfer) and feed/statement duplicates
 * (imported). The fake client is stateful so that every exit path's final
 * read sees the effect of earlier deletes.
 */

import { describe, it, expect, vi, beforeEach } from "vitest";
import { z } from "zod";
import type { FreeAgentApiClient } from "../services/api-client.js";
import { ApiRequestError, NOT_FOUND_MESSAGE } from "../services/api-client.js";
import { callTool } from "./tool-search.js";
import { DeleteBankTransactionInputSchema } from "../schemas/index.js";
import { deleteBankTransaction, parseBankTransactionId } from "./delete-bank-transaction.js";
import { toolDefinitions } from "./register.js";

type Store = Map<string, unknown>;

interface FakeOptions {
  /** Errors thrown by specific DELETE paths (thrown before any state change). */
  deleteErrors?: Record<string, Error>;
  /** Errors thrown by GET after the given number of successful deletes. */
  getErrorsAfterDeletes?: { afterDeletes: number; path: string; error: Error };
  /** Extra state changes applied after a successful DELETE of a path. */
  onDelete?: (path: string, store: Store) => void;
  /** Transaction delete returns success but leaves the record in place. */
  transactionSurvivesDelete?: boolean;
  /** Transaction delete succeeds on the server but the call reports an error. */
  transactionDeleteErrorsAfterSuccess?: Error;
  /** Explanation deletes that succeed on the server but report an error. */
  explanationDeleteErrorsAfterSuccess?: Record<string, Error>;
  /** Don't auto-register standalone records for embedded explanations. */
  noAutoExplanations?: boolean;
}

const notFound = () => new ApiRequestError(NOT_FOUND_MESSAGE, 404);

function makeClient(initial: Record<string, unknown>, opts: FakeOptions = {}) {
  const store: Store = new Map(Object.entries(structuredClone(initial)));
  if (!opts.noAutoExplanations) {
    // The tool always re-reads explanations in full, so register each embedded one.
    for (const value of [...store.values()]) {
      const embedded = (value as { bank_transaction?: { bank_transaction_explanations?: unknown[] } }).bank_transaction
        ?.bank_transaction_explanations;
      for (const exp of embedded ?? []) {
        if (typeof exp === "object" && exp && "url" in exp) {
          const path = `/bank_transaction_explanations/${String((exp as { url: string }).url).split("/").pop()}`;
          if (!store.has(path)) store.set(path, { bank_transaction_explanation: structuredClone(exp) });
        }
      }
    }
  }
  const calls: string[] = [];
  let deletes = 0;
  const client = {
    get: vi.fn(async (path: string) => {
      calls.push(`get ${path}`);
      const ge = opts.getErrorsAfterDeletes;
      if (ge && deletes >= ge.afterDeletes && ge.path === path) throw ge.error;
      if (!store.has(path)) throw notFound();
      return { data: structuredClone(store.get(path)), headers: {} };
    }),
    delete: vi.fn(async (path: string) => {
      calls.push(`delete ${path}`);
      const err = opts.deleteErrors?.[path];
      if (err) throw err;
      const txMatch = path.match(/^\/bank_transactions?\/(\d+)$/);
      if (txMatch) {
        const key = `/bank_transactions/${txMatch[1]}`;
        if (!store.has(key)) throw notFound();
        const remaining = (store.get(key) as { bank_transaction?: { bank_transaction_explanations?: unknown[] } })
          .bank_transaction?.bank_transaction_explanations ?? [];
        if (remaining.length > 0) throw new Error("API error: Unable to delete transaction as it has explanations");
        if (!opts.transactionSurvivesDelete) store.delete(key);
        deletes++;
        opts.onDelete?.(path, store);
        if (opts.transactionDeleteErrorsAfterSuccess) throw opts.transactionDeleteErrorsAfterSuccess;
        return { data: {}, headers: {} };
      }
      const expMatch = path.match(/^\/bank_transaction_explanations\/(\d+)$/);
      if (expMatch && !opts.noAutoExplanations && !store.has(path)) throw notFound();
      if (expMatch) {
        // Remove the explanation from its transaction (and the standalone record).
        for (const [key, value] of store) {
          const tx = (value as { bank_transaction?: { bank_transaction_explanations?: Array<{ url?: string }> ; amount?: string; unexplained_amount?: string } }).bank_transaction;
          if (key.startsWith("/bank_transactions/") && tx?.bank_transaction_explanations) {
            const before = tx.bank_transaction_explanations.length;
            tx.bank_transaction_explanations = tx.bank_transaction_explanations.filter(
              (e) => !(typeof e === "object" && e.url?.endsWith(`/${expMatch[1]}`))
            );
            if (tx.bank_transaction_explanations.length !== before) {
              const explained = tx.bank_transaction_explanations.reduce(
                (sum, e) => sum + Number((e as { gross_value?: string }).gross_value ?? 0),
                0
              );
              tx.unexplained_amount = (Number(tx.amount) - explained).toFixed(2);
            }
          }
        }
        store.delete(path);
      }
      deletes++;
      opts.onDelete?.(path, store);
      const after = opts.explanationDeleteErrorsAfterSuccess?.[path];
      if (after) throw after;
      return { data: {}, headers: {} };
    }),
  } as unknown as FreeAgentApiClient;
  return { client, calls, store };
}

const TX = "https://api.freeagent.com/v2/bank_transactions";
const EXP = "https://api.freeagent.com/v2/bank_transaction_explanations";
const ESS = "https://api.freeagent.com/v2/bank_accounts/900001";
const PAYPAL = "https://api.freeagent.com/v2/bank_accounts/900002";

/** The fake counterpart FreeAgent created in Current account and its PayPal partner. */
function fakeCounterpartWorld() {
  const counterpartExp = {
    url: `${EXP}/200000201`,
    bank_transaction: `${TX}/100000201`,
    bank_account: ESS,
    dated_on: "2026-09-20",
    gross_value: "-35.0",
    type: "Transfer to Another Account",
    description: "Transfer from Current account to PayPal",
    linked_transfer_account: PAYPAL,
    linked_transfer_explanation: `${EXP}/200000202`,
    is_locked: false,
    locked_attributes: ["type", "linked_transfer_account", "transfer_value"],
  };
  const partnerExp = {
    url: `${EXP}/200000202`,
    bank_transaction: `${TX}/100000202`,
    bank_account: PAYPAL,
    dated_on: "2026-09-20",
    gross_value: "35.0",
    type: "Transfer from Another Account",
    linked_transfer_account: ESS,
    linked_transfer_explanation: `${EXP}/200000201`,
  };
  return {
    "/bank_transactions/100000201": {
      bank_transaction: {
        url: `${TX}/100000201`,
        bank_account: ESS,
        dated_on: "2026-09-20",
        amount: "-35.0",
        unexplained_amount: "0.0",
        description: "///",
        is_manual: true,
        bank_transaction_explanations: [counterpartExp],
      },
    },
    "/bank_transaction_explanations/200000201": { bank_transaction_explanation: counterpartExp },
    "/bank_transaction_explanations/200000202": { bank_transaction_explanation: partnerExp },
    "/bank_transactions/100000202": {
      bank_transaction: {
        url: `${TX}/100000202`,
        bank_account: PAYPAL,
        dated_on: "2026-09-20",
        amount: "35.0",
        unexplained_amount: "0.0",
        description: "Bank deposit",
        is_manual: false,
        bank_transaction_explanations: [partnerExp],
      },
    },
  };
}

/** Partner side loses its explanation when either side of the transfer is deleted. */
const unpairPartner = (path: string, store: Store) => {
  if (path === "/bank_transaction_explanations/200000201") {
    const partner = store.get("/bank_transactions/100000202") as { bank_transaction: Record<string, unknown> };
    partner.bank_transaction.bank_transaction_explanations = [];
    partner.bank_transaction.unexplained_amount = "35.0";
    store.delete("/bank_transaction_explanations/200000202");
  }
};

/** Two imported copies of the same card payment (feed and statement upload). */
function duplicateWorld(overrides: Record<string, unknown> = {}) {
  const exp = {
    url: `${EXP}/200000101`,
    bank_transaction: `${TX}/100000102`,
    dated_on: "2026-08-17",
    gross_value: "-9.87",
    type: "Payment",
    description: "CANVA*",
    is_locked: false,
  };
  return {
    "/bank_transactions/100000102": {
      bank_transaction: {
        url: `${TX}/100000102`,
        bank_account: ESS,
        dated_on: "2026-08-17",
        amount: "-9.87",
        unexplained_amount: "0.0",
        description: "CANVA* I01234-7654321",
        is_manual: false,
        bank_transaction_explanations: [exp],
        ...overrides,
      },
    },
    "/bank_transactions/100000101": {
      bank_transaction: {
        url: `${TX}/100000101`,
        bank_account: ESS,
        dated_on: "2026-08-17",
        amount: "-9.87",
        unexplained_amount: "0.0",
        description: "CANVA*/I01234-7654321",
        is_manual: false,
        bank_transaction_explanations: [],
      },
    },
  };
}

function unexplainedManualWorld(txOverrides: Record<string, unknown> = {}) {
  return {
    "/bank_transactions/555": {
      bank_transaction: {
        url: `${TX}/555`,
        bank_account: ESS,
        dated_on: "2026-09-01",
        amount: "12.00",
        unexplained_amount: "12.00",
        description: "typo",
        is_manual: true,
        bank_transaction_explanations: [],
        ...txOverrides,
      },
    },
  };
}

/** Runtime parity: the MCP SDK builds z.object(shape), which applies defaults and is not strict. */
const runtimeSchema = z.object(DeleteBankTransactionInputSchema.shape);
const args = (input: Record<string, unknown>) =>
  runtimeSchema.parse({ confirm: true, reason: "FreeAgent-created transfer counterpart; real pair is 100000203", ...input });

let logSpy: ReturnType<typeof vi.spyOn>;
beforeEach(() => {
  vi.stubEnv("FREEAGENT_ENABLE_DELETE", "true");
  logSpy = vi.spyOn(console, "error").mockImplementation(() => {});
});

describe("schema and registration", () => {
  it("applies defaults at runtime and requires confirm: true and a 10-character reason", () => {
    const parsed = runtimeSchema.parse({ bank_transaction_id: " 1 ", confirm: true, reason: "duplicate of 100000101" });
    expect(parsed.bank_transaction_id).toBe("1");
    expect(parsed.allow_imported).toBe(false);
    expect(parsed.delete_explanations).toBe(false);
    expect(parsed.duplicate_of).toBeUndefined();
    expect(() => runtimeSchema.parse({ bank_transaction_id: "1", confirm: false, reason: "long enough reason" })).toThrow();
    expect(() => runtimeSchema.parse({ bank_transaction_id: "1", confirm: true, reason: "   short  " })).toThrow();
    expect(() => runtimeSchema.parse({ bank_transaction_id: "   ", confirm: true, reason: "long enough reason" })).toThrow();
  });

  it("is registered as destructive and not idempotent (a retry after success 404s)", () => {
    const def = toolDefinitions.find((t) => t.name === "freeagent_delete_bank_transaction");
    expect(def?.annotations).toMatchObject({ destructiveHint: true, readOnlyHint: false, idempotentHint: false });
  });

  it("parses IDs strictly", () => {
    expect(parseBankTransactionId("100000201")).toEqual({ id: "100000201" });
    expect(parseBankTransactionId(`${TX}/100000201/`)).toEqual({ id: "100000201", host: "api.freeagent.com" });
    expect(() => parseBankTransactionId(`${EXP}/200000201`)).toThrow(/bank_transactions\/:id URL/);
    expect(() => parseBankTransactionId("12a")).toThrow();
  });
});

describe("deleteBankTransaction: successful deletes", () => {
  it("deletes an unexplained manual transaction via the plural route and verifies it", async () => {
    const { client, calls } = makeClient(unexplainedManualWorld());
    const result = await deleteBankTransaction(client, args({ bank_transaction_id: "555" }));
    expect(calls).toEqual([
      "get /bank_transactions/555",
      "delete /bank_transactions/555",
      "get /bank_transactions/555",
    ]);
    expect(result).toContain("Deleted bank transaction 555. Verified: it no longer exists.");
    expect(result).toContain("Reason given: FreeAgent-created transfer counterpart");
    expect(logSpy).toHaveBeenCalledWith(expect.stringContaining('"outcome":"deleted"'));
  });

  it("never calls the singular route, even when the plural delete returns 404", async () => {
    const { client, calls } = makeClient(unexplainedManualWorld(), {
      deleteErrors: { "/bank_transactions/555": new ApiRequestError(NOT_FOUND_MESSAGE, 404) },
    });
    await expect(deleteBankTransaction(client, args({ bank_transaction_id: "555" }))).rejects.toThrow(
      /did not complete: Resource not found.*still exists/s
    );
    expect(calls.filter((c) => c.startsWith("delete"))).toEqual(["delete /bank_transactions/555"]);
  });

  it("removes a fake transfer counterpart's explanation first and reports the partner's real state", async () => {
    const { client, calls } = makeClient(fakeCounterpartWorld(), { onDelete: unpairPartner });
    const result = await deleteBankTransaction(
      client,
      args({ bank_transaction_id: `${TX}/100000201`, delete_explanations: true })
    );
    expect(calls.filter((c) => c.startsWith("delete"))).toEqual([
      "delete /bank_transaction_explanations/200000201",
      "delete /bank_transactions/100000201",
    ]);
    expect(result).toContain("Explanations removed**: 1");
    expect(result).toContain(`transaction 100000202 in ${PAYPAL}`);
    expect(result).toContain("is now unexplained (35.0)");
    expect(result).toContain("make sure its real counterpart is unexplained");
    expect(result).toContain('"linked_transfer_account"'); // full record included
  });

  it("treats a transaction FreeAgent removed along with its last explanation as deleted", async () => {
    const cascade = (path: string, store: Store) => {
      unpairPartner(path, store);
      if (path === "/bank_transaction_explanations/200000201") store.delete("/bank_transactions/100000201");
    };
    const { client, calls } = makeClient(fakeCounterpartWorld(), { onDelete: cascade });
    const result = await deleteBankTransaction(client, args({ bank_transaction_id: "100000201", delete_explanations: true }));
    expect(calls.filter((c) => c.startsWith("delete"))).toEqual(["delete /bank_transaction_explanations/200000201"]);
    expect(result).toContain("FreeAgent removed the transaction itself when its last explanation was deleted.");
  });

  it("reports success when the delete call errors but the transaction is confirmed gone", async () => {
    const { client } = makeClient(unexplainedManualWorld(), {
      transactionDeleteErrorsAfterSuccess: new Error("Request timeout. The FreeAgent API took too long to respond."),
    });
    const result = await deleteBankTransaction(client, args({ bank_transaction_id: "555" }));
    expect(result).toContain("A delete call reported an error (Request timeout");
    expect(result).toContain("confirmed gone");
  });

  it("deletes an imported duplicate when allow_imported names a valid copy to keep", async () => {
    const { client, calls } = makeClient(duplicateWorld());
    const result = await deleteBankTransaction(
      client,
      args({
        bank_transaction_id: "100000102",
        reason: "Duplicate of 100000101 from a statement upload",
        allow_imported: true,
        duplicate_of: "100000101",
        delete_explanations: true,
      })
    );
    expect(calls.filter((c) => c.startsWith("delete"))).toEqual([
      "delete /bank_transaction_explanations/200000101",
      "delete /bank_transactions/100000102",
    ]);
    expect(result).toContain("Duplicate of (kept)**: 100000101");
    expect(result).not.toContain("Transfer partner");
  });
});

describe("deleteBankTransaction: refusals change nothing", () => {
  const noDeletes = (calls: string[]) => expect(calls.some((c) => c.startsWith("delete"))).toBe(false);

  it("refuses an explained transaction without delete_explanations and warns about the transfer partner", async () => {
    const { client, calls } = makeClient(fakeCounterpartWorld());
    await expect(deleteBankTransaction(client, args({ bank_transaction_id: "100000201" }))).rejects.toThrow(
      /has 1 explanation\(s\).*transfer with .*900002 \(partner explanation 200000202\).*also affects the other account.*delete_explanations: true/s
    );
    noDeletes(calls);
  });

  it("refuses an imported transaction without allow_imported, labelled as not marked manual", async () => {
    const { client, calls } = makeClient(duplicateWorld());
    await expect(
      deleteBankTransaction(client, args({ bank_transaction_id: "100000102", delete_explanations: true }))
    ).rejects.toThrow(/not marked manual.*duplicate_of/s);
    noDeletes(calls);
  });

  it("refuses when is_manual is missing", async () => {
    const { client, calls } = makeClient(unexplainedManualWorld({ is_manual: undefined }));
    await expect(deleteBankTransaction(client, args({ bank_transaction_id: "555" }))).rejects.toThrow(/not marked manual/);
    noDeletes(calls);
  });

  it("refuses allow_imported without duplicate_of", async () => {
    const { client, calls } = makeClient(duplicateWorld());
    await expect(
      deleteBankTransaction(client, args({ bank_transaction_id: "100000102", allow_imported: true, delete_explanations: true }))
    ).rejects.toThrow(/allow_imported needs duplicate_of/);
    noDeletes(calls);
  });

  it("refuses when duplicate_of differs in amount", async () => {
    const world = duplicateWorld();
    (world["/bank_transactions/100000101"].bank_transaction as Record<string, unknown>).amount = "-9.88";
    const { client, calls } = makeClient(world);
    await expect(
      deleteBankTransaction(
        client,
        args({ bank_transaction_id: "100000102", allow_imported: true, duplicate_of: "100000101", delete_explanations: true })
      )
    ).rejects.toThrow(/doesn't look like a duplicate.*different amounts/);
    noDeletes(calls);
  });

  it("refuses when duplicate_of no longer exists", async () => {
    const world = duplicateWorld() as Record<string, unknown>;
    delete world["/bank_transactions/100000101"];
    const { client, calls } = makeClient(world);
    await expect(
      deleteBankTransaction(
        client,
        args({ bank_transaction_id: "100000102", allow_imported: true, duplicate_of: "100000101", delete_explanations: true })
      )
    ).rejects.toThrow(/may be the only copy/);
    noDeletes(calls);
  });

  it("refuses paid_user and paid_invoice links", async () => {
    for (const link of [{ paid_user: "https://api.freeagent.com/v2/users/1" }, { paid_invoice: "https://api.freeagent.com/v2/invoices/42" }]) {
      const world = unexplainedManualWorld({
        unexplained_amount: "0.0",
        bank_transaction_explanations: [
          { url: `${EXP}/9`, bank_transaction: `${TX}/555`, dated_on: "2026-09-01", gross_value: "12.00", ...link },
        ],
      });
      const { client, calls } = makeClient(world);
      await expect(
        deleteBankTransaction(client, args({ bank_transaction_id: "555", delete_explanations: true }))
      ).rejects.toThrow(/carries paid_(user|invoice).*reopen that balance.*Nothing was deleted/s);
      noDeletes(calls);
    }
  });

  it("refuses when only the second of two explanations is unsafe", async () => {
    const world = unexplainedManualWorld({
      unexplained_amount: "0.0",
      bank_transaction_explanations: [
        { url: `${EXP}/8`, bank_transaction: `${TX}/555`, dated_on: "2026-09-01", gross_value: "6.00" },
        { url: `${EXP}/9`, bank_transaction: `${TX}/555`, dated_on: "2026-09-01", gross_value: "6.00", paid_bill: "https://api.freeagent.com/v2/bills/3" },
      ],
    });
    const { client, calls } = makeClient(world);
    await expect(
      deleteBankTransaction(client, args({ bank_transaction_id: "555", delete_explanations: true }))
    ).rejects.toThrow(/explanation 9 carries paid_bill/);
    noDeletes(calls);
  });

  it("refuses locks beyond the structural transfer locks, but allows those", async () => {
    const locked = fakeCounterpartWorld();
    const exp = locked["/bank_transactions/100000201"].bank_transaction.bank_transaction_explanations[0] as Record<string, unknown>;
    exp.locked_attributes = ["type", "dated_on", "gross_value"];
    const { client, calls } = makeClient(locked);
    await expect(
      deleteBankTransaction(client, args({ bank_transaction_id: "100000201", delete_explanations: true }))
    ).rejects.toThrow(/locked attributes \(dated_on, gross_value\)/);
    noDeletes(calls);

    const isLocked = fakeCounterpartWorld();
    (isLocked["/bank_transactions/100000201"].bank_transaction.bank_transaction_explanations[0] as Record<string, unknown>).is_locked = true;
    const second = makeClient(isLocked);
    await expect(
      deleteBankTransaction(second.client, args({ bank_transaction_id: "100000201", delete_explanations: true }))
    ).rejects.toThrow(/is locked by FreeAgent/);
    noDeletes(second.calls);
  });

  it("refuses an explanation with a receipt attachment", async () => {
    const world = duplicateWorld();
    (world["/bank_transactions/100000102"].bank_transaction.bank_transaction_explanations[0] as Record<string, unknown>).attachment = {
      file_name: "canva.jpg",
    };
    const { client, calls } = makeClient(world);
    await expect(
      deleteBankTransaction(
        client,
        args({ bank_transaction_id: "100000102", allow_imported: true, duplicate_of: "100000101", delete_explanations: true })
      )
    ).rejects.toThrow(/receipt attachment/);
    noDeletes(calls);
  });

  it("reports the real state when FreeAgent rejects the transaction delete", async () => {
    const { client, calls } = makeClient(unexplainedManualWorld(), {
      deleteErrors: { "/bank_transactions/555": new Error("Validation error: base: transaction is locked. Please check your input and try again.") },
    });
    await expect(deleteBankTransaction(client, args({ bank_transaction_id: "555" }))).rejects.toThrow(
      /did not complete: Validation error.*still exists\. Nothing appears to have changed/s
    );
    expect(calls.filter((c) => c.startsWith("delete"))).toEqual(["delete /bank_transactions/555"]);
  });
});

describe("deleteBankTransaction: failures after a change report the real state", () => {
  it("reports explanations already removed when a later explanation delete fails", async () => {
    const world = unexplainedManualWorld({
      unexplained_amount: "0.0",
      bank_transaction_explanations: [
        { url: `${EXP}/8`, bank_transaction: `${TX}/555`, dated_on: "2026-09-01", gross_value: "6.00", description: "first" },
        { url: `${EXP}/9`, bank_transaction: `${TX}/555`, dated_on: "2026-09-01", gross_value: "6.00", description: "second" },
      ],
    });
    const { client } = makeClient(world, {
      deleteErrors: { "/bank_transaction_explanations/9": new Error("API error: something broke") },
    });
    const error = await deleteBankTransaction(client, args({ bank_transaction_id: "555", delete_explanations: true })).catch((e: Error) => e);
    expect(error).toBeInstanceOf(Error);
    const message = (error as Error).message;
    expect(message).toContain("did not complete: API error: something broke");
    expect(message).toContain("still exists, now with unexplained amount 6.00");
    expect(message).toContain("Explanations removed**: 1");
    expect(message).toContain('explanation 8: 2026-09-01, 6.00, -, "first"');
    expect(logSpy).toHaveBeenCalledWith(expect.stringContaining('"outcome":"failed"'));
  });

  it("states the state is unknown when the final read fails with a non-404 error", async () => {
    const { client } = makeClient(fakeCounterpartWorld(), {
      onDelete: unpairPartner,
      getErrorsAfterDeletes: {
        afterDeletes: 2,
        path: "/bank_transactions/100000201",
        error: new Error("Rate limit exceeded and automatic retries (2) were exhausted."),
      },
    });
    await expect(
      deleteBankTransaction(client, args({ bank_transaction_id: "100000201", delete_explanations: true }))
    ).rejects.toThrow(/state could not be confirmed \(Rate limit exceeded.*Explanations removed\*\*: 1.*is now unexplained \(35\.0\)/s);
  });

  it("throws if the transaction still exists after FreeAgent accepted the delete", async () => {
    const { client } = makeClient(unexplainedManualWorld(), { transactionSurvivesDelete: true });
    await expect(deleteBankTransaction(client, args({ bank_transaction_id: "555" }))).rejects.toThrow(
      /FreeAgent accepted the delete, but the transaction still exists/
    );
  });
});

describe("deleteBankTransaction: second-review hardening", () => {
  const noDeletes = (calls: string[]) => expect(calls.some((c) => c.startsWith("delete"))).toBe(false);

  it("checks the full explanation record, not the summary embedded in the transaction", async () => {
    // FreeAgent's documented single-transaction payload embeds only a summary.
    const world = {
      ...unexplainedManualWorld({
        unexplained_amount: "0.0",
        bank_transaction_explanations: [
          { url: `${EXP}/9`, bank_transaction: `${TX}/555`, dated_on: "2026-09-01", gross_value: "12.00", entry_type: "Invoice Receipt", is_deletable: true },
        ],
      }),
      "/bank_transaction_explanations/9": {
        bank_transaction_explanation: {
          url: `${EXP}/9`, bank_transaction: `${TX}/555`, dated_on: "2026-09-01", gross_value: "12.00",
          type: "Invoice Receipt", paid_invoice: "https://api.freeagent.com/v2/invoices/42",
        },
      },
    };
    const { client, calls } = makeClient(world, { noAutoExplanations: true });
    await expect(
      deleteBankTransaction(client, args({ bank_transaction_id: "555", delete_explanations: true }))
    ).rejects.toThrow(/carries paid_invoice/);
    expect(calls).toContain("get /bank_transaction_explanations/9");
    noDeletes(calls);
  });

  it("refuses is_deletable: false, asset links, and structural locks on a non-transfer", async () => {
    const cases: Array<[Record<string, unknown>, RegExp]> = [
      [{ is_deletable: false }, /marked not deletable/],
      [{ capital_asset: "https://api.freeagent.com/v2/capital_assets/3000001" }, /linked to capital_asset/],
      [{ locked_attributes: ["type", "transfer_value"] }, /locked attributes \(type, transfer_value\)/],
      // From 1 Dec 2026 FreeAgent returns `attachments` (array) instead of `attachment`.
      [{ attachments: [{ url: "https://api.freeagent.com/v2/attachments/1", content_src: "https://signed.example/x" }] }, /receipt attachment/],
    ];
    for (const [extra, pattern] of cases) {
      const world = unexplainedManualWorld({
        unexplained_amount: "0.0",
        bank_transaction_explanations: [
          { url: `${EXP}/9`, bank_transaction: `${TX}/555`, dated_on: "2026-09-01", gross_value: "12.00", ...extra },
        ],
      });
      const { client, calls } = makeClient(world);
      await expect(
        deleteBankTransaction(client, args({ bank_transaction_id: "555", delete_explanations: true }))
      ).rejects.toThrow(pattern);
      noDeletes(calls);
    }
  });

  it("allows an empty attachments array", async () => {
    const world = unexplainedManualWorld({
      unexplained_amount: "0.0",
      bank_transaction_explanations: [
        { url: `${EXP}/9`, bank_transaction: `${TX}/555`, dated_on: "2026-09-01", gross_value: "12.00", attachments: [] },
      ],
    });
    const { client, store } = makeClient(world);
    const result = await deleteBankTransaction(client, args({ bank_transaction_id: "555", delete_explanations: true }));
    expect(result).toContain("Verified: it no longer exists");
    expect(store.has("/bank_transactions/555")).toBe(false);
  });

  it("says which way the balance moves", async () => {
    const out = await deleteBankTransaction(makeClient(fakeCounterpartWorld()).client,
      args({ bank_transaction_id: "100000201", delete_explanations: true }));
    expect(out).toContain("balance goes up by 35.00 (a 35.00 payment out was removed)");
    const inWorld = unexplainedManualWorld({ unexplained_amount: "12.00" });
    const outIn = await deleteBankTransaction(makeClient(inWorld).client, args({ bank_transaction_id: "555" }));
    expect(outIn).toContain("balance goes down by 12.00 (a 12.00 receipt was removed)");
  });

  it("refuses when the transfer partner explanation is unsafe", async () => {
    const world = fakeCounterpartWorld();
    (world["/bank_transaction_explanations/200000202"].bank_transaction_explanation as Record<string, unknown>).attachment = {
      file_name: "receipt.pdf",
      content_src: "https://signed.example/secret",
    };
    const { client, calls } = makeClient(world);
    const error = await deleteBankTransaction(client, args({ bank_transaction_id: "100000201", delete_explanations: true })).catch((e: Error) => e);
    expect((error as Error).message).toMatch(/partner explanation 200000202 has a receipt attachment/);
    expect((error as Error).message).not.toContain("signed.example");
    noDeletes(calls);
  });

  it("refuses a kept copy that is manual, too far apart, or differently described", async () => {
    const tweak = (patch: Record<string, unknown>) => {
      const world = duplicateWorld();
      Object.assign(world["/bank_transactions/100000101"].bank_transaction, patch);
      return world;
    };
    const cases: Array<[Record<string, unknown>, RegExp]> = [
      [{ is_manual: true }, /copy to keep \(100000101\) is manual/],
      [{ dated_on: "2026-08-24" }, /more than 3 days apart/], // a weekly payment, same amount
      [{ description: "SPOTIFY P1234" }, /descriptions don't match/],
    ];
    for (const [patch, pattern] of cases) {
      const { client, calls } = makeClient(tweak(patch));
      await expect(
        deleteBankTransaction(
          client,
          args({ bank_transaction_id: "100000102", allow_imported: true, duplicate_of: "100000101", delete_explanations: true })
        )
      ).rejects.toThrow(pattern);
      noDeletes(calls);
    }
  });

  it("validates duplicate_of when given for a manual transaction", async () => {
    const { client, calls } = makeClient(unexplainedManualWorld());
    await expect(
      deleteBankTransaction(client, args({ bank_transaction_id: "555", duplicate_of: "999" }))
    ).rejects.toThrow(/duplicate_of 999 does not exist/);
    noDeletes(calls);
  });

  it("refuses a URL from a different FreeAgent environment", async () => {
    const { client, calls } = makeClient(unexplainedManualWorld());
    await expect(
      deleteBankTransaction(client, args({ bank_transaction_id: "https://api.sandbox.freeagent.com/v2/bank_transactions/555" }))
    ).rejects.toThrow(/different FreeAgent environment/);
    noDeletes(calls);
  });

  it("adds 'Nothing was deleted.' to raw API errors before any change", async () => {
    const world = fakeCounterpartWorld() as Record<string, unknown>;
    delete world["/bank_transaction_explanations/200000201"];
    const { client, calls } = makeClient(world, {
      noAutoExplanations: true,
    });
    (client.get as ReturnType<typeof vi.fn>).mockImplementationOnce(async () => ({
      data: structuredClone(world["/bank_transactions/100000201"]),
      headers: {},
    }));
    (client.get as ReturnType<typeof vi.fn>).mockImplementationOnce(async () => {
      throw new Error("Rate limit exceeded and automatic retries (2) were exhausted.");
    });
    await expect(
      deleteBankTransaction(client, args({ bank_transaction_id: "100000201", delete_explanations: true }))
    ).rejects.toThrow(/Rate limit exceeded.*Nothing was deleted\./);
    noDeletes(calls);
  });

  it("counts an explanation whose delete errored but succeeded on the server, and checks its partner", async () => {
    const { client } = makeClient(fakeCounterpartWorld(), {
      onDelete: unpairPartner,
      explanationDeleteErrorsAfterSuccess: {
        "/bank_transaction_explanations/200000201": new Error("Request timeout. The FreeAgent API took too long to respond."),
      },
    });
    const error = await deleteBankTransaction(client, args({ bank_transaction_id: "100000201", delete_explanations: true })).catch((e: Error) => e);
    const message = (error as Error).message;
    expect(message).toContain("did not complete: Request timeout");
    expect(message).toContain("Explanations removed**: 1");
    expect(message).toContain("is now unexplained (35.0)");
    expect(message).not.toContain("Nothing was changed");
    expect(message).toContain('"transfer_partner_explanations"');
  });

  it("says nothing changed when an errored explanation delete really failed", async () => {
    const { client } = makeClient(fakeCounterpartWorld(), {
      deleteErrors: { "/bank_transaction_explanations/200000201": new Error("API error: refused") },
    });
    await expect(
      deleteBankTransaction(client, args({ bank_transaction_id: "100000201", delete_explanations: true }))
    ).rejects.toThrow(/did not complete: API error: refused.*still exists\. Nothing appears to have changed.*delete_attempted_but_still_present/s);
  });
});

describe("deleteBankTransaction: third-review hardening", () => {
  const noDeletes = (calls: string[]) => expect(calls.some((c) => c.startsWith("delete"))).toBe(false);

  it("refuses imported pairs whose descriptions show different charges", async () => {
    const world = duplicateWorld({ description: "CANVA* I01235-1111111" });
    (world["/bank_transactions/100000101"].bank_transaction as Record<string, unknown>).description = "CANVA* I01234-7654321";
    const { client, calls } = makeClient(world);
    await expect(
      deleteBankTransaction(
        client,
        args({ bank_transaction_id: "100000102", allow_imported: true, duplicate_of: "100000101", delete_explanations: true })
      )
    ).rejects.toThrow(/descriptions don't match/);
    noDeletes(calls);
  });

  it("refuses prefix-only description matches between imported rows", async () => {
    for (const [mine, theirs] of [
      ["AMAZON 1234", "AMAZON 123"],
      ["FASTER PAYMENT ACME", "FASTER PAYMENT"],
      ["LICKD LONDON GB , 5064 15AUG26//POS/", "LICKD/LONDON GB"],
    ]) {
      const world = duplicateWorld({ description: mine });
      (world["/bank_transactions/100000101"].bank_transaction as Record<string, unknown>).description = theirs;
      const { client, calls } = makeClient(world);
      await expect(
        deleteBankTransaction(
          client,
          args({ bank_transaction_id: "100000102", allow_imported: true, duplicate_of: "100000101", delete_explanations: true })
        )
      ).rejects.toThrow(/descriptions don't match/);
      noDeletes(calls);
    }
  });

  it("matches a manual transaction's duplicate_of on account, amount and date only", async () => {
    const world = {
      ...unexplainedManualWorld({ description: "Canva subscription", amount: "-9.87", dated_on: "2026-08-17", unexplained_amount: "-9.87" }),
      "/bank_transactions/100000101": duplicateWorld()["/bank_transactions/100000101"],
    };
    const { client } = makeClient(world);
    const result = await deleteBankTransaction(client, args({ bank_transaction_id: "555", duplicate_of: "100000101" }));
    expect(result).toContain("Checked against**: 100000101");
    expect(result).toContain("descriptions not compared");
    expect(result).not.toContain("Duplicate of (kept)");
  });

  it("refuses has_pending_operation and direct_contact links", async () => {
    for (const [extra, pattern] of [
      [{ has_pending_operation: true }, /pending operation/],
      [{ direct_contact: "https://api.freeagent.com/v2/contacts/7" }, /linked to direct_contact/],
    ] as Array<[Record<string, unknown>, RegExp]>) {
      const world = unexplainedManualWorld({
        unexplained_amount: "0.0",
        bank_transaction_explanations: [
          { url: `${EXP}/9`, bank_transaction: `${TX}/555`, dated_on: "2026-09-01", gross_value: "12.00", ...extra },
        ],
      });
      const { client, calls } = makeClient(world);
      await expect(
        deleteBankTransaction(client, args({ bank_transaction_id: "555", delete_explanations: true }))
      ).rejects.toThrow(pattern);
      noDeletes(calls);
    }
  });

  it("continues when a later explanation delete 404s because FreeAgent already removed it", async () => {
    const world = unexplainedManualWorld({
      unexplained_amount: "0.0",
      bank_transaction_explanations: [
        { url: `${EXP}/8`, bank_transaction: `${TX}/555`, dated_on: "2026-09-01", gross_value: "6.00" },
        { url: `${EXP}/9`, bank_transaction: `${TX}/555`, dated_on: "2026-09-01", gross_value: "6.00" },
      ],
    });
    const { client, calls, store } = makeClient(world, {
      // Deleting explanation 8 makes FreeAgent drop explanation 9 as well.
      onDelete: (path, s) => {
        if (path !== "/bank_transaction_explanations/8") return;
        s.delete("/bank_transaction_explanations/9");
        const tx = (s.get("/bank_transactions/555") as { bank_transaction: { bank_transaction_explanations: unknown[] } })
          .bank_transaction;
        tx.bank_transaction_explanations = [];
      },
    });
    const result = await deleteBankTransaction(client, args({ bank_transaction_id: "555", delete_explanations: true }));
    expect(calls).toContain("delete /bank_transaction_explanations/9");
    expect(store.has("/bank_transaction_explanations/9")).toBe(false);
    expect(result).toContain("Explanations removed**: 2");
    expect(calls).toContain("delete /bank_transactions/555");
    expect(store.has("/bank_transactions/555")).toBe(false);
  });

  it("warns if the kept copy has also disappeared", async () => {
    const { client } = makeClient(duplicateWorld(), {
      onDelete: (path, store) => {
        if (path === "/bank_transactions/100000102") store.delete("/bank_transactions/100000101");
      },
    });
    const result = await deleteBankTransaction(
      client,
      args({ bank_transaction_id: "100000102", allow_imported: true, duplicate_of: "100000101", delete_explanations: true })
    );
    expect(result).toContain("The copy you kept (100000101) no longer exists either");
  });

  it("accepts an upper-case host for the same environment", async () => {
    const { client } = makeClient(unexplainedManualWorld());
    const result = await deleteBankTransaction(client, args({ bank_transaction_id: "https://API.FREEAGENT.COM/v2/bank_transactions/555" }));
    expect(result).toContain("Verified");
  });

  it("refuses to run on the hosted deployment", async () => {
    const { client, calls } = makeClient(unexplainedManualWorld());
    vi.stubEnv("VERCEL", "1");
    try {
      await expect(deleteBankTransaction(client, args({ bank_transaction_id: "555" }))).rejects.toThrow(/hosted deployment/);
    } finally {
      vi.unstubAllEnvs();
    }
    expect(calls).toEqual([]);
  });

  it("cannot be reached through freeagent_call_tool", async () => {
    const { client, calls } = makeClient(unexplainedManualWorld());
    await expect(
      callTool(toolDefinitions, client, { name: "freeagent_delete_bank_transaction", arguments: { bank_transaction_id: "555", confirm: true, reason: "long enough reason" } }, {
        clientSupportsElicitation: false,
        elicit: vi.fn(),
      } as never)
    ).rejects.toThrow(/can't be called through freeagent_call_tool/);
    expect(calls).toEqual([]);
  });
});

describe("deleteBankTransaction: Grok review", () => {
  it("only advises re-explaining when the transfer partner exists and is now unexplained", async () => {
    // Partner left explained (FreeAgent only unpaired it).
    const stillExplained = makeClient(fakeCounterpartWorld());
    const r1 = await deleteBankTransaction(stillExplained.client, args({ bank_transaction_id: "100000201", delete_explanations: true }));
    expect(r1).toContain("is still explained");
    expect(r1).not.toContain("make sure its real counterpart is unexplained");

    // Partner transaction removed along with the pairing.
    const removePartner = (path: string, store: Store) => {
      if (path === "/bank_transaction_explanations/200000201") store.delete("/bank_transactions/100000202");
    };
    const gone = makeClient(fakeCounterpartWorld(), { onDelete: removePartner });
    const r2 = await deleteBankTransaction(gone.client, args({ bank_transaction_id: "100000201", delete_explanations: true }));
    expect(r2).toContain("no longer exists (FreeAgent removed it with the pairing)");
    expect(r2).toContain("re-add it from the statement");
    expect(r2).not.toContain("make sure its real counterpart is unexplained");
  });

  it("says so when the kept copy can't be re-checked after the delete", async () => {
    const { client } = makeClient(duplicateWorld(), {
      getErrorsAfterDeletes: {
        afterDeletes: 2,
        path: "/bank_transactions/100000101",
        error: new Error("Rate limit exceeded and automatic retries (2) were exhausted."),
      },
    });
    const result = await deleteBankTransaction(
      client,
      args({ bank_transaction_id: "100000102", allow_imported: true, duplicate_of: "100000101", delete_explanations: true })
    );
    expect(result).toContain("Couldn't re-check 100000101 after the delete (Rate limit exceeded");
  });
});
