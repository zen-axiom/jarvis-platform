// Scripted mock turns. No microphone, audio, network, model, app or tool is involved:
// every line, step and result below is hard-coded. The Roman Urdu wording is
// author-written and unreviewed.
import type { ApprovalDecision, HudEvent, HudState, StepStatus } from "../hud/hudState";
import type { CaptionLang } from "../lib/captionGuard";

export class Cancelled extends Error {
  constructor() {
    super("cancelled");
    this.name = "Cancelled";
  }
}

export interface ApprovalAnswer {
  decision: ApprovalDecision;
  allowSession: boolean;
}

export interface Runner {
  emit(e: HudEvent): void;
  sleep(ms: number): Promise<void>;
  waitApproval(id: string, timeoutMs: number): Promise<ApprovalAnswer>;
}

export type ScenarioName =
  | "briefing"
  | "english"
  | "roman_urdu"
  | "approval"
  | "grant"
  | "untrusted"
  | "blocked"
  | "error"
  | "badcaption";

export const SCENARIO_LABELS: Record<ScenarioName, string> = {
  briefing: "Demo mission (5 steps)",
  english: "English read (T0)",
  roman_urdu: "Roman Urdu read (T0)",
  approval: "Send message (T2 approval)",
  grant: "Save note (T1 session grant)",
  untrusted: "Untrusted web text (T1)",
  blocked: "Credentials (T3 blocked)",
  error: "Simulated error",
  badcaption: "Model returns Urdu script",
};

export interface ScenarioOptions {
  /** When set, the turn starts from typed text (no listening phase). */
  typedText?: string;
}

const APPROVAL_TIMEOUT_S = 25;

const LIST_EN = "You have three notes: groceries, tomorrow's agenda, and gym schedule.";
const LIST_UR_SPEECH = "آپ کے تین نوٹس ہیں: groceries، کل کا agenda، اور gym schedule۔";
const LIST_UR_CAPTION = "Aap ke teen notes hain: groceries, kal ka agenda, aur gym schedule.";
const BAD_CAPTION = "آپ کے تین نوٹس ہیں۔";
const REFUSED = "Okay, I did not do that.";

const ROMAN_URDU_WORDS = new Set([
  "dikhao", "karo", "kya", "mere", "meri", "hai", "bhejo", "likho", "batao", "kholo", "mita",
]); // prettier-ignore

export function looksRomanUrdu(text: string): boolean {
  return (text.toLowerCase().match(/[a-z]+/g) ?? []).some((w) => ROMAN_URDU_WORDS.has(w));
}

export function matchScenario(text: string): ScenarioName {
  const t = text.toLowerCase();
  if (/(credential|password)/.test(t)) return "blocked";
  // Checked before "summar...", so "summarise this web page" stays an untrusted-source turn.
  if (/(web page|untrusted)/.test(t)) return "untrusted";
  if (/(brief|demo|mission|summar)/.test(t)) return "briefing";
  if (/(send|bhej)/.test(t)) return "approval";
  if (/(save|write|likho)/.test(t)) return "grant";
  if (t.includes("badcaption")) return "badcaption";
  if (t.includes("error")) return "error";
  if (looksRomanUrdu(t)) return "roman_urdu";
  return "english";
}

interface PlanStep {
  id: string;
  label: string;
  note?: string;
}

/** Scenario context: wraps the runner and tracks the mission so cancel can mark it. */
class Ctx {
  missionId = "";
  activeStep: string | null = null;
  private labels = new Map<string, string>();
  private planNotes = new Map<string, string>();

  constructor(
    private readonly r: Runner,
    readonly opts: ScenarioOptions,
  ) {}

  emit(e: HudEvent): void {
    this.r.emit(e);
  }

  sleep(ms: number): Promise<void> {
    return this.r.sleep(ms);
  }

  plan(id: string, title: string, steps: PlanStep[]): void {
    this.missionId = id;
    this.emit({ type: "mission", id, title, status: "active" });
    for (const s of steps) {
      this.labels.set(s.id, s.label);
      if (s.note) this.planNotes.set(s.id, s.note);
      this.emit({
        type: "step",
        id: s.id,
        mission_id: id,
        label: s.label,
        status: "pending",
        ...(s.note ? { note: s.note } : {}),
      });
    }
  }

