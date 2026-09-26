import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import {
  PaginationSchema,
  ListContactsInputSchema,
  GetContactInputSchema,
  CreateContactInputSchema,
  CreateInvoiceInputSchema,
  UpdateInvoiceInputSchema,
  ListExpensesInputSchema,
  SalesTaxRateSchema,
  CreateExpenseInputSchema,
  UpdateExpenseInputSchema,
  CreateBankTransactionExplanationInputSchema,
  UpdateBankTransactionExplanationInputSchema,
  CreateBillInputSchema,
  CreateEstimateInputSchema,
  CreatePriceListItemInputSchema,
  LogExpenseInputSchema,
} from "./index.js";
import { SERVER_VERSION } from "../constants.js";

describe("PaginationSchema", () => {
  it("accepts valid pagination params", () => {
    const result = PaginationSchema.parse({ page: 1, per_page: 25 });
    expect(result.page).toBe(1);
    expect(result.per_page).toBe(25);
  });

  it("provides defaults when omitted", () => {
    const result = PaginationSchema.parse({});
    expect(result.page).toBe(1);
    expect(result.per_page).toBe(25);
  });

  it("rejects page < 1", () => {
    expect(() => PaginationSchema.parse({ page: 0 })).toThrow();
  });

  it("rejects per_page > 100", () => {
    expect(() => PaginationSchema.parse({ per_page: 101 })).toThrow();
  });

  it("rejects non-integer page", () => {
    expect(() => PaginationSchema.parse({ page: 1.5 })).toThrow();
  });
});

describe("ListContactsInputSchema", () => {
  it("accepts minimal input with defaults", () => {
    const result = ListContactsInputSchema.parse({});
    expect(result.page).toBe(1);
    expect(result.per_page).toBe(25);
    expect(result.response_format).toBe("markdown");
  });

  it("accepts valid sort field", () => {
    const result = ListContactsInputSchema.parse({ sort: "first_name" });
    expect(result.sort).toBe("first_name");
  });

  it("rejects invalid sort field", () => {
    expect(() => ListContactsInputSchema.parse({ sort: "invalid" })).toThrow();
  });

  it("rejects extra fields (strict mode)", () => {
    expect(() =>
      ListContactsInputSchema.parse({ unknown_field: "value" })
    ).toThrow();
  });
});

describe("GetContactInputSchema", () => {
  it("accepts numeric ID string", () => {
    const result = GetContactInputSchema.parse({ contact_id: "12345" });
    expect(result.contact_id).toBe("12345");
  });

  it("accepts full URL as ID", () => {
    const result = GetContactInputSchema.parse({
      contact_id: "https://api.freeagent.com/v2/contacts/12345",
    });
    expect(result.contact_id).toContain("12345");
  });

  it("rejects empty ID", () => {
    expect(() => GetContactInputSchema.parse({ contact_id: "" })).toThrow();
  });
});

describe("CreateContactInputSchema", () => {
  it("accepts contact with organisation name", () => {
    const result = CreateContactInputSchema.parse({
      organisation_name: "Acme Ltd",
    });
    expect(result.organisation_name).toBe("Acme Ltd");
  });

  it("accepts contact with name fields", () => {
    const result = CreateContactInputSchema.parse({
      first_name: "John",
      last_name: "Doe",
      email: "john@example.com",
    });
    expect(result.first_name).toBe("John");
    expect(result.email).toBe("john@example.com");
  });

  it("rejects invalid email", () => {
    expect(() =>
      CreateContactInputSchema.parse({ email: "not-an-email" })
    ).toThrow();
  });
});

describe("CreateInvoiceInputSchema", () => {
  it("accepts valid invoice with line items", () => {
    const result = CreateInvoiceInputSchema.parse({
      contact: "12345",
      dated_on: "2024-01-15",
      invoice_items: [
        {
          item_type: "Hours",
          description: "Consulting",
          price: "100.00",
          quantity: "8",
        },
      ],
    });
    expect(result.contact).toBe("12345");
    expect(result.currency).toBe("GBP"); // default
    expect(result.invoice_items).toHaveLength(1);
  });

  it("rejects invalid date format", () => {
    expect(() =>
      CreateInvoiceInputSchema.parse({
        contact: "12345",
        dated_on: "15/01/2024",
        invoice_items: [
          { item_type: "Hours", description: "x", price: "1", quantity: "1" },
        ],
      })
    ).toThrow();
  });

  it("rejects empty invoice items", () => {
    expect(() =>
      CreateInvoiceInputSchema.parse({
        contact: "12345",
        dated_on: "2024-01-15",
        invoice_items: [],
      })
    ).toThrow();
  });
});

