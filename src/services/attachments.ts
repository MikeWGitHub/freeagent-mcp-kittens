/**
 * Shared attachment payload builder for expenses and bank-transaction
 * explanations. Enforces the 8MB decoded-size cap, including gzip
 * maxOutputLength (audit S-MED-1).
 */

import { gunzipSync } from "zlib";
import { MAX_ATTACHMENT_BYTES } from "../constants.js";

export type AttachmentInput = {
  data: string;
  is_gzipped?: boolean;
  file_name: string;
  content_type: string;
  description?: string;
};

function isAttachmentTooLarge(error: unknown): boolean {
  if (!error || typeof error !== "object") return false;
  const e = error as { code?: string; message?: string };
  const message = (e.message ?? "").toLowerCase();
  return e.code === "ERR_BUFFER_TOO_LARGE" || message.includes("maxoutputlength") || message.includes("too large");
}

/**
 * Decode (and optionally gunzip) an attachment, enforcing MAX_ATTACHMENT_BYTES.
 */
export function buildAttachmentPayload(attachment: AttachmentInput): Record<string, string> {
  let bytes: Buffer;

  if (attachment.is_gzipped) {
    try {
      bytes = gunzipSync(Buffer.from(attachment.data, "base64"), { maxOutputLength: MAX_ATTACHMENT_BYTES });
    } catch (error) {
      if (isAttachmentTooLarge(error)) {
        throw new Error(
          `Attachment exceeds the ${MAX_ATTACHMENT_BYTES} byte (8MB) decoded-size limit after decompression.`
        );
      }
      throw new Error(`Failed to decompress gzipped attachment: ${error instanceof Error ? error.message : "Unknown error"}`);
    }
  } else {
    bytes = Buffer.from(attachment.data, "base64");
    if (bytes.byteLength > MAX_ATTACHMENT_BYTES) {
      throw new Error(
        `Attachment exceeds the ${MAX_ATTACHMENT_BYTES} byte (8MB) decoded-size limit.`
      );
    }
  }

  const payload: Record<string, string> = {
    data: bytes.toString("base64"),
    file_name: attachment.file_name,
    content_type: attachment.content_type,
  };
  if (attachment.description) payload.description = attachment.description;
  return payload;
}