  step(id: string, status: StepStatus, note?: string): void {
    this.activeStep = status === "active" ? id : null;
    // Fall back to the planning note so a step does not lose its subtitle while it runs.
    const shown = note ?? this.planNotes.get(id);
    this.emit({
      type: "step",
      id,
      mission_id: this.missionId,
      label: this.labels.get(id) ?? id,
      status,
      ...(shown ? { note: shown } : {}),
    });
  }

  mission(status: "active" | "done" | "cancelled" | "failed", title?: string): void {
    this.emit({
      type: "mission",
      id: this.missionId,
      title: title ?? this.title,
      status,
    });
  }

  /** Human-readable mission title, set by each scenario before plan(). */
  title = "";

  /** Opening beat: optional listening phase, then transcript and thinking. */
  async begin(text: string, lang: CaptionLang): Promise<void> {
    if (this.opts.typedText === undefined) {
      this.emit({ type: "state", state: "listening" });
      await this.sleep(900);
    }
    this.emit({ type: "transcript", lang, text: this.opts.typedText ?? text });
    await this.sleep(320);
    this.emit({ type: "state", state: "thinking" });
    await this.sleep(420);
  }

  async speak(lang: CaptionLang, speech: string, caption: string): Promise<void> {
    this.emit({ type: "state", state: "speaking" });
    this.emit({ type: "caption", lang, speech_text: speech, caption_text: caption });
    await this.sleep(Math.min(3400, 1000 + caption.length * 32));
    this.emit({ type: "state", state: "idle" });
  }

  /** Run a mock tool that needs no approval. */
  async act(id: string, label: string, tier: "T0" | "T1", by = "grant:demo"): Promise<void> {
    this.emit({ type: "activity", id, label, status: "pending", tier });
    await this.sleep(620);
    this.emit({ type: "activity", id, label, status: "ok", tier, approved_by: by });
  }

  async askApproval(req: {
    id: string;
    tool: string;
    tier: "T0" | "T1" | "T2";
    summary: string;
    args: Record<string, unknown>;
    source: "user_request" | "untrusted_content";
  }): Promise<ApprovalAnswer> {
    this.emit({ type: "approval_request", ...req, timeout_s: APPROVAL_TIMEOUT_S });
    this.emit({ type: "state", state: "approval_needed" });
    const answer = await this.r.waitApproval(req.id, APPROVAL_TIMEOUT_S * 1000);
    this.emit({ type: "approval_resolved", id: req.id, decision: answer.decision });
    this.emit({ type: "state", state: "thinking" });
    return answer;
  }

  /** Record the outcome of an approval on both the activity log and the step list. */
  settle(id: string, label: string, tier: "T0" | "T1" | "T2", decision: ApprovalDecision): StepStatus {
    const status: StepStatus =
      decision === "approved" ? "ok" : decision === "timeout" ? "timeout" : "denied";
    this.emit({
      type: "activity",
      id,
      label,
      status,
      tier,
      ...(decision === "approved" ? { approved_by: "user" } : {}),
    });
    return status;
  }
}

// ---------------------------------------------------------------------------- scenarios
type Scenario = (c: Ctx) => Promise<void>;