describe("ListExpensesInputSchema", () => {
  it("validates date filters format", () => {
    const result = ListExpensesInputSchema.parse({
      from_date: "2024-01-01",
      to_date: "2024-01-31",
    });
    expect(result.from_date).toBe("2024-01-01");
    expect(result.to_date).toBe("2024-01-31");
  });

  it("rejects invalid date format", () => {
    expect(() =>
      ListExpensesInputSchema.parse({ from_date: "01-01-2024" })
    ).toThrow();
  });
});

describe("UpdateInvoiceInputSchema", () => {
  it("accepts send_reminder_emails as an optional boolean", () => {
    const result = UpdateInvoiceInputSchema.parse({
      invoice_id: "1",
      send_reminder_emails: false,
    });
    expect(result.send_reminder_emails).toBe(false);
  });
});

describe("version identity", () => {
  it("SERVER_VERSION matches package.json at 1.2.3", () => {
    const pkg = JSON.parse(readFileSync(new URL("../../package.json", import.meta.url), "utf8")) as {
      version: string;
    };
    expect(SERVER_VERSION).toBe(pkg.version);
    expect(SERVER_VERSION).toBe("1.2.3");
  });
});

describe("SalesTaxRateSchema (percentage, not decimal fraction)", () => {
  it.each(["20.0", "20", "5.0", "5", "0", "0.0", "17.5", "100"])("accepts %s", (v) => {
    expect(SalesTaxRateSchema.safeParse(v).success).toBe(true);
  });

  it.each(["0.20", "0.2", "0.05", "0.5", "0.999"])("rejects decimal fraction %s", (v) => {
    const r = SalesTaxRateSchema.safeParse(v);
    expect(r.success).toBe(false);
    expect(JSON.stringify(r.error?.issues)).toContain("percentage");
  });

  it.each(["abc", "-20", "20%", "", "120", "1e1"])("rejects malformed or out-of-range %s", (v) => {
    expect(SalesTaxRateSchema.safeParse(v).success).toBe(false);
  });

  it("describes the percentage format for tool callers", () => {
    expect(SalesTaxRateSchema.description).toContain("'20.0' for 20%");
  });
});

describe("tool schemas route sales_tax_rate through the percentage validator", () => {
  // Tools are registered via `.shape`, so the field-level schema is what validates input.
  const shapes = {
    CreateExpenseInputSchema: CreateExpenseInputSchema.shape.sales_tax_rate,
    UpdateExpenseInputSchema: UpdateExpenseInputSchema.shape.sales_tax_rate,
    CreateBankTransactionExplanationInputSchema: CreateBankTransactionExplanationInputSchema.shape.sales_tax_rate,
    UpdateBankTransactionExplanationInputSchema: UpdateBankTransactionExplanationInputSchema.shape.sales_tax_rate,
    CreatePriceListItemInputSchema: CreatePriceListItemInputSchema.shape.sales_tax_rate,
    LogExpenseInputSchema: LogExpenseInputSchema.shape.sales_tax_rate,
    CreateBillLineItem: CreateBillInputSchema.shape.bill_items.element.shape.sales_tax_rate,
    CreateEstimateLineItem: CreateEstimateInputSchema.shape.estimate_items.element.shape.sales_tax_rate,
  };

  for (const [name, field] of Object.entries(shapes)) {
    it(`${name}: accepts '20.0', allows omission, rejects '0.20'`, () => {
      expect(field.safeParse("20.0").success).toBe(true);
      expect(field.safeParse(undefined).success).toBe(true);
      expect(field.safeParse("0.20").success).toBe(false);
    });
  }
});
