import { describe, it, expect, vi } from "vitest";
import { gzipSync } from "zlib";
import { MAX_ATTACHMENT_BYTES } from "../constants.js";
import { UpdateBankTransactionExplanationInputSchema } from "../schemas/index.js";
import {
  buildAttachmentPayload,
  updateBankTransactionExplanation,
} from "./bank-transactions.js";
import type { FreeAgentApiClient } from "../services/api-client.js";

const smallPdf = Buffer.from("%PDF-1.4 tiny").toString("base64");

function makeClient() {
  const put = vi.fn(async (_path: string, _body?: unknown) => ({
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
  }));
  const client = {
    put,
    get: vi.fn(),
    post: vi.fn(),
    parsePaginationHeaders: () => ({ hasMore: false }),
  } as unknown as FreeAgentApiClient;
  return { client, put };
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

describe("buildAttachmentPayload size cap", () => {
  it("accepts a small uncompressed attachment", () => {
    const payload = buildAttachmentPayload({
      data: smallPdf,
      file_name: "receipt.pdf",
      content_type: "application/pdf",
      description: "Taxi",
    });
    expect(payload.file_name).toBe("receipt.pdf");
    expect(payload.content_type).toBe("application/pdf");
    expect(payload.description).toBe("Taxi");
    expect(payload.data).toBe(smallPdf);
  });

  it("rejects an uncompressed attachment over 8MB", () => {
    const data = Buffer.alloc(MAX_ATTACHMENT_BYTES + 1).toString("base64");
    expect(() =>
      buildAttachmentPayload({
        data,
        file_name: "huge.pdf",
        content_type: "application/pdf",
      })
    ).toThrow(/8MB/);
  });

  it("rejects a gzip bomb that expands past 8MB", () => {
    const data = gzipSync(Buffer.alloc(MAX_ATTACHMENT_BYTES + 1)).toString("base64");
    expect(() =>
      buildAttachmentPayload({
        data,
        is_gzipped: true,
        file_name: "bomb.pdf",
        content_type: "application/pdf",
      })
    ).toThrow(/8MB/);
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
