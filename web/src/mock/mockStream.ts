// Scripted mock turns. No microphone, audio, network or model is involved: every line below
// is a hard-coded sample. The Roman Urdu wording is author-written and unreviewed.
import type { ApprovalDecision, HudEvent, HudState } from "../hud/hudState";
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
  | "english"
  | "roman_urdu"
  | "approval"
  | "grant"
  | "untrusted"
  | "blocked"
  | "error"
  | "badcaption";

export const SCENARIO_LABELS: Record<ScenarioName, string> = {
  english: "English read (T0, granted)",
  roman_urdu: "Roman Urdu read (T0, granted)",
  approval: "Send message (T2 approval)",
  grant: "Save note (T1, session grant)",
  untrusted: "Untrusted web text (T1)",
  blocked: "Credentials (T3 blocked)",
  error: "Simulated error",
  badcaption: "Model returns Urdu script",
};

export interface ScenarioOptions {
  /** When set, the turn starts from typed text (no listening phase). */
  typedText?: string;
}

const APPROVAL_TIMEOUT_S = 20;

const LIST_EN = "You have three notes: groceries, tomorrow's agenda, and gym schedule.";
const LIST_UR_SPEECH = "آپ کے تین نوٹس ہیں: groceries، کل کا agenda، اور gym schedule۔";
const LIST_UR_CAPTION = "Aap ke teen notes hain: groceries, kal ka agenda, aur gym schedule.";
const BAD_CAPTION = "آپ کے تین نوٹس ہیں۔";

const ROMAN_URDU_WORDS = new Set([
  "dikhao", "karo", "kya", "mere", "meri", "hai", "bhejo", "likho", "batao", "kholo", "mita",
]); // prettier-ignore

export function looksRomanUrdu(text: string): boolean {
  return (text.toLowerCase().match(/[a-z]+/g) ?? []).some((w) => ROMAN_URDU_WORDS.has(w));
}

export function matchScenario(text: string): ScenarioName {
  const t = text.toLowerCase();
  if (/(credential|password)/.test(t)) return "blocked";
  if (/(send|bhej)/.test(t)) return "approval";
  if (/(web page|untrusted)/.test(t)) return "untrusted";
  if (/(save|write|likho)/.test(t)) return "grant";
  if (t.includes("badcaption")) return "badcaption";
  if (t.includes("error")) return "error";
  if (looksRomanUrdu(t)) return "roman_urdu";
  return "english";
}

// -- building blocks ------------------------------------------------------------------------
async function begin(r: Runner, text: string, lang: CaptionLang, o: ScenarioOptions) {
  if (o.typedText === undefined) {
    r.emit({ type: "state", state: "listening" });
    await r.sleep(900);
  }
  r.emit({ type: "transcript", lang, text: o.typedText ?? text });
  await r.sleep(350);
  r.emit({ type: "state", state: "thinking" });
  await r.sleep(500);
}

async function speak(r: Runner, lang: CaptionLang, speech: string, caption: string) {
  r.emit({ type: "state", state: "speaking" });
  r.emit({ type: "caption", lang, speech_text: speech, caption_text: caption });
  await r.sleep(Math.min(3200, 900 + caption.length * 35));
  r.emit({ type: "state", state: "idle" });
}

async function askApproval(
  r: Runner,
  req: {
    id: string;
    tool: string;
    tier: "T0" | "T1" | "T2";
    summary: string;
    args: Record<string, unknown>;
    source: "user_request" | "untrusted_content";
  },
) {
  r.emit({ type: "approval_request", ...req, timeout_s: APPROVAL_TIMEOUT_S });
  r.emit({ type: "state", state: "approval_needed" });
  const answer = await r.waitApproval(req.id, APPROVAL_TIMEOUT_S * 1000);
  r.emit({ type: "approval_resolved", id: req.id, decision: answer.decision });
  r.emit({ type: "state", state: "thinking" });
  return answer;
}

// -- scenarios ------------------------------------------------------------------------------
type Scenario = (r: Runner, o: ScenarioOptions) => Promise<void>;