const SCENARIOS: Record<ScenarioName, Scenario> = {
  // The headline demo: a multi-step task that visibly progresses and then stops
  // at a sensitive action to ask. Every step is simulated.
  async briefing(c) {
    c.title = "Evening briefing (demo)";
    c.plan("m-brief", c.title, [
      { id: "s1", label: "Read mock notes", note: "mock.list_notes · T0" },
      { id: "s2", label: "Scan demo calendar", note: "sample data, not a real calendar" },
      { id: "s3", label: "Draft summary", note: "mock model, no live call" },
      { id: "s4", label: "Send summary to Ahmed", note: "mock.send_message · T2 · asks first" },
      { id: "s5", label: "Record in activity history", note: "local, in memory" },
    ]);
    await c.begin("Jarvis, run my evening briefing.", "en");

    c.step("s1", "active");
    await c.act("b1", "Read the mock notes (in memory)", "T0");
    c.step("s1", "ok", "3 notes");

    c.step("s2", "active");
    await c.act("b2", "Scan the demo calendar (sample data)", "T0");
    c.step("s2", "ok", "2 demo entries");

    c.step("s3", "active");
    await c.sleep(820);
    c.step("s3", "ok", "42 words");
    await c.speak(
      "en",
      "Your briefing is ready: three notes and two demo calendar entries.",
      "Your briefing is ready: three notes and two demo calendar entries.",
    );

    c.emit({ type: "state", state: "thinking" });
    await c.sleep(420);
    c.step("s4", "active");
    const label = "Send the briefing to Ahmed (mock: never leaves this machine)";
    const a = await c.askApproval({
      id: "b4",
      tool: "mock.send_message",
      tier: "T2",
      summary: label,
      args: { to: "Ahmed", subject: "Evening briefing", body: "3 notes, 2 demo entries" },
      source: "user_request",
    });
    const status = c.settle("b4", label, "T2", a.decision);
    c.step("s4", status);

    if (a.decision === "approved") {
      c.step("s5", "active");
      await c.act("b5", "Write the briefing to the activity history", "T1", "user");
      c.step("s5", "ok");
      c.mission("done");
      await c.speak("en", "Briefing sent (mock only).", "Briefing sent (mock only).");
    } else {
      c.step("s5", "skipped", "not reached");
      c.mission("cancelled");
      await c.speak("en", REFUSED, REFUSED);
    }
  },

  async english(c) {
    c.title = "Read notes (demo)";
    c.plan("m-en", c.title, [
      { id: "s1", label: "Read mock notes", note: "mock.list_notes · T0" },
      { id: "s2", label: "Answer out loud", note: "mock, no audio" },
    ]);
    await c.begin("What's in my notes?", "en");
    c.step("s1", "active");
    await c.act("e1", "Read the mock notes (in memory)", "T0");
    c.step("s1", "ok", "3 notes");
    c.step("s2", "active");
    await c.speak("en", LIST_EN, LIST_EN);
    c.step("s2", "ok");
    c.mission("done");
  },

  async roman_urdu(c) {
    c.title = "Notes dikhao (demo)";
    c.plan("m-ur", c.title, [
      { id: "s1", label: "Read mock notes", note: "mock.list_notes · T0" },
      { id: "s2", label: "Answer in Roman Urdu", note: "caption guard enforced" },
    ]);
    await c.begin("Jarvis, mere notes dikhao.", "ur-en");
    c.step("s1", "active");
    await c.act("u1", "Read the mock notes (in memory)", "T0");
    c.step("s1", "ok", "3 notes");
    c.step("s2", "active");
    await c.speak("ur-en", LIST_UR_SPEECH, LIST_UR_CAPTION);
    c.step("s2", "ok");
    c.mission("done");
  },

  async approval(c) {
    c.title = "Send a message (demo)";
    c.plan("m-ap", c.title, [
      { id: "s1", label: "Send message to Ahmed", note: "mock.send_message · T2 · asks first" },
    ]);
    await c.begin("Send Ahmed a message that the meeting is confirmed.", "en");
    c.step("s1", "active");
    const label = "Send a message to Ahmed (mock: never leaves this machine)";
    const a = await c.askApproval({
      id: "ap1",
      tool: "mock.send_message",
      tier: "T2",
      summary: label,
      args: { to: "Ahmed", body: "Meeting confirmed" },
      source: "user_request",
    });
    c.step("s1", c.settle("ap1", label, "T2", a.decision));
    c.mission(a.decision === "approved" ? "done" : "cancelled");
    await c.speak(
      "en",
      a.decision === "approved" ? "Done (mock only; nothing left this machine)." : REFUSED,
      a.decision === "approved" ? "Done (mock only; nothing left this machine)." : REFUSED,
    );
  },

  async grant(c) {
    c.title = "Save two notes (demo)";
    c.plan("m-gr", c.title, [
      { id: "s1", label: "Save note 1", note: "mock.write_note · T1" },
      { id: "s2", label: "Save note 2", note: "reuses a session grant if given" },
    ]);
    await c.begin("Save a note: call the plumber.", "en");
    let granted = false;
    for (const n of [1, 2]) {
      const sid = `s${n}`;
      const id = `g${n}`;
      const label = `Save note 'plumber ${n}' (in memory)`;
      c.step(sid, "active");
      if (granted) {
        c.emit({ type: "activity", id, label, status: "ok", tier: "T1", approved_by: "grant:g1" });
        c.step(sid, "ok", "session grant");
        continue;
      }
      const a = await c.askApproval({
        id,
        tool: "mock.write_note",
        tier: "T1",
        summary: label,
        args: { title: `plumber ${n}`, text: "call the plumber" },
        source: "user_request",
      });
      const status = c.settle(id, label, "T1", a.decision);
      c.step(sid, status);
      if (a.decision !== "approved") {
        if (n === 1) c.step("s2", "skipped", "not reached");
        c.mission("cancelled");
        await c.speak("en", REFUSED, REFUSED);
        return;
      }
      granted = a.allowSession;
      await c.sleep(260);
    }
    c.mission("done");
    await c.speak("en", "Saved both notes (mock only).", "Saved both notes (mock only).");
  },

  async untrusted(c) {
    c.title = "Save text from a web page (demo)";
    c.plan("m-ut", c.title, [
      { id: "s1", label: "Save text from a demo web page", note: "untrusted source · no grants" },
    ]);
    await c.begin("Summarise this web page and save the text.", "en");
    c.step("s1", "active");
    const label = "Save note 'from web page' (in memory)";
    const a = await c.askApproval({
      id: "ut1",
      tool: "mock.write_note",
      tier: "T1",
      summary: label,
      args: { title: "from web page", text: "text copied from a demo web page" },
      source: "untrusted_content",
    });
    c.step("s1", c.settle("ut1", label, "T1", a.decision));
    c.mission(a.decision === "approved" ? "done" : "cancelled");
    await c.speak(
      "en",
      a.decision === "approved" ? "Saved (mock only)." : REFUSED,
      a.decision === "approved" ? "Saved (mock only)." : REFUSED,
    );
  },

  async blocked(c) {
    c.title = "Read credentials (demo)";
    c.plan("m-bl", c.title, [
      { id: "s1", label: "Read stored credentials", note: "mock.read_credentials · T3" },
    ]);
    await c.begin("Show me my passwords.", "en");
    c.step("s1", "active");
    c.emit({ type: "activity", id: "b1", label: "Read stored credentials", status: "blocked", tier: "T3" });
    await c.sleep(520);
    c.step("s1", "blocked", "tier T3 is always blocked");
    c.mission("failed");
    await c.speak("en", "I can't do that.", "I can't do that.");
  },

  async error(c) {
    c.title = "Error path (demo)";
    c.plan("m-er", c.title, [{ id: "s1", label: "Call the mock provider" }]);
    await c.begin("Trigger an error.", "en");
    c.step("s1", "active");
    await c.sleep(420);
    c.step("s1", "error", "simulated failure");
    c.mission("failed");
    c.emit({ type: "error", message: "Simulated provider error (mock). Nothing was sent anywhere." });
    c.emit({ type: "state", state: "error" });
  },

  async badcaption(c) {
    c.title = "Caption guard (demo)";
    c.plan("m-bc", c.title, [{ id: "s1", label: "Model returns Urdu script", note: "guard replaces it" }]);
    await c.begin("badcaption please", "ur-en");
    c.step("s1", "active");
    await c.speak("ur-en", BAD_CAPTION, BAD_CAPTION);
    c.step("s1", "ok", "caption replaced");
    c.mission("done");
  },
};

