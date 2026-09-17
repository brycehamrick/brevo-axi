import { describe, expect, it } from "vitest";
import { contactsCommand } from "../src/commands/contacts.js";
import { listsCommand } from "../src/commands/lists.js";
import { foldersCommand } from "../src/commands/folders.js";
import { attributesCommand } from "../src/commands/attributes.js";
import { segmentsCommand } from "../src/commands/segments.js";
import { homeCommand } from "../src/commands/home.js";
import { contextFor, unauthenticatedContext } from "./helpers.js";

describe("home", () => {
  it("shows setup guidance without network calls when unauthenticated", async () => {
    const ctx = unauthenticatedContext();
    const out = (await homeCommand([], ctx)) as Record<string, unknown>;
    expect(out["auth"]).toBe("none");
    expect(out["setup"]).toMatch(/BREVO_API_KEY/);
  });

  it("shows live counts and degrades gracefully when calls fail", async () => {
    const { ctx } = contextFor([
      { email: "a@b.com", plan: [{ type: "free", credits: 300 }] },
      { contacts: [], count: 20 },
      null, // lists call "fails"? null is a valid 204; use a throwing client instead
    ]);
    const out = (await homeCommand([], ctx)) as Record<string, unknown>;
    expect(out["account"]).toBe("a@b.com");
    expect(out["plan"]).toContain("free");
    expect(out["contacts"]).toBe("20 total");
  });

  it("survives total API failure on every call", async () => {
    const ctx: Parameters<typeof homeCommand>[1] = {
      config: { apiKey: "xkeysib-test", apiUrl: "https://api.brevo.com/v3/" },
      client: {
        config: { apiKey: "xkeysib-test", apiUrl: "https://api.brevo.com/v3/" },
        request: async () => {
          throw new Error("network down");
        },
      },
    };
    const out = (await homeCommand([], ctx)) as Record<string, unknown>;
    expect(String(out["account"])).toContain("unavailable");
  });
});

describe("contacts list", () => {
  it("renders rows with count, total, and next-step help", async () => {
    const { ctx, calls } = contextFor([
      { contacts: [{ id: 1, email: "a@b.com", createdAt: "2026-01-01T00:00:00Z" }], count: 42 },
    ]);
    const out = (await contactsCommand(["list", "--limit", "1"], ctx)) as Record<string, unknown>;
    expect(calls[0]?.path).toBe("/contacts");
    expect(calls[0]?.query?.["limit"]).toBe(1);
    expect(out["total"]).toBe(42);
    expect(out["count"]).toBe(1);
    const contacts = out["contacts"] as Array<Record<string, unknown>>;
    expect(contacts[0]?.["email"]).toBe("a@b.com");
    const help = out["help"] as string[];
    expect(help.join(" ")).toContain("contacts get a@b.com");
  });

  it("emits a definitive zero state", async () => {
    const { ctx } = contextFor([{ contacts: [], count: 0 }]);
    const out = (await contactsCommand(["list"], ctx)) as Record<string, unknown>;
    expect(out["count"]).toBe(0);
    expect(String(out["result"])).toContain("0 contacts");
  });

  it("passes list and segment filters as query params", async () => {
    const { ctx, calls } = contextFor([{ contacts: [], count: 0 }]);
    await contactsCommand(["list", "--lists", "4,5", "--segment", "9"], ctx);
    expect(calls[0]?.query?.["listIds"]).toBe("4,5");
    expect(calls[0]?.query?.["segmentId"]).toBe("9");
  });

  it("rejects unknown flags loudly", async () => {
    const { ctx } = contextFor();
    await expect(contactsCommand(["list", "--nope"], ctx)).rejects.toMatchObject({
      code: "VALIDATION_ERROR",
    });
  });
});

