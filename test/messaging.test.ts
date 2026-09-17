import { describe, expect, it } from "vitest";
import { campaignsCommand } from "../src/commands/campaigns.js";
import { emailCommand } from "../src/commands/email.js";
import { templatesCommand } from "../src/commands/templates.js";
import { smsCommand } from "../src/commands/sms.js";
import { contextFor } from "./helpers.js";

describe("campaigns", () => {
  it("lists with status filter and a zero state", async () => {
    const { ctx, calls } = contextFor([{ campaigns: [], count: 0 }]);
    const out = (await campaignsCommand(["list", "--status", "draft"], ctx)) as Record<string, unknown>;
    expect(calls[0]?.query?.["status"]).toBe("draft");
    expect(calls[0]?.query?.["excludeHtmlContent"]).toBe(true);
    expect(String(out["result"])).toContain("draft");
  });

  it("computes a stats summary string on get (principle 4)", async () => {
    const { ctx } = contextFor([
      {
        id: 17,
        name: "Launch",
        subject: "We ship",
        status: "sent",
        sender: { email: "p@x.com" },
        recipients: { listIds: [4] },
        statistics: {
          sent: 100,
          delivered: 95,
          uniqueOpens: 40,
          uniqueClicks: 10,
          hardBounces: 3,
          softBounces: 2,
        },
      },
    ]);
    const out = (await campaignsCommand(["get", "17"], ctx)) as Record<string, unknown>;
    const campaign = out["campaign"] as Record<string, unknown>;
    expect(String(campaign["stats"])).toContain("100 sent");
    expect(String(campaign["stats"])).toContain("95 delivered");
    expect(String(campaign["stats"])).toContain("40 opened");
    expect(String(campaign["stats"])).toContain("5 bounced");
  });

  it("create validates exactly one content source", async () => {
    const { ctx, calls } = contextFor();
    await expect(
      campaignsCommand(
        ["create", "--name", "N", "--subject", "S", "--sender-name", "P", "--sender-email", "p@x.com", "--lists", "4", "--confirm"],
        ctx,
      ),
    ).rejects.toMatchObject({ code: "VALIDATION_ERROR" });
    await expect(
      campaignsCommand(
        ["create", "--name", "N", "--subject", "S", "--sender-name", "P", "--sender-email", "p@x.com", "--html", "<p>", "--html-url", "https://x", "--lists", "4", "--confirm"],
        ctx,
      ),
    ).rejects.toMatchObject({ code: "VALIDATION_ERROR" });
    expect(calls).toHaveLength(0);
  });

  it("create posts a well-formed body with --confirm", async () => {
    const { ctx, calls } = contextFor([{ id: 21 }]);
    await campaignsCommand(
      [
        "create", "--name", "Launch", "--subject", "We ship",
        "--sender-name", "Product", "--sender-email", "p@x.com",
        "--template", "3", "--lists", "4,5", "--confirm",
      ],
      ctx,
    );
    expect(calls[0]?.method).toBe("POST");
    expect(calls[0]?.path).toBe("/emailCampaigns");
    expect(calls[0]?.body).toEqual({
      name: "Launch",
      subject: "We ship",
      sender: { name: "Product", email: "p@x.com" },
      recipients: { listIds: [4, 5] },
      templateId: 3,
    });
  });

  it("send is loudly gated behind --confirm", async () => {
    const { ctx, calls } = contextFor();
    const error = await campaignsCommand(["send", "17"], ctx).catch((e: unknown) => e);
    expect(error).toMatchObject({ code: "VALIDATION_ERROR" });
    expect(String((error as { suggestions?: string[] }).suggestions)).toContain("IMMEDIATELY");
    expect(calls).toHaveLength(0);
  });

  it("status validates the enum", async () => {
    const { ctx } = contextFor();
    await expect(
      campaignsCommand(["status", "17", "--status", "exploded", "--confirm"], ctx),
    ).rejects.toMatchObject({ code: "VALIDATION_ERROR" });
  });
});