export async function runScenario(
  name: ScenarioName,
  r: Runner,
  opts: ScenarioOptions = {},
): Promise<"done" | "cancelled"> {
  const c = new Ctx(r, opts);
  try {
    await SCENARIOS[name](c);
    return "done";
  } catch (e) {
    if (!(e instanceof Cancelled)) throw e;
    if (c.activeStep) c.step(c.activeStep, "cancelled", "stopped by you");
    if (c.missionId) c.mission("cancelled");
    r.emit({ type: "activity", id: `cancel-${Date.now()}`, label: "Cancelled by user", status: "cancelled" });
    r.emit({ type: "state", state: "idle" });
    return "cancelled";
  }
}

// ------------------------------------------------- static previews (?state=...)
function brief(status: HudState): HudEvent[] {
  const steps: [string, string, StepStatus, string][] = [
    ["s1", "Read mock notes", "ok", "3 notes"],
    ["s2", "Scan demo calendar", "ok", "2 demo entries"],
    ["s3", "Draft summary", status === "thinking" ? "active" : "ok", status === "thinking" ? "mock model" : "42 words"],
    ["s4", "Send summary to Ahmed", status === "approval_needed" ? "active" : "pending", "T2 · asks first"],
    ["s5", "Record in activity history", "pending", "local, in memory"],
  ];
  return [
    { type: "mission", id: "m", title: "Evening briefing (demo)", status: "active" },
    ...steps.map(
      ([id, label, st, note]): HudEvent => ({
        type: "step",
        id,
        mission_id: "m",
        label,
        status: st,
        note,
      }),
    ),
    { type: "activity", id: "a1", label: "Read the mock notes (in memory)", status: "ok", tier: "T0", approved_by: "grant:demo" },
    { type: "activity", id: "a2", label: "Scan the demo calendar (sample data)", status: "ok", tier: "T0", approved_by: "grant:demo" },
  ];
}

