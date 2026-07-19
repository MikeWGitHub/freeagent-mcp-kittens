import { describe, it, expect, vi } from "vitest";
import { uploadBankStatement } from "./statement-upload.js";
import type { FreeAgentApiClient } from "../services/api-client.js";
import type { UploadBankStatementInput } from "../schemas/index.js";

const URL_BASE = "https://api.sandbox.freeagent.com/v2/bank_transactions";

function txn(id: number, dated_on: string, amount: string, description: string) {
  return { url: `${URL_BASE}/${id}`, dated_on, amount, description };
}

const noSleep = vi.fn().mockResolvedValue(undefined);

/**
 * Builds a client whose successive GET /bank_transactions calls return the
 * given listings in order (first call = pre-upload snapshot, later calls =
 * verification polls). POST always succeeds.
 */
function clientWithListings(listings: ReturnType<typeof txn>[][]): {
  client: FreeAgentApiClient;
  get: ReturnType<typeof vi.fn>;
  post: ReturnType<typeof vi.fn>;
} {
  const get = vi.fn();
  for (const listing of listings) {
    get.mockResolvedValueOnce({ data: { bank_transactions: listing }, headers: {} });
  }
  // Any further polls repeat the final listing.
  get.mockResolvedValue({
    data: { bank_transactions: listings[listings.length - 1] },
    headers: {},
  });
  const post = vi.fn().mockResolvedValue({ data: {}, headers: {} });
  return { client: { get, post } as unknown as FreeAgentApiClient, get, post };
}

const twoRows: UploadBankStatementInput = {
  bank_account: "47248",
  transactions: [
    { dated_on: "2026-07-19", amount: -12.34, description: "ROW A", fitid: "A1" },
    { dated_on: "2026-07-19", amount: -23.45, description: "ROW B", fitid: "B1" },
  ],
} as UploadBankStatementInput;

describe("uploadBankStatement verification", () => {
  it("reports rows as imported only when they are NEW relative to the pre-upload snapshot", async () => {
    const stale = [txn(1, "2026-07-16", "75.0", "OLD RECEIPT")];
    const { client } = clientWithListings([
      stale, // pre-upload snapshot
      [...stale, txn(2, "2026-07-19", "-12.34", "ROW A"), txn(3, "2026-07-19", "-23.45", "ROW B")],
    ]);

    const result = await uploadBankStatement(client, twoRows, noSleep);

    expect(result).toContain("**Imported in this upload**: 2");
    expect(result).toContain("ROW A");
    expect(result).not.toContain("OLD RECEIPT");
    expect(result).not.toContain("⚠️");
  });

  it("keeps polling while the async import has not landed yet", async () => {
    const stale = [txn(1, "2026-07-16", "75.0", "OLD RECEIPT")];
    const landed = [...stale, txn(2, "2026-07-19", "-12.34", "ROW A"), txn(3, "2026-07-19", "-23.45", "ROW B")];
    const { client, get } = clientWithListings([stale, stale, stale, landed]);

    const result = await uploadBankStatement(client, twoRows, noSleep);

    expect(result).toContain("**Imported in this upload**: 2");
    expect(get.mock.calls.length).toBe(4); // snapshot + 3 polls
  });

  it("fires the dedupe warning when a sent row never appears", async () => {
    // Row A already exists (would be deduped); only row B is new.
    const existing = [txn(2, "2026-07-19", "-12.34", "ROW A")];
    const { client } = clientWithListings([
      existing,
      [...existing, txn(3, "2026-07-19", "-23.45", "ROW B")],
    ]);

    const result = await uploadBankStatement(client, twoRows, noSleep);

    expect(result).toContain("**Imported in this upload**: 1");
    expect(result).toContain("⚠️ 1 row(s) did not appear");
    expect(result).toContain("de-duplication");
  });

  it("fires the dedupe warning when NOTHING new appears (full dedupe)", async () => {
    const existing = [
      txn(2, "2026-07-19", "-12.34", "ROW A"),
      txn(3, "2026-07-19", "-23.45", "ROW B"),
    ];
    const { client, get } = clientWithListings([existing, existing]);

    const result = await uploadBankStatement(client, twoRows, noSleep);

    expect(result).toContain("**Imported in this upload**: 0");
    expect(result).toContain("⚠️ 2 row(s) did not appear");
    expect(get.mock.calls.length).toBe(4); // snapshot + all 3 polls exhausted
  });

  it("warns when more new rows appear than were sent (concurrent activity)", async () => {
    const { client } = clientWithListings([
      [],
      [
        txn(2, "2026-07-19", "-12.34", "ROW A"),
        txn(3, "2026-07-19", "-23.45", "ROW B"),
        txn(4, "2026-07-19", "-99.99", "SOMETHING ELSE"),
      ],
    ]);

    const result = await uploadBankStatement(client, twoRows, noSleep);

    expect(result).toContain("**Imported in this upload**: 3");
    expect(result).toContain("More new transactions appeared");
  });

  it("queries the full date range spanned by the sent rows", async () => {
    const multiDate: UploadBankStatementInput = {
      bank_account: "47248",
      transactions: [
        { dated_on: "2026-07-10", amount: -1, description: "EARLY" },
        { dated_on: "2026-07-19", amount: -2, description: "LATE" },
      ],
    } as UploadBankStatementInput;
    const { client, get } = clientWithListings([[], []]);

    await uploadBankStatement(client, multiDate, noSleep);

    expect(get).toHaveBeenCalledWith(
      "/bank_transactions",
      expect.objectContaining({ from_date: "2026-07-10", to_date: "2026-07-19" })
    );
  });
});