const SCENARIOS: Record<ScenarioName, Scenario> = {
  async english(r, o) {
    await begin(r, "What's in my notes?", "en", o);
    r.emit({ type: "activity", id: "e1", label: "Read the mock notes (in memory)", status: "pending", tier: "T0" });
    await r.sleep(600);
    r.emit({ type: "activity", id: "e1", label: "Read the mock notes (in memory)", status: "ok", tier: "T0", approved_by: "grant:demo" });
    await speak(r, "en", LIST_EN, LIST_EN);
  },

  async roman_urdu(r, o) {
    await begin(r, "Jarvis, mere notes dikhao.", "ur-en", o);
    r.emit({ type: "activity", id: "u1", label: "Read the mock notes (in memory)", status: "pending", tier: "T0" });
    await r.sleep(600);
    r.emit({ type: "activity", id: "u1", label: "Read the mock notes (in memory)", status: "ok", tier: "T0", approved_by: "grant:demo" });
    await speak(r, "ur-en", LIST_UR_SPEECH, LIST_UR_CAPTION);
  },

  async approval(r, o) {
    await begin(r, "Send Ahmed a message that the meeting is confirmed.", "en", o);
    const label = "Send a message to Ahmed (mock: never leaves this machine)";
    const a = await askApproval(r, {
      id: "ap1",
      tool: "mock.send_message",
      tier: "T2",
      summary: label,
      args: { to: "Ahmed", body: "Meeting confirmed" },
      source: "user_request",
    });
    if (a.decision === "approved") {
      r.emit({ type: "activity", id: "ap1", label, status: "ok", tier: "T2", approved_by: "user" });
      await speak(r, "en", "Done (mock only; nothing left this machine).", "Done (mock only; nothing left this machine).");
    } else {
      r.emit({ type: "activity", id: "ap1", label, status: a.decision === "timeout" ? "timeout" : "denied", tier: "T2" });
      await speak(r, "en", "Okay, I did not do that.", "Okay, I did not do that.");
    }
  },

  async grant(r, o) {
    await begin(r, "Save a note: call the plumber.", "en", o);
    let granted = false;
    for (const n of [1, 2]) {
      const label = `Save note 'plumber ${n}' (in memory)`;
      const id = `g${n}`;
      if (granted) {
        r.emit({ type: "activity", id, label, status: "ok", tier: "T1", approved_by: "grant:g1" });
        continue;
      }
      const a = await askApproval(r, {
        id,
        tool: "mock.write_note",
        tier: "T1",
        summary: label,
        args: { title: `plumber ${n}`, text: "call the plumber" },
        source: "user_request",
      });
      if (a.decision !== "approved") {
        r.emit({ type: "activity", id, label, status: a.decision === "timeout" ? "timeout" : "denied", tier: "T1" });
        await speak(r, "en", "Okay, I did not do that.", "Okay, I did not do that.");
        return;
      }
      granted = a.allowSession;
      r.emit({ type: "activity", id, label, status: "ok", tier: "T1", approved_by: "user" });
      await r.sleep(300);
    }
    await speak(r, "en", "Saved both notes (mock only).", "Saved both notes (mock only).");
  },

  async untrusted(r, o) {
    await begin(r, "Summarise this web page and save the text.", "en", o);
    const label = "Save note 'from web page' (in memory)";
    const a = await askApproval(r, {
      id: "ut1",
      tool: "mock.write_note",
      tier: "T1",
      summary: label,
      args: { title: "from web page", text: "text copied from a web page" },
      source: "untrusted_content",
    });
    if (a.decision === "approved") {
      r.emit({ type: "activity", id: "ut1", label, status: "ok", tier: "T1", approved_by: "user" });
      await speak(r, "en", "Saved (mock only).", "Saved (mock only).");
    } else {
      r.emit({ type: "activity", id: "ut1", label, status: a.decision === "timeout" ? "timeout" : "denied", tier: "T1" });
      await speak(r, "en", "Okay, I did not do that.", "Okay, I did not do that.");
    }
  },

  async blocked(r, o) {
    await begin(r, "Show me my passwords.", "en", o);
    r.emit({ type: "activity", id: "b1", label: "Read stored credentials", status: "blocked", tier: "T3" });
    await r.sleep(500);
    await speak(r, "en", "I can't do that.", "I can't do that.");
  },

  async error(r, o) {
    await begin(r, "Trigger an error.", "en", o);
    r.emit({ type: "error", message: "Simulated provider error (mock). Nothing was sent anywhere." });
    r.emit({ type: "state", state: "error" });
  },

  async badcaption(r, o) {
    await begin(r, "badcaption please", "ur-en", o);
    await speak(r, "ur-en", BAD_CAPTION, BAD_CAPTION);
  },
};

/** Static event lists for previewing one state (?state=...) without running a scenario. */
export const FROZEN: Record<HudState, HudEvent[]> = {
  idle: [
    { type: "transcript", lang: "en", text: "What's in my notes?" },
    { type: "activity", id: "e1", label: "Read the mock notes (in memory)", status: "ok", tier: "T0", approved_by: "grant:demo" },
    { type: "caption", lang: "en", speech_text: LIST_EN, caption_text: LIST_EN },
    { type: "state", state: "idle" },
  ],
  listening: [
    { type: "state", state: "listening" },
    { type: "transcript", lang: "ur-en", text: "Jarvis, mere notes dikh..." },
  ],
  thinking: [
    { type: "transcript", lang: "ur-en", text: "Jarvis, mere notes dikhao." },
    { type: "activity", id: "u1", label: "Read the mock notes (in memory)", status: "pending", tier: "T0" },
    { type: "state", state: "thinking" },
  ],
  speaking: [
    { type: "transcript", lang: "ur-en", text: "Jarvis, mere notes dikhao." },
    { type: "activity", id: "u1", label: "Read the mock notes (in memory)", status: "ok", tier: "T0", approved_by: "grant:demo" },
    { type: "state", state: "speaking" },
    { type: "caption", lang: "ur-en", speech_text: LIST_UR_SPEECH, caption_text: LIST_UR_CAPTION },
  ],
  error: [
    { type: "transcript", lang: "en", text: "Trigger an error." },
    { type: "error", message: "Simulated provider error (mock). Nothing was sent anywhere." },
    { type: "state", state: "error" },
  ],
  approval_needed: [
    { type: "transcript", lang: "en", text: "Send Ahmed a message that the meeting is confirmed." },
    {
      type: "approval_request",
      id: "ap1",
      tool: "mock.send_message",
      tier: "T2",
      summary: "Send a message to Ahmed (mock: never leaves this machine)",
      args: { to: "Ahmed", body: "Meeting confirmed" },
      source: "user_request",
      timeout_s: APPROVAL_TIMEOUT_S,
    },
    { type: "state", state: "approval_needed" },
  ],
};

export async function runScenario(
  name: ScenarioName,
  r: Runner,
  opts: ScenarioOptions = {},
): Promise<"done" | "cancelled"> {
  try {
    await SCENARIOS[name](r, opts);
    return "done";
  } catch (e) {
    if (!(e instanceof Cancelled)) throw e;
    r.emit({ type: "activity", id: `cancel-${Date.now()}`, label: "Cancelled by user", status: "cancelled" });
    r.emit({ type: "state", state: "idle" });
    return "cancelled";
  }
}

// -- live runner (real timers; used by the browser UI) --------------------------------------
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
      // Deny on timeout: nobody answered is never treated as approval.
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