export const FROZEN: Record<HudState, HudEvent[]> = {
  idle: [
    ...brief("idle"),
    { type: "transcript", lang: "en", text: "Jarvis, run my evening briefing." },
    { type: "caption", lang: "en", speech_text: LIST_EN, caption_text: LIST_EN },
    { type: "state", state: "idle" },
  ],
  listening: [
    ...brief("listening"),
    { type: "state", state: "listening" },
    { type: "transcript", lang: "ur-en", text: "Jarvis, mere notes dikh..." },
  ],
  thinking: [
    ...brief("thinking"),
    { type: "transcript", lang: "en", text: "Jarvis, run my evening briefing." },
    { type: "activity", id: "a3", label: "Draft the summary (mock model)", status: "pending", tier: "T0" },
    { type: "state", state: "thinking" },
  ],
  speaking: [
    ...brief("speaking"),
    { type: "transcript", lang: "ur-en", text: "Jarvis, mere notes dikhao." },
    { type: "state", state: "speaking" },
    { type: "caption", lang: "ur-en", speech_text: LIST_UR_SPEECH, caption_text: LIST_UR_CAPTION },
  ],
  error: [
    ...brief("error"),
    { type: "transcript", lang: "en", text: "Trigger an error." },
    { type: "step", id: "s4", mission_id: "m", label: "Send summary to Ahmed", status: "error", note: "simulated failure" },
    { type: "mission", id: "m", title: "Evening briefing (demo)", status: "failed" },
    { type: "error", message: "Simulated provider error (mock). Nothing was sent anywhere." },
    { type: "state", state: "error" },
  ],
  approval_needed: [
    ...brief("approval_needed"),
    { type: "transcript", lang: "en", text: "Jarvis, run my evening briefing." },
    {
      type: "approval_request",
      id: "ap1",
      tool: "mock.send_message",
      tier: "T2",
      summary: "Send the briefing to Ahmed (mock: never leaves this machine)",
      args: { to: "Ahmed", subject: "Evening briefing", body: "3 notes, 2 demo entries" },
      source: "user_request",
      timeout_s: APPROVAL_TIMEOUT_S,
    },
    { type: "state", state: "approval_needed" },
  ],
};

// -------------------------------------- live runner (real timers; used by the browser UI)
export class LiveRunner implements Runner {
  private cancelled = false;
  private rejecters = new Set<(e: Error) => void>();
  private approval: { id: string; resolve: (a: ApprovalAnswer) => void } | null = null;

  constructor(private readonly onEvent: (e: HudEvent) => void) {}

  emit(e: HudEvent): void {
    this.onEvent(e);
  }

  sleep(ms: number): Promise<void> {
    if (this.cancelled) return Promise.reject(new Cancelled());
    return new Promise((resolve, reject) => {
      const done = () => {
        this.rejecters.delete(fail);
        resolve();
      };
      const timer = setTimeout(done, ms);
      const fail = (e: Error) => {
        clearTimeout(timer);
        this.rejecters.delete(fail);
        reject(e);
      };
      this.rejecters.add(fail);
    });
  }

  waitApproval(id: string, timeoutMs: number): Promise<ApprovalAnswer> {
    if (this.cancelled) return Promise.reject(new Cancelled());
    return new Promise((resolve, reject) => {
      const finish = (a: ApprovalAnswer) => {
        clearTimeout(timer);
        this.rejecters.delete(fail);
        this.approval = null;
        resolve(a);
      };
      const fail = (e: Error) => {
        clearTimeout(timer);
        this.rejecters.delete(fail);
        this.approval = null;
        reject(e);
      };
      // Deny on timeout: nobody answering is never treated as approval.
      const timer = setTimeout(() => finish({ decision: "timeout", allowSession: false }), timeoutMs);
      this.rejecters.add(fail);
      this.approval = { id, resolve: finish };
    });
  }

  /** Called by the approval card. Ignored if the id is not the one being waited on. */
  answerApproval(id: string, decision: ApprovalDecision, allowSession = false): void {
    if (this.approval?.id === id) this.approval.resolve({ decision, allowSession });
  }

  cancel(): void {
    this.cancelled = true;
    for (const reject of [...this.rejecters]) reject(new Cancelled());
  }
}
