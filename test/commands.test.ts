import { describe, expect, it } from "vitest";
import { dealsCommand } from "../src/commands/deals.js";
import { companiesCommand } from "../src/commands/companies.js";
import { tasksCommand } from "../src/commands/tasks.js";
import { notesCommand } from "../src/commands/notes.js";
import { pipelinesCommand } from "../src/commands/pipelines.js";
import { sendersCommand } from "../src/commands/senders.js";
import { domainsCommand } from "../src/commands/domains.js";
import { webhooksCommand } from "../src/commands/webhooks.js";
import { eventsCommand } from "../src/commands/events.js";
import { processesCommand } from "../src/commands/processes.js";
import { apiCommand } from "../src/commands/api.js";
import { contextFor } from "./helpers.js";

describe("deals", () => {
  it("passes name/stage filters as Brevo filter query params", async () => {
    const { ctx, calls } = contextFor([{ items: [], pager: { total: 0 } }]);
    await dealsCommand(["list", "--stage", "New"], ctx);
    expect(calls[0]?.query?.["filters[attributes.deal_stage]"]).toBe("New");
  });

  it("reports pager totals and paging hints", async () => {
    const { ctx } = contextFor([
      {
        items: [{ id: "9", attributes: { deal_name: "Pilot", deal_stage: "New" } }],
        pager: { total: 30, limit: 1 },
      },
    ]);
    const out = (await dealsCommand(["list", "--limit", "1"], ctx)) as Record<string, unknown>;
    expect(out["total"]).toBe(30);
    expect((out["help"] as string[]).join(" ")).toContain("--offset 1 (of 30 total)");
  });

  it("create posts attributes with the stage", async () => {
    const { ctx, calls } = contextFor([{ id: "11" }]);
    await dealsCommand(
      ["create", "--name", "Pilot", "--stage", "New", "--company", "c1", "--contacts", "24", "--confirm"],
      ctx,
    );
    expect(calls[0]?.body).toEqual({
      name: "Pilot",
      attributes: { deal_name: "Pilot", deal_stage: "New" },
      linkedCompaniesIds: ["c1"],
      linkedContactsIds: [24],
    });
  });

  it("update requires at least one change", async () => {
    const { ctx, calls } = contextFor();
    await expect(dealsCommand(["update", "9", "--confirm"], ctx)).rejects.toMatchObject({
      code: "VALIDATION_ERROR",
    });
    expect(calls).toHaveLength(0);
  });
});

describe("companies", () => {
  it("pages with --page, not --offset", async () => {
    const { ctx, calls } = contextFor([{ items: [], pager: {} }]);
    await companiesCommand(["list", "--page", "2"], ctx);
    expect(calls[0]?.query?.["page"]).toBe(2);
    expect(calls[0]?.query?.["offset"]).toBeUndefined();
  });

  it("create is gated and posts name attributes", async () => {
    const { ctx, calls } = contextFor();
    await expect(companiesCommand(["create", "--name", "Acme"], ctx)).rejects.toMatchObject({
      code: "VALIDATION_ERROR",
    });
    expect(calls).toHaveLength(0);
    const { ctx: ok, calls: done } = contextFor([{ id: "c1" }]);
    await companiesCommand(["create", "--name", "Acme", "--confirm"], ok);
    expect(done[0]?.body).toEqual({ name: "Acme", attributes: { name: "Acme" } });
  });
});

describe("tasks", () => {
  it("types lists ids and titles", async () => {
    const { ctx } = contextFor([{ items: [{ id: "4", title: "Call" }] }]);
    const out = (await tasksCommand(["types"], ctx)) as Record<string, unknown>;
    expect(out["count"]).toBe(1);
  });

  it("create validates name/type/date triple", async () => {
    const { ctx, calls } = contextFor();
    await expect(tasksCommand(["create", "--name", "X", "--confirm"], ctx)).rejects.toMatchObject({
      code: "VALIDATION_ERROR",
    });
    await expect(
      tasksCommand(["create", "--name", "X", "--type", "4", "--date", "tomorrow", "--confirm"], ctx),
    ).rejects.toMatchObject({ code: "VALIDATION_ERROR" });
    expect(calls).toHaveLength(0);
  });

  it("update --done marks completion", async () => {
    const { ctx, calls } = contextFor([null]);
    await tasksCommand(["update", "5", "--done", "--confirm"], ctx);
    expect(calls[0]?.method).toBe("PATCH");
    expect(calls[0]?.body).toEqual({ done: true });
  });
});

