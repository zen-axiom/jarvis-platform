import { afterEach, describe, expect, it, vi } from "vitest";
import schema from "../../../shared/events.schema.json";
import { HUD_STATES, type HudEvent, initialModel, reduce } from "../hud/hudState";
import { CAPTION_PLACEHOLDER, containsArabicScript, validateCaption } from "../lib/captionGuard";
import {
  type ApprovalAnswer,
  Cancelled,
  FROZEN,
  LiveRunner,
  type Runner,
  type ScenarioName,
  matchScenario,
  runScenario,
} from "./mockStream";

type Def = {
  required: string[];
  properties: Record<string, { const?: string; enum?: unknown[]; type?: string }>;
};
const defs = Object.values(schema.$defs) as Def[];

function conforms(e: HudEvent): void {
  const def = defs.find((d) => d.properties.type.const === e.type);
  expect(def, `unknown event type ${e.type}`).toBeDefined();
  const d = def as Def;
  const keys = Object.keys(e);
  for (const k of d.required) expect(keys).toContain(k);
  for (const k of keys) {
    expect(d.properties, `unexpected key ${k} in ${e.type}`).toHaveProperty(k);
    const spec = d.properties[k];
    const v = (e as unknown as Record<string, unknown>)[k];
    if (spec.enum) expect(spec.enum).toContain(v);
    if (spec.type === "string") expect(typeof v).toBe("string");
    if (spec.type === "number") expect(typeof v).toBe("number");
    if (spec.type === "object") expect(typeof v).toBe("object");
  }
}

class FakeRunner implements Runner {
  events: HudEvent[] = [];
  approvals = 0;
  sleeps = 0;
  constructor(
    private readonly answers: ApprovalAnswer[] = [],
    private readonly cancelAtSleep: number | null = null,
  ) {}
  emit(e: HudEvent) {
    this.events.push(e);
  }
  async sleep() {
    if (this.cancelAtSleep !== null && ++this.sleeps >= this.cancelAtSleep) throw new Cancelled();
  }
  async waitApproval(): Promise<ApprovalAnswer> {
    this.approvals++;
    return this.answers.shift() ?? { decision: "denied", allowSession: false };
  }
  model() {
    return this.events.reduce(reduce, initialModel());
  }
  statuses() {
    return this.events.flatMap((e) => (e.type === "activity" ? [e.status] : []));
  }
}

const approve = (allowSession = false): ApprovalAnswer => ({ decision: "approved", allowSession });
const deny: ApprovalAnswer = { decision: "denied", allowSession: false };
const timeout: ApprovalAnswer = { decision: "timeout", allowSession: false };

describe("scenarios", () => {
  const all: ScenarioName[] = [
    "english", "roman_urdu", "approval", "grant", "untrusted", "blocked", "error", "badcaption",
  ]; // prettier-ignore

  it.each(all)("%s emits schema-conformant events and no Urdu script in the model", async (name) => {
    const r = new FakeRunner([approve(), approve()]);
    expect(await runScenario(name, r)).toBe("done");
    r.events.forEach(conforms);
    expect(containsArabicScript(JSON.stringify(r.model()))).toBe(false);
    expect(r.model().state).toBe(name === "error" ? "error" : "idle");
  });

  it("every state is reachable by some scenario", async () => {
    const seen = new Set<string>();
    for (const name of all) {
      const r = new FakeRunner([approve()]);
      await runScenario(name, r);
      for (const e of r.events) if (e.type === "state") seen.add(e.state);
    }
    expect([...seen].sort()).toEqual([...HUD_STATES].sort());
  });

  it("captions: valid ones pass the guard, badcaption is replaced", async () => {
    for (const name of ["english", "roman_urdu"] as const) {
      const r = new FakeRunner();
      await runScenario(name, r);
      const cap = r.events.find((e) => e.type === "caption");
      expect(cap && validateCaption(cap as never).ok).toBe(true);
    }
    const r = new FakeRunner();
    await runScenario("badcaption", r);
    expect(r.model().caption?.text).toBe(CAPTION_PLACEHOLDER);
  });

  it("roman_urdu keeps speech_text (Urdu script) separate from the Roman caption", async () => {
    const r = new FakeRunner();
    await runScenario("roman_urdu", r);
    const cap = r.events.find((e) => e.type === "caption");
    if (cap?.type !== "caption") throw new Error("no caption");
    expect(containsArabicScript(cap.speech_text)).toBe(true);
    expect(containsArabicScript(cap.caption_text)).toBe(false);
  });

  it("approval: only an explicit approval produces an ok activity", async () => {
    for (const [answer, expected] of [
      [approve(), "ok"],
      [deny, "denied"],
      [timeout, "timeout"],
    ] as const) {
      const r = new FakeRunner([answer]);
      await runScenario("approval", r);
      expect(r.statuses()).toEqual([expected]);
    }
  });

  it("grant: a session grant skips the second prompt, otherwise it asks twice", async () => {
    const g = new FakeRunner([approve(true)]);
    await runScenario("grant", g);
    expect(g.approvals).toBe(1);
    expect(g.statuses()).toEqual(["ok", "ok"]);
    const n = new FakeRunner([approve(false), approve(false)]);
    await runScenario("grant", n);
    expect(n.approvals).toBe(2);
  });

  it("untrusted: request is flagged and never offers a grant path", async () => {
    const r = new FakeRunner([approve(true)]);
    await runScenario("untrusted", r);
    const req = r.events.find((e) => e.type === "approval_request");
    expect(req?.type === "approval_request" && req.source).toBe("untrusted_content");
  });

  it("blocked: T3 is blocked without any approval prompt", async () => {
    const r = new FakeRunner();
    await runScenario("blocked", r);
    expect(r.approvals).toBe(0);
    expect(r.statuses()).toEqual(["blocked"]);
  });

  it("typed input skips the listening phase", async () => {
    const r = new FakeRunner();
    await runScenario("english", r, { typedText: "notes please" });
    expect(r.events.some((e) => e.type === "state" && e.state === "listening")).toBe(false);
    expect(r.model().transcript?.text).toBe("notes please");
  });

  it("cancel mid-turn ends in a cancelled activity and idle", async () => {
    const r = new FakeRunner([approve()], 3);
    expect(await runScenario("english", r)).toBe("cancelled");
    expect(r.statuses().at(-1)).toBe("cancelled");
    expect(r.events.at(-1)).toEqual({ type: "state", state: "idle" });
  });
});

