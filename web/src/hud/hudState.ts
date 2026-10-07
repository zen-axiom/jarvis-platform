// HUD model and reducer. Event shapes mirror shared/events.schema.json.
import { type CaptionLang, displaySafe, safeCaption, validateCaption } from "../lib/captionGuard";

export type HudState =
  | "idle"
  | "listening"
  | "thinking"
  | "speaking"
  | "error"
  | "approval_needed";

export const HUD_STATES: readonly HudState[] = [
  "idle",
  "listening",
  "thinking",
  "speaking",
  "error",
  "approval_needed",
];

export type Tier = "T0" | "T1" | "T2" | "T3";
export type ActivityStatus =
  | "pending"
  | "ok"
  | "denied"
  | "timeout"
  | "blocked"
  | "cancelled"
  | "error";
export type ApprovalDecision = "approved" | "denied" | "timeout";
export type ApprovalSource = "user_request" | "untrusted_content";

export interface ApprovalRequest {
  id: string;
  tool: string;
  tier: "T0" | "T1" | "T2";
  summary: string;
  args: Record<string, unknown>;
  source: ApprovalSource;
  timeout_s: number;
}

export interface ActivityItem {
  id: string;
  label: string;
  status: ActivityStatus;
  tier?: Tier;
  approved_by?: string;
}

export type HudEvent =
  | { type: "state"; state: HudState }
  | { type: "transcript"; lang: CaptionLang; text: string }
  | { type: "caption"; lang: CaptionLang; speech_text: string; caption_text: string }
  | ({ type: "activity" } & ActivityItem)
  | ({ type: "approval_request" } & ApprovalRequest)
  | { type: "approval_resolved"; id: string; decision: ApprovalDecision }
  | { type: "error"; message: string };

export interface HudModel {
  state: HudState;
  transcript: { lang: CaptionLang; text: string } | null;
  /** Displayable caption only (already passed through the Roman-only guard). */
  caption: { lang: CaptionLang; text: string } | null;
  captionNotice: string | null;
  approval: ApprovalRequest | null;
  activity: ActivityItem[];
  error: string | null;
}

const MAX_ACTIVITY = 30;

export function initialModel(): HudModel {
  return {
    state: "idle",
    transcript: null,
    caption: null,
    captionNotice: null,
    approval: null,
    activity: [],
    error: null,
  };
}

export function reduce(m: HudModel, e: HudEvent): HudModel {
  switch (e.type) {
    case "state": {
      const next: HudModel = {
        ...m,
        state: e.state,
        approval: e.state === "approval_needed" ? m.approval : null,
        error: e.state === "error" ? m.error : null,
      };
      if (e.state === "listening") {
        next.transcript = null;
        next.caption = null;
        next.captionNotice = null;
      }
      return next;
    }
    case "transcript":
      return {
        ...m,
        transcript: { lang: e.lang, text: displaySafe(e.text) },
        caption: null,
        captionNotice: null,
      };
    case "caption": {
      const check = validateCaption(e);
      return {
        ...m,
        caption: { lang: e.lang, text: safeCaption(e) },
        captionNotice: check.ok ? null : `Caption hidden (${check.reason})`,
      };
    }
    case "activity": {
      const { type: _type, ...raw } = e;
      const item = { ...raw, label: displaySafe(raw.label) };
      const i = m.activity.findIndex((a) => a.id === item.id);
      const activity =
        i >= 0 ? m.activity.map((a, j) => (j === i ? item : a)) : [...m.activity, item];
      return { ...m, activity: activity.slice(-MAX_ACTIVITY) };
    }
    case "approval_request": {
      const { type: _type, ...req } = e;
      return { ...m, approval: { ...req, summary: displaySafe(req.summary) } };
    }
    case "approval_resolved":
      return { ...m, approval: m.approval?.id === e.id ? null : m.approval };
    case "error":
      return { ...m, error: displaySafe(e.message) };
  }
}

export const STATE_LABEL: Record<HudState, string> = {
  idle: "Idle",
  listening: "Listening (mock - no microphone)",
  thinking: "Thinking",
  speaking: "Speaking (mock - no audio)",
  error: "Something went wrong",
  approval_needed: "Waiting for your approval",
};