describe("notes", () => {
  it("list renders the array response", async () => {
    const { ctx } = contextFor([{ items: [{ id: "n1", text: "Called them", contactId: 24, date: "2026-01-01" }] }]);
    const out = (await notesCommand(["list"], ctx)) as Record<string, unknown>;
    expect(out["count"]).toBe(1);
  });

  it("create requires a link target", async () => {
    const { ctx, calls } = contextFor();
    await expect(notesCommand(["create", "--body", "Hi", "--confirm"], ctx)).rejects.toMatchObject({
      code: "VALIDATION_ERROR",
    });
    expect(calls).toHaveLength(0);
    const { ctx: ok, calls: done } = contextFor([{ id: "n2" }]);
    await notesCommand(["create", "--body", "Hi", "--contact", "24", "--confirm"], ok);
    expect(done[0]?.body).toEqual({ text: "Hi", contactId: 24 });
  });
});

describe("pipelines", () => {
  it("lists pipelines with stage counts", async () => {
    const { ctx } = contextFor([
      { items: [{ pipeline: "p1", pipeline_name: "Sales", stages: [{ stage: "s1", stage_name: "New" }] }] },
    ]);
    const out = (await pipelinesCommand(["list"], ctx)) as Record<string, unknown>;
    expect(out["count"]).toBe(1);
    const pipelines = out["pipelines"] as Array<Record<string, unknown>>;
    expect(pipelines[0]?.["stages"]).toBe(1);
  });

  it("get by name resolves stages and 404s on a bad name", async () => {
    const { ctx } = contextFor([
      { items: [{ pipeline: "p1", pipeline_name: "Sales", stages: [{ id: "s1", name: "New", winProbability: 100 }] }] },
    ]);
    const out = (await pipelinesCommand(["get", "Sales"], ctx)) as Record<string, unknown>;
    const stages = out["stages"] as Array<Record<string, unknown>>;
    expect(stages[0]?.["name"]).toBe("New");
    expect(stages[0]?.["win_probability"]).toBe(100);
    await expect(pipelinesCommand(["get", "Nope"], ctx)).rejects.toMatchObject({ code: "NOT_FOUND" });
  });
});

describe("senders + domains", () => {
  it("senders list counts active senders", async () => {
    const { ctx } = contextFor([
      { senders: [{ id: 1, name: "A", email: "a@x.com", active: true }, { id: 2, name: "B", email: "b@x.com", active: false }] },
    ]);
    const out = (await sendersCommand(["list"], ctx)) as Record<string, unknown>;
    expect(out["breakdown"]).toBe("1 active, 1 inactive");
  });

  it("senders create validates email and gates", async () => {
    const { ctx, calls } = contextFor();
    await expect(
      sendersCommand(["create", "--name", "P", "--email", "nope", "--confirm"], ctx),
    ).rejects.toMatchObject({ code: "VALIDATION_ERROR" });
    await expect(sendersCommand(["create", "--name", "P", "--email", "p@x.com"], ctx)).rejects.toMatchObject({
      code: "VALIDATION_ERROR",
    });
    expect(calls).toHaveLength(0);
  });

  it("domains create validates the domain shape", async () => {
    const { ctx, calls } = contextFor();
    await expect(
      domainsCommand(["create", "--name", "not a domain", "--confirm"], ctx),
    ).rejects.toMatchObject({ code: "VALIDATION_ERROR" });
    expect(calls).toHaveLength(0);
  });
});

