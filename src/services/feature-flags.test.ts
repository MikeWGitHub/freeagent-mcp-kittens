import { describe, it, expect, afterEach, vi } from "vitest";
import { mkdtempSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { isDeleteEnabled, DEFAULT_MARKER_PATH, ENABLE_DELETE_MARKER } from "./feature-flags.js";
import { toolDefinitions, withOptInTools, registerAllTools } from "../tools/register.js";
import { deleteBankTransaction } from "../tools/delete-bank-transaction.js";
import type { FreeAgentApiClient } from "./api-client.js";

const dirs: string[] = [];
function marker(exists: boolean): string {
  const dir = mkdtempSync(join(tmpdir(), "fa-flag-"));
  dirs.push(dir);
  const path = join(dir, ENABLE_DELETE_MARKER);
  if (exists) writeFileSync(path, "");
  return path;
}

afterEach(() => {
  vi.unstubAllEnvs();
  for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true });
});

describe("isDeleteEnabled (v1.2.5 opt-in)", () => {
  it("is off by default: no env var and no marker file", () => {
    expect(isDeleteEnabled({}, marker(false))).toBe(false);
  });

  it("turns on with FREEAGENT_ENABLE_DELETE=true or 1", () => {
    expect(isDeleteEnabled({ FREEAGENT_ENABLE_DELETE: "true" }, marker(false))).toBe(true);
    expect(isDeleteEnabled({ FREEAGENT_ENABLE_DELETE: "1" }, marker(false))).toBe(true);
    expect(isDeleteEnabled({ FREEAGENT_ENABLE_DELETE: " TRUE " }, marker(false))).toBe(true);
  });

  it("turns on with the marker file", () => {
    expect(isDeleteEnabled({}, marker(true))).toBe(true);
  });

  it("an explicit false or 0 wins over the marker file", () => {
    expect(isDeleteEnabled({ FREEAGENT_ENABLE_DELETE: "false" }, marker(true))).toBe(false);
    expect(isDeleteEnabled({ FREEAGENT_ENABLE_DELETE: "0" }, marker(true))).toBe(false);
  });

  it("ignores other values and falls back to the marker", () => {
    expect(isDeleteEnabled({ FREEAGENT_ENABLE_DELETE: "yes" }, marker(false))).toBe(false);
    expect(isDeleteEnabled({ FREEAGENT_ENABLE_DELETE: "yes" }, marker(true))).toBe(true);
  });

  it("looks for the marker in the server root, next to package.json", () => {
    // vitest runs from the repo root, which is also where package.json lives.
    expect(DEFAULT_MARKER_PATH).toBe(join(process.cwd(), ENABLE_DELETE_MARKER));
  });
});

describe("delete tool registration", () => {
  it("withOptInTools drops only the delete tool when disabled", () => {
    const off = withOptInTools(toolDefinitions, false);
    expect(off.map((t) => t.name)).not.toContain("freeagent_delete_bank_transaction");
    expect(off).toHaveLength(toolDefinitions.length - 1);
    expect(withOptInTools(toolDefinitions, true)).toHaveLength(toolDefinitions.length);
  });

  function registeredNames(): string[] {
    const names: string[] = [];
    const server = {
      registerTool: vi.fn((name: string) => names.push(name)),
      server: { getClientCapabilities: () => ({}), elicitInput: vi.fn() },
    };
    registerAllTools(server as never, {} as FreeAgentApiClient);
    return names;
  }

  it("registerAllTools leaves it out when the machine hasn't opted in", () => {
    vi.stubEnv("FREEAGENT_ENABLE_DELETE", "false");
    const names = registeredNames();
    expect(names).not.toContain("freeagent_delete_bank_transaction");
    expect(names).toContain("freeagent_delete_bank_transaction_explanation");
  });

  it("registerAllTools includes it when opted in", () => {
    vi.stubEnv("FREEAGENT_ENABLE_DELETE", "true");
    expect(registeredNames()).toContain("freeagent_delete_bank_transaction");
  });

  it("the handler itself refuses when disabled, before any API call", async () => {
    vi.stubEnv("FREEAGENT_ENABLE_DELETE", "false");
    const client = { get: vi.fn(), delete: vi.fn() } as unknown as FreeAgentApiClient;
    await expect(
      deleteBankTransaction(client, {
        bank_transaction_id: "555",
        confirm: true,
        reason: "duplicate from a statement upload",
        allow_imported: false,
        delete_explanations: false,
      })
    ).rejects.toThrow(/turned off on this machine.*Nothing was deleted/s);
    expect((client as unknown as { get: ReturnType<typeof vi.fn> }).get).not.toHaveBeenCalled();
  });
});
