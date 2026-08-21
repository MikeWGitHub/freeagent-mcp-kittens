import { describe, it, expect, vi } from "vitest";
import {
  CreateJournalSetInputSchema,
  DeleteJournalSetInputSchema,
  DeleteBankTransactionExplanationInputSchema,
  UploadBankStatementInputSchema,
} from "../schemas/index.js";
import { createJournalSet } from "./journal-sets.js";
import type { FreeAgentApiClient } from "../services/api-client.js";

describe("CreateJournalSetInputSchema", () => {
  const base = {
    dated_on: "2026-04-05",
    description: "FY25-26 Corporation Tax zeroing - IoM 0% rate",
    confirm: true as const,
  };

  it("accepts a balanced two-entry set", () => {
    const result = CreateJournalSetInputSchema.safeParse({
      ...base,
      journal_entries: [
        { category: "Corporation Tax", debit_value: 500 },
        { category: "625", debit_value: -500 },
      ],
    });
    expect(result.success).toBe(true);
  });

  it("rejects an unbalanced set", () => {
    const result = CreateJournalSetInputSchema.safeParse({
      ...base,
      journal_entries: [
        { category: "Corporation Tax", debit_value: 500 },
        { category: "625", debit_value: -499.99 },
      ],
    });
    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error.issues[0].message).toContain("does not balance");
    }
  });

  it("tolerates sub-penny floating point residue", () => {
    const result = CreateJournalSetInputSchema.safeParse({
      ...base,
      journal_entries: [
        { category: "A", debit_value: 0.1 },
        { category: "B", debit_value: 0.2 },
        { category: "C", debit_value: -0.3 },
      ],
    });
    expect(result.success).toBe(true);
  });

  it("rejects a single-entry set", () => {
    const result = CreateJournalSetInputSchema.safeParse({
      ...base,
      journal_entries: [{ category: "A", debit_value: 0 }],
    });
    expect(result.success).toBe(false);
  });

  it("rejects an invalid date format", () => {
    const result = CreateJournalSetInputSchema.safeParse({
      ...base,
      dated_on: "05/04/2026",
      journal_entries: [
        { category: "A", debit_value: 1 },
        { category: "B", debit_value: -1 },
      ],
    });
    expect(result.success).toBe(false);
  });

  it("requires confirm: true", () => {
    const entries = [
      { category: "A", debit_value: 1 },
      { category: "B", debit_value: -1 },
    ];
    expect(
      CreateJournalSetInputSchema.safeParse({
        dated_on: "2026-04-05",
        description: "x",
        journal_entries: entries,
      }).success
    ).toBe(false);
    expect(
      CreateJournalSetInputSchema.safeParse({
        dated_on: "2026-04-05",
        description: "x",
        confirm: false,
        journal_entries: entries,
      }).success
    ).toBe(false);
  });
});

describe("delete confirmations", () => {
  it("requires confirm: true on journal set delete", () => {
    expect(
      DeleteJournalSetInputSchema.safeParse({ journal_set_id: "37" }).success
    ).toBe(false);
    expect(
      DeleteJournalSetInputSchema.safeParse({ journal_set_id: "37", confirm: false }).success
    ).toBe(false);
    expect(
      DeleteJournalSetInputSchema.safeParse({ journal_set_id: "37", confirm: true }).success
    ).toBe(true);
  });

  it("requires confirm: true on explanation delete", () => {
    expect(
      DeleteBankTransactionExplanationInputSchema.safeParse({
        bank_transaction_explanation_id: "399001668",
      }).success
    ).toBe(false);
    expect(
      DeleteBankTransactionExplanationInputSchema.safeParse({
        bank_transaction_explanation_id: "399001668",
        confirm: true,
      }).success
    ).toBe(true);
  });
});

describe("UploadBankStatementInputSchema", () => {
  it("accepts a well-formed statement row", () => {
    const result = UploadBankStatementInputSchema.safeParse({
      bank_account: "235558",
      confirm: true,
      transactions: [
        {
          dated_on: "2023-06-12",
          amount: -500,
          description: "ESS REVOLUT MAIN (second transfer)",
          fitid: "202306120002",
        },
      ],
    });
    expect(result.success).toBe(true);
  });

  it("rejects an empty transaction list", () => {
    const result = UploadBankStatementInputSchema.safeParse({
      bank_account: "235558",
      confirm: true,
      transactions: [],
    });
    expect(result.success).toBe(false);
  });

  it("rejects an upload without confirm: true", () => {
    const result = UploadBankStatementInputSchema.safeParse({
      bank_account: "235558",
      transactions: [{ dated_on: "2023-06-12", amount: -500, description: "x" }],
    });
    expect(result.success).toBe(false);
  });

  it("rejects unknown transaction types", () => {
    const result = UploadBankStatementInputSchema.safeParse({
      bank_account: "235558",
      confirm: true,
      transactions: [
        { dated_on: "2023-06-12", amount: -500, description: "x", transaction_type: "BOGUS" },
      ],
    });
    expect(result.success).toBe(false);
  });
});

describe("createJournalSet handler confirm + balance", () => {
  const balanced = [
    { category: "https://api.freeagent.com/v2/categories/625", debit_value: 500 },
    { category: "https://api.freeagent.com/v2/categories/001", debit_value: -500 },
  ];

  function makeClient() {
    const post = vi.fn(async () => ({
      data: {
        journal_set: {
          url: "https://api.freeagent.com/v2/journal_sets/9",
          dated_on: "2026-04-05",
          description: "test",
          journal_entries: [],
        },
      },
      headers: {},
    }));
    const client = {
      get: vi.fn(),
      post,
      parsePaginationHeaders: () => ({ hasMore: false }),
      resourceUrl: (resource: string, idOrUrl: string) =>
        idOrUrl.startsWith("http") ? idOrUrl : `https://api.freeagent.com/v2/${resource}/${idOrUrl}`,
    } as unknown as FreeAgentApiClient;
    return { client, post };
  }

  it("refuses to post without confirm: true", async () => {
    const { client, post } = makeClient();
    await expect(
      createJournalSet(client, {
        dated_on: "2026-04-05",
        description: "test",
        journal_entries: balanced,
      } as Parameters<typeof createJournalSet>[1])
    ).rejects.toThrow(/confirm: true/);
    expect(post).not.toHaveBeenCalled();
  });

  it("still rejects an unbalanced set in the handler (schema refine does not survive .shape)", async () => {
    const { client, post } = makeClient();
    await expect(
      createJournalSet(client, {
        dated_on: "2026-04-05",
        description: "test",
        confirm: true,
        journal_entries: [
          { category: "A", debit_value: 1 },
          { category: "B", debit_value: -2 },
        ],
      })
    ).rejects.toThrow(/does not balance/);
    expect(post).not.toHaveBeenCalled();
  });
});