describe("webhooks", () => {
  it("create validates event names against the documented enum", async () => {
    const { ctx, calls } = contextFor();
    await expect(
      webhooksCommand(["create", "--url", "https://x.com/h", "--events", "delivered,madeUp", "--confirm"], ctx),
    ).rejects.toMatchObject({ code: "VALIDATION_ERROR" });
    expect(calls).toHaveLength(0);
  });

  it("create requires an https url and --confirm", async () => {
    const { ctx, calls } = contextFor();
    await expect(
      webhooksCommand(["create", "--url", "http://x.com/h", "--events", "delivered", "--confirm"], ctx),
    ).rejects.toMatchObject({ code: "VALIDATION_ERROR" });
    await expect(
      webhooksCommand(["create", "--url", "https://x.com/h", "--events", "delivered"], ctx),
    ).rejects.toMatchObject({ code: "VALIDATION_ERROR" });
    expect(calls).toHaveLength(0);
    const { ctx: ok, calls: done } = contextFor([{ id: 5 }]);
    await webhooksCommand(
      ["create", "--url", "https://x.com/h", "--events", "delivered,hardBounce", "--confirm"],
      ok,
    );
    expect(done[0]?.body).toEqual({
      url: "https://x.com/h",
      events: ["delivered", "hardBounce"],
      type: "transactional",
    });
  });
});

describe("events + processes", () => {
  it("track requires email or contact and a name", async () => {
    const { ctx, calls } = contextFor();
    await expect(eventsCommand(["track", "--confirm"], ctx)).rejects.toMatchObject({ code: "VALIDATION_ERROR" });
    await expect(
      eventsCommand(["track", "--email", "a@b.com", "--confirm"], ctx),
    ).rejects.toMatchObject({ code: "VALIDATION_ERROR" });
    expect(calls).toHaveLength(0);
  });

  it("track posts identifiers keyed by type", async () => {
    const { ctx, calls } = contextFor([null]);
    await eventsCommand(
      ["track", "--email", "a@b.com", "--name", "cart_abandoned", "--props", '{"total":90}', "--confirm"],
      ctx,
    );
    expect(calls[0]?.body).toEqual({
      event_name: "cart_abandoned",
      identifiers: { email_id: "a@b.com" },
      event_properties: { total: 90 },
    });
  });

  it("processes get surfaces status advice", async () => {
    const { ctx } = contextFor([{ id: 12, status: "done", name: "import" }]);
    const out = (await processesCommand(["get", "12"], ctx)) as Record<string, unknown>;
    expect((out["help"] as string[]).join(" ")).toContain("finished");
  });
});

describe("api escape hatch", () => {
  it("get passes the path and query through", async () => {
    const { ctx, calls } = contextFor([{ ok: true }]);
    const out = (await apiCommand(["get", "contacts/lists/4", "--query", "limit=5"], ctx)) as Record<string, unknown>;
    expect(calls[0]?.method).toBe("GET");
    expect(calls[0]?.path).toBe("/contacts/lists/4");
    expect(calls[0]?.query?.["limit"]).toBe("5");
    expect(out["request"]).toBe("GET /contacts/lists/4");
  });

  it("rejects path traversal", async () => {
    const { ctx, calls } = contextFor();
    await expect(apiCommand(["get", "../../etc/passwd"], ctx)).rejects.toMatchObject({
      code: "VALIDATION_ERROR",
    });
    expect(calls).toHaveLength(0);
  });

  it("writes require a body and --confirm", async () => {
    const { ctx, calls } = contextFor();
    await expect(apiCommand(["post", "smtp/email"], ctx)).rejects.toMatchObject({ code: "VALIDATION_ERROR" });
    await expect(
      apiCommand(["post", "smtp/email", "--body", '{"a":1}'], ctx),
    ).rejects.toMatchObject({ code: "VALIDATION_ERROR" });
    expect(calls).toHaveLength(0);
    const { ctx: ok, calls: done } = contextFor([{}]);
    await apiCommand(["post", "smtp/email", "--body", '{"a":1}', "--confirm"], ok);
    expect(done[0]?.method).toBe("POST");
    expect(done[0]?.body).toEqual({ a: 1 });
  });

  it("rejects unknown methods with a loud validation error", async () => {
    const { ctx } = contextFor();
    await expect(apiCommand(["frobnicate", "x"], ctx)).rejects.toMatchObject({
      code: "VALIDATION_ERROR",
    });
  });
});
