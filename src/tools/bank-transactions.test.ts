import { describe, it, expect, vi } from "vitest";
import { MAX_ATTACHMENT_BYTES } from "../constants.js";
import {
  CreateBankTransactionExplanationInputSchema,
  UpdateBankTransactionExplanationInputSchema,
} from "../schemas/index.js";
import { createBankTransactionExplanation, updateBankTransactionExplanation } from "./bank-transactions.js";
import type { FreeAgentApiClient } from "../services/api-client.js";

const smallPdf = Buffer.from("%PDF-1.4 tiny").toString("base64");

function makeClient() {
  const respond = async (_path: string, _body?: unknown) => ({
    data: {
      bank_transaction_explanation: {
        url: "https://api.freeagent.com/v2/bank_transaction_explanations/42",
        dated_on: "2026-08-01",
        gross_value: "-10.00",
        description: "Receipt attached",
        bank_transaction: "https://api.freeagent.com/v2/bank_transactions/1",
      },
    },
    headers: {},
  });
  const put = vi.fn(respond);
  const post = vi.fn(respond);
  const client = {
    put,
    get: vi.fn(),
    post,
    parsePaginationHeaders: () => ({ hasMore: false }),
  } as unknown as FreeAgentApiClient;
  return { client, put, post };
}

describe("UpdateBankTransactionExplanationInputSchema attachment", () => {
  it("accepts the same attachment block as create", () => {
    const result = UpdateBankTransactionExplanationInputSchema.safeParse({
      bank_transaction_explanation_id: "42",
      attachment: {
        data: smallPdf,
        file_name: "receipt.pdf",
        content_type: "application/pdf",
      },
    });
    expect(result.success).toBe(true);
  });

  it("rejects an unsupported content type", () => {
    const result = UpdateBankTransactionExplanationInputSchema.safeParse({
      bank_transaction_explanation_id: "42",
      attachment: {
        data: smallPdf,
        file_name: "notes.txt",
        content_type: "text/plain",
      },
    });
    expect(result.success).toBe(false);
  });
});

describe("updateBankTransactionExplanation attachment", () => {
  it("includes a valid attachment on the PUT body", async () => {
    const { client, put } = makeClient();
    const result = await updateBankTransactionExplanation(client, {
      bank_transaction_explanation_id: "42",
      attachment: {
        data: smallPdf,
        file_name: "receipt.pdf",
        content_type: "application/pdf",
      },
    });
    expect(result).toContain("receipt.pdf");
    const body = put.mock.calls[0][1] as {
      bank_transaction_explanation: { attachment: Record<string, string> };
    };
    expect(body.bank_transaction_explanation.attachment).toMatchObject({
      file_name: "receipt.pdf",
      content_type: "application/pdf",
      data: smallPdf,
    });
  });

  it("rejects an over-limit attachment before calling the API", async () => {
    const { client, put } = makeClient();
    await expect(
      updateBankTransactionExplanation(client, {
        bank_transaction_explanation_id: "42",
        attachment: {
          data: Buffer.alloc(MAX_ATTACHMENT_BYTES + 1).toString("base64"),
          file_name: "huge.pdf",
          content_type: "application/pdf",
        },
      })
    ).rejects.toThrow(/8MB/);
    expect(put).not.toHaveBeenCalled();
  });
});

describe("bank explanation sales_tax_rate (mocked, no live calls)", () => {
  const base = {
    bank_transaction: "https://api.freeagent.com/v2/bank_transactions/1",
    dated_on: "2026-08-01",
    gross_value: "-12.00",
  };

  type SentBody = { bank_transaction_explanation: Record<string, unknown> };

  it.each([
    ["auto", "Auto"],
    ["AUTO", "Auto"],
    ["20.0", "20.0"],
    ["0.0", "0.0"],
  ])("create sends %s as %s", async (input, expected) => {
    const { client, post } = makeClient();
    const params = CreateBankTransactionExplanationInputSchema.parse({ ...base, sales_tax_rate: input });
    await createBankTransactionExplanation(client, params);
    const body = post.mock.calls[0][1] as SentBody;
    expect(body.bank_transaction_explanation.sales_tax_rate).toBe(expected);
    expect(body.bank_transaction_explanation).not.toHaveProperty("second_sales_tax_rate");
  });

  it.each([
    ["Auto", "Auto"],
    ["20.0", "20.0"],
    ["0.0", "0.0"],
  ])("update sends %s as %s", async (input, expected) => {
    const { client, put } = makeClient();
    const params = UpdateBankTransactionExplanationInputSchema.parse({
      bank_transaction_explanation_id: "42",
      sales_tax_rate: input,
    });
    await updateBankTransactionExplanation(client, params);
    const body = put.mock.calls[0][1] as SentBody;
    expect(body.bank_transaction_explanation.sales_tax_rate).toBe(expected);
    expect(body.bank_transaction_explanation).not.toHaveProperty("second_sales_tax_rate");
  });

  it("rejects fractional '0.20' at the schema before any API call", () => {
    const { post, put } = makeClient();
    expect(
      CreateBankTransactionExplanationInputSchema.safeParse({ ...base, sales_tax_rate: "0.20" }).success
    ).toBe(false);
    expect(
      UpdateBankTransactionExplanationInputSchema.safeParse({
        bank_transaction_explanation_id: "42",
        sales_tax_rate: "0.20",
      }).success
    ).toBe(false);
    expect(post).not.toHaveBeenCalled();
    expect(put).not.toHaveBeenCalled();
  });
});