describe("email send", () => {
  it("requires --confirm unless --sandbox", async () => {
    const { ctx, calls } = contextFor();
    await expect(
      emailCommand(["send", "--to", "a@b.com", "--subject", "Hi", "--text", "Hello"], ctx),
    ).rejects.toMatchObject({ code: "VALIDATION_ERROR" });
    expect(calls).toHaveLength(0);
  });

  it("sandbox mode sends without --confirm and sets the sandbox flag", async () => {
    const { ctx, calls } = contextFor([
      { senders: [{ id: 1, name: "Default", email: "p@x.com", active: true }] },
      { messageId: "<m@relay>" },
    ]);
    const out = (await emailCommand(
      ["send", "--to", "a@b.com", "--subject", "Hi", "--text", "Hello", "--sandbox"],
      ctx,
    )) as Record<string, unknown>;
    expect(calls[0]?.path).toBe("/senders");
    expect(calls[1]?.path).toBe("/smtp/email");
    expect(calls[1]?.sandbox).toBe(true);
    expect((calls[1]?.body as Record<string, unknown>)["sender"]).toEqual({
      name: "Default",
      email: "p@x.com",
    });
    expect(out["validated"]).toBeDefined();
    expect(out["sent"]).toBeUndefined();
  });

  it("real send posts a complete body and echoes the message id", async () => {
    const { ctx, calls } = contextFor([{ messageId: "<m@relay>" }]);
    const out = (await emailCommand(
      [
        "send", "--to", "a@b.com,c@b.com", "--subject", "Welcome",
        "--template", "3", "--param", '{"name":"Ada"}', "--tag", "onboarding",
        "--sender-name", "Product", "--sender-email", "p@x.com", "--confirm",
      ],
      ctx,
    )) as Record<string, unknown>;
    expect(calls[0]?.sandbox).toBe(false);
    expect(calls[0]?.body).toEqual({
      to: [{ email: "a@b.com" }, { email: "c@b.com" }],
      subject: "Welcome",
      templateId: 3,
      sender: { name: "Product", email: "p@x.com" },
      tags: ["onboarding"],
      params: { name: "Ada" },
    });
    const sent = out["sent"] as Record<string, unknown>;
    expect(sent["message_id"]).toBe("<m@relay>");
  });

  it("requires exactly one content source", async () => {
    const { ctx, calls } = contextFor();
    await expect(
      emailCommand(["send", "--to", "a@b.com", "--subject", "Hi", "--confirm"], ctx),
    ).rejects.toMatchObject({ code: "VALIDATION_ERROR" });
    expect(calls).toHaveLength(0);
  });
});

describe("email audit", () => {
  it("list requires at least one filter", async () => {
    const { ctx, calls } = contextFor();
    await expect(emailCommand(["list"], ctx)).rejects.toMatchObject({ code: "VALIDATION_ERROR" });
    expect(calls).toHaveLength(0);
  });

  it("events pre-compute a breakdown of event counts", async () => {
    const { ctx } = contextFor([
      {
        events: [
          { event: "delivered", email: "a@b.com", date: "2026-01-01" },
          { event: "delivered", email: "c@b.com", date: "2026-01-01" },
          { event: "hard_bounce", email: "d@b.com", date: "2026-01-01" },
        ],
      },
    ]);
    const out = (await emailCommand(["events", "--event", "delivered"], ctx)) as Record<string, unknown>;
    expect(out["breakdown"]).toContain("2 delivered");
  });

  it("stats aggregates the Brevo payload", async () => {
    const { ctx, calls } = contextFor([
      {
        range: "2026-01-01|2026-01-07",
        requests: 100,
        delivered: 98,
        hardBounces: 1,
        opens: 40,
        uniqueOpens: 30,
        clicks: 12,
        uniqueClicks: 8,
      },
    ]);
    const out = (await emailCommand(["stats", "--days", "7"], ctx)) as Record<string, unknown>;
    expect(calls[0]?.path).toBe("/smtp/statistics/aggregatedReport");
    expect(out["summary"]).toContain("100 requests");
    expect(out["summary"]).toContain("98 delivered");
  });

  it("stats --daily totals per-day rows", async () => {
    const { ctx, calls } = contextFor([
      {
        reports: [
          { date: "2026-01-01", requests: 10, delivered: 9, opens: 3, clicks: 1 },
          { date: "2026-01-02", requests: 5, delivered: 5, opens: 2, clicks: 0 },
        ],
      },
    ]);
    const out = (await emailCommand(["stats", "--daily"], ctx)) as Record<string, unknown>;
    expect(calls[0]?.path).toBe("/smtp/statistics/reports");
    expect(String(out["totals"])).toContain("15 requests");
  });

  it("cancel is gated", async () => {
    const { ctx, calls } = contextFor();
    await expect(emailCommand(["cancel", "abc"], ctx)).rejects.toMatchObject({ code: "VALIDATION_ERROR" });
    expect(calls).toHaveLength(0);
  });
});