describe("matchScenario", () => {
  it.each([
    ["show me my password", "blocked"],
    ["send a message", "approval"],
    ["Ahmed ko message bhejo", "approval"],
    ["summarise this web page", "untrusted"],
    ["save a note", "grant"],
    ["mere notes dikhao", "roman_urdu"],
    ["what is in my notes", "english"],
    ["trigger an error", "error"],
    ["badcaption", "badcaption"],
  ] as const)("%s -> %s", (text, expected) => {
    expect(matchScenario(text)).toBe(expected);
  });
});

describe("FROZEN previews", () => {
  it.each(HUD_STATES)("%s reduces to that state", (state) => {
    const m = FROZEN[state].reduce(reduce, initialModel());
    expect(m.state).toBe(state);
    FROZEN[state].forEach(conforms);
    expect(containsArabicScript(JSON.stringify(m))).toBe(false);
    if (state === "approval_needed") expect(m.approval).not.toBeNull();
  });
});

describe("LiveRunner", () => {
  afterEach(() => vi.useRealTimers());

  it("denies on timeout: nobody answering is never approval", async () => {
    vi.useFakeTimers();
    const r = new LiveRunner(() => {});
    const p = r.waitApproval("a", 1000);
    await vi.advanceTimersByTimeAsync(1001);
    expect(await p).toEqual({ decision: "timeout", allowSession: false });
  });

  it("ignores answers for a different approval id", async () => {
    vi.useFakeTimers();
    const r = new LiveRunner(() => {});
    const p = r.waitApproval("a", 1000);
    r.answerApproval("other", "approved");
    await vi.advanceTimersByTimeAsync(1001);
    expect((await p).decision).toBe("timeout");
  });

  it("an answer resolves the wait", async () => {
    const r = new LiveRunner(() => {});
    const p = r.waitApproval("a", 60_000);
    r.answerApproval("a", "approved", true);
    expect(await p).toEqual({ decision: "approved", allowSession: true });
  });

  it("cancel during an approval wait ends the scenario as cancelled without executing", async () => {
    const events: HudEvent[] = [];
    const r = new LiveRunner((e) => events.push(e));
    const done = runScenario("approval", r, { typedText: "send it" });
    for (let i = 0; i < 20 && !events.some((e) => e.type === "approval_request"); i++) {
      await new Promise((res) => setTimeout(res, 100));
    }
    expect(events.some((e) => e.type === "approval_request")).toBe(true);
    r.cancel();
    expect(await done).toBe("cancelled");
    expect(events.some((e) => e.type === "activity" && e.status === "ok")).toBe(false);
    expect(events.at(-1)).toEqual({ type: "state", state: "idle" });
  }, 10_000);
});
