import { describe, expect, it } from "vitest";
import { CAPTION_PLACEHOLDER, containsArabicScript } from "../lib/captionGuard";
import { type HudEvent, HUD_STATES, initialModel, reduce } from "./hudState";

const run = (events: HudEvent[]) => events.reduce(reduce, initialModel());

describe("reducer", () => {
  it("starts idle with nothing shown", () => {
    const m = initialModel();
    expect(m.state).toBe("idle");
    expect(m.caption).toBeNull();
    expect(m.approval).toBeNull();
  });

  it("listening clears the previous exchange", () => {
    const m = run([
      { type: "transcript", lang: "en", text: "hi" },
      { type: "caption", lang: "en", speech_text: "yo", caption_text: "yo" },
      { type: "state", state: "listening" },
    ]);
    expect(m.transcript).toBeNull();
    expect(m.caption).toBeNull();
  });

  it("a valid caption is shown; speech_text is never stored", () => {
    const m = run([
      { type: "caption", lang: "ur-en", speech_text: "آپ کے نوٹس", caption_text: "Aap ke notes" },
    ]);
    expect(m.caption?.text).toBe("Aap ke notes");
    expect(JSON.stringify(m)).not.toContain("آپ");
  });

  it("an Urdu-script caption becomes the placeholder with a notice", () => {
    const m = run([
      { type: "caption", lang: "ur-roman", speech_text: "آپ", caption_text: "آپ کے نوٹس" },
    ]);
    expect(m.caption?.text).toBe(CAPTION_PLACEHOLDER);
    expect(m.captionNotice).toContain("arabic_script");
    expect(containsArabicScript(JSON.stringify(m))).toBe(false);
  });

  it("an English caption that differs from the speech text is rejected", () => {
    const m = run([{ type: "caption", lang: "en", speech_text: "Hello", caption_text: "Hallo" }]);
    expect(m.caption?.text).toBe(CAPTION_PLACEHOLDER);
  });

  it("transcripts, labels, summaries and errors never carry Urdu script", () => {
    const m = run([
      { type: "transcript", lang: "ur-en", text: "آپ کے نوٹس" },
      { type: "activity", id: "a", label: "نوٹس پڑھیں", status: "ok" },
      { type: "error", message: "خرابی" },
      {
        type: "approval_request",
        id: "x",
        tool: "t",
        tier: "T1",
        summary: "نوٹ",
        args: {},
        source: "user_request",
        timeout_s: 5,
      },
    ]);
    expect(containsArabicScript(JSON.stringify(m))).toBe(false);
  });

  it("activity updates in place by id and keeps order", () => {
    const m = run([
      { type: "activity", id: "a", label: "A", status: "pending" },
      { type: "activity", id: "b", label: "B", status: "ok" },
      { type: "activity", id: "a", label: "A", status: "ok" },
    ]);
    expect(m.activity.map((a) => `${a.id}:${a.status}`)).toEqual(["a:ok", "b:ok"]);
  });

  it("approval stays until resolved or the state leaves approval_needed", () => {
    const req: HudEvent = {
      type: "approval_request",
      id: "ap",
      tool: "mock.send_message",
      tier: "T2",
      summary: "Send",
      args: {},
      source: "user_request",
      timeout_s: 20,
    };
    const open = run([req, { type: "state", state: "approval_needed" }]);
    expect(open.approval?.id).toBe("ap");
    expect(reduce(open, { type: "approval_resolved", id: "other", decision: "denied" }).approval).not.toBeNull();
    expect(reduce(open, { type: "approval_resolved", id: "ap", decision: "denied" }).approval).toBeNull();
    expect(reduce(open, { type: "state", state: "idle" }).approval).toBeNull();
  });

  it("error is kept in the error state and cleared on leaving it", () => {
    const e = run([{ type: "error", message: "boom" }, { type: "state", state: "error" }]);
    expect(e.error).toBe("boom");
    expect(reduce(e, { type: "state", state: "idle" }).error).toBeNull();
  });

  it("has exactly the six documented states", () => {
    expect([...HUD_STATES].sort()).toEqual(
      ["approval_needed", "error", "idle", "listening", "speaking", "thinking"].sort(),
    );
  });
});