describe("templates", () => {
  it("lists templates without dumping html", async () => {
    const { ctx } = contextFor([
      {
        templates: [{ id: 3, name: "Welcome", subject: "Hi", sender: { email: "p@x.com" }, isActive: true, htmlContent: "<p>".repeat(200) }],
        count: 1,
      },
    ]);
    const out = (await templatesCommand(["list"], ctx)) as Record<string, unknown>;
    const rows = out["templates"] as Array<Record<string, unknown>>;
    expect(JSON.stringify(rows)).not.toContain("<p><p>");
  });

  it("get truncates html with a hint", async () => {
    const { ctx } = contextFor([
      { id: 3, name: "Welcome", htmlContent: "x".repeat(2000), isActive: true },
    ]);
    const out = (await templatesCommand(["get", "3"], ctx)) as Record<string, unknown>;
    const template = out["template"] as Record<string, unknown>;
    expect(String(template["html"])).toContain("truncated, 2000 chars total");
    expect((out["help"] as string[]).join(" ")).toContain("--full");
  });

  it("send-test is gated and validates recipients", async () => {
    const { ctx, calls } = contextFor();
    await expect(templatesCommand(["send-test", "3"], ctx)).rejects.toMatchObject({ code: "VALIDATION_ERROR" });
    await expect(
      templatesCommand(["send-test", "3", "--to", "a@b.com"], ctx),
    ).rejects.toMatchObject({ code: "VALIDATION_ERROR" });
    expect(calls).toHaveLength(0);
  });
});

describe("sms", () => {
  it("validates phone numbers before any call", async () => {
    const { ctx, calls } = contextFor();
    await expect(
      smsCommand(["send", "--to", "123", "--text", "Hi", "--confirm"], ctx),
    ).rejects.toMatchObject({ code: "VALIDATION_ERROR" });
    expect(calls).toHaveLength(0);
  });

  it("sends with --confirm and estimates segments", async () => {
    const { ctx, calls } = contextFor([{ messageId: "m1" }]);
    const out = (await smsCommand(
      ["send", "--to", "+33612345678", "--text", "Your code is 1234", "--sender", "ACME", "--confirm"],
      ctx,
    )) as Record<string, unknown>;
    expect(calls[0]?.path).toBe("/transactionalSMS/send");
    expect(calls[0]?.body).toMatchObject({
      recipient: "+33612345678",
      content: "Your code is 1234",
      sender: "ACME",
      type: "transactional",
    });
    const sent = out["sent"] as Record<string, unknown>;
    expect(sent["segments"]).toBe(1);
  });

  it("stats events filter validates the enum", async () => {
    const { ctx } = contextFor([{ events: [] }]);
    await expect(smsCommand(["events", "--event", "nonsense"], ctx)).rejects.toMatchObject({
      code: "VALIDATION_ERROR",
    });
  });
});