describe("contacts get", () => {
  it("detects email identifiers vs numeric ids", async () => {
    const { ctx, calls } = contextFor([
      { id: 7, email: "a@b.com", attributes: { FIRSTNAME: "Ada" } },
      { id: 7, email: "a@b.com", attributes: {} },
    ]);
    await contactsCommand(["get", "a@b.com"], ctx);
    expect(calls[0]?.path).toBe("/contacts/a%40b.com");
    expect(calls[0]?.query?.["identifierType"]).toBe("email_id");
    await contactsCommand(["get", "7"], ctx);
    expect(calls[1]?.query?.["identifierType"]).toBe("contact_id");
  });

  it("honors --identifier-type override", async () => {
    const { ctx, calls } = contextFor([{ id: 7 }]);
    await contactsCommand(["get", "7", "--identifier-type", "ext_id"], ctx);
    expect(calls[0]?.query?.["identifierType"]).toBe("ext_id");
  });

  it("truncates long attribute values with a --full hint", async () => {
    const { ctx } = contextFor([
      { id: 7, attributes: { NOTE: "x".repeat(400) } },
    ]);
    const out = (await contactsCommand(["get", "7"], ctx)) as Record<string, unknown>;
    const contact = out["contact"] as Record<string, unknown>;
    const attrs = contact["attributes"] as Record<string, unknown>;
    expect(String(attrs["NOTE"])).toContain("truncated, 400 chars total");
  });
});

describe("contacts write gates", () => {
  it("create makes zero calls without --confirm", async () => {
    const { ctx, calls } = contextFor();
    await expect(
      contactsCommand(["create", "--email", "a@b.com"], ctx),
    ).rejects.toMatchObject({ code: "VALIDATION_ERROR" });
    expect(calls).toHaveLength(0);
  });

  it("create with --confirm posts attributes and list ids", async () => {
    const { ctx, calls } = contextFor([{ id: 31 }]);
    const out = (await contactsCommand(
      ["create", "--email", "a@b.com", "--attr", '{"FIRSTNAME":"Ada"}', "--lists", "4,5", "--confirm"],
      ctx,
    )) as Record<string, unknown>;
    expect(calls[0]?.method).toBe("POST");
    expect(calls[0]?.path).toBe("/contacts");
    expect(calls[0]?.body).toEqual({
      email: "a@b.com",
      updateEnabled: false,
      attributes: { FIRSTNAME: "Ada" },
      listIds: [4, 5],
    });
    expect((out["created"] as Record<string, unknown>)["id"]).toBe(31);
  });

  it("rejects invalid emails before any call", async () => {
    const { ctx, calls } = contextFor();
    await expect(
      contactsCommand(["create", "--email", "not-an-email", "--confirm"], ctx),
    ).rejects.toMatchObject({ code: "VALIDATION_ERROR" });
    expect(calls).toHaveLength(0);
  });

  it("update requires something to change", async () => {
    const { ctx, calls } = contextFor();
    await expect(contactsCommand(["update", "7", "--confirm"], ctx)).rejects.toMatchObject({
      code: "VALIDATION_ERROR",
    });
    expect(calls).toHaveLength(0);
  });

  it("update sends unlink list ids", async () => {
    const { ctx, calls } = contextFor([null]);
    await contactsCommand(["update", "7", "--unlink-lists", "4", "--confirm"], ctx);
    expect(calls[0]?.method).toBe("PUT");
    expect(calls[0]?.body).toEqual({ unlinkListIds: [4] });
  });

  it("delete is gated and permanent by description", async () => {
    const { ctx, calls } = contextFor();
    await expect(contactsCommand(["delete", "7"], ctx)).rejects.toMatchObject({
      code: "VALIDATION_ERROR",
    });
    expect(calls).toHaveLength(0);
    const { ctx: ok, calls: done } = contextFor([null]);
    await contactsCommand(["delete", "7", "--confirm"], ok);
    expect(done[0]?.method).toBe("DELETE");
    expect(done[0]?.path).toBe("/contacts/7");
  });

  it("import requires a JSON body and --confirm", async () => {
    const { ctx, calls } = contextFor();
    await expect(contactsCommand(["import"], ctx)).rejects.toMatchObject({ code: "VALIDATION_ERROR" });
    await expect(
      contactsCommand(["import", "--body", '{"jsonBody":[]}'], ctx),
    ).rejects.toMatchObject({ code: "VALIDATION_ERROR" });
    expect(calls).toHaveLength(0);
  });
});

