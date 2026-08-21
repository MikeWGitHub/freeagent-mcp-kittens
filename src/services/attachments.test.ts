import { describe, it, expect } from "vitest";
import { gzipSync } from "zlib";
import { MAX_ATTACHMENT_BYTES } from "../constants.js";
import { buildAttachmentPayload } from "./attachments.js";

const smallPdf = Buffer.from("%PDF-1.4 tiny").toString("base64");

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