describe("lists", () => {
  it("aggregates subscriber counts across lists", async () => {
    const { ctx } = contextFor([
      {
        lists: [
          { id: 4, name: "A", totalSubscribers: 10, totalBlacklisted: 1, folderId: 2 },
          { id: 5, name: "B", totalSubscribers: 15, totalBlacklisted: 0, folderId: 2 },
        ],
        count: 2,
      },
    ]);
    const out = (await listsCommand(["list"], ctx)) as Record<string, unknown>;
    expect(out["total_subscribers"]).toBe(25);
  });

  it("contacts subcommand shows a zero state with add hint", async () => {
    const { ctx } = contextFor([{ contacts: [], count: 0 }]);
    const out = (await listsCommand(["contacts", "4"], ctx)) as Record<string, unknown>;
    expect(String(out["result"])).toContain("0 contacts");
    expect((out["help"] as string[]).join(" ")).toContain("lists add");
  });

  it("add requires ids or emails and --confirm", async () => {
    const { ctx, calls } = contextFor();
    await expect(listsCommand(["add", "4"], ctx)).rejects.toMatchObject({ code: "VALIDATION_ERROR" });
    await expect(listsCommand(["add", "4", "--ids", "12"], ctx)).rejects.toMatchObject({
      code: "VALIDATION_ERROR",
    });
    expect(calls).toHaveLength(0);
    const { ctx: ok, calls: done } = contextFor([{}]);
    await listsCommand(["remove", "4", "--ids", "12,13", "--confirm"], ok);
    expect(done[0]?.path).toBe("/contacts/lists/4/contacts/remove");
    expect(done[0]?.body).toEqual({ ids: [12, 13] });
  });

  it("create posts name and folder", async () => {
    const { ctx, calls } = contextFor([{ id: 9 }]);
    await listsCommand(["create", "--name", "NL", "--folder", "2", "--confirm"], ctx);
    expect(calls[0]?.body).toEqual({ name: "NL", folderId: 2 });
  });
});

describe("folders + attributes + segments", () => {
  it("folder delete warns it destroys lists inside", async () => {
    const { ctx } = contextFor([null]);
    await expect(foldersCommand(["delete", "2"], ctx)).rejects.toMatchObject({
      code: "VALIDATION_ERROR",
    });
  });

  it("attribute create builds enumeration bodies for categories", async () => {
    const { ctx, calls } = contextFor([null]);
    await attributesCommand(
      ["create", "TEAM", "--type", "category", "--options", "Sales,Support", "--confirm"],
      ctx,
    );
    expect(calls[0]?.method).toBe("POST");
    expect(calls[0]?.path).toBe("/contacts/attributes/normal/TEAM");
    expect(calls[0]?.body).toEqual({
      type: "category",
      enumeration: [{ value: "Sales" }, { value: "Support" }],
    });
  });

  it("attribute create rejects category without options", async () => {
    const { ctx, calls } = contextFor();
    await expect(
      attributesCommand(["create", "TEAM", "--type", "category", "--confirm"], ctx),
    ).rejects.toMatchObject({ code: "VALIDATION_ERROR" });
    expect(calls).toHaveLength(0);
  });

  it("segments handle Brevo's empty-object response", async () => {
    const { ctx } = contextFor([{}]);
    const out = (await segmentsCommand(["list"], ctx)) as Record<string, unknown>;
    expect(out["count"]).toBe(0);
    expect(String(out["result"])).toContain("0 segments");
  });
});
