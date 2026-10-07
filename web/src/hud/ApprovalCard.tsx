import { useEffect, useRef } from "react";
import { displaySafe } from "../lib/captionGuard";
import type { ApprovalDecision, ApprovalRequest } from "./hudState";

const TIER_TEXT: Record<ApprovalRequest["tier"], string> = {
  T0: "T0 · read only",
  T1: "T1 · reversible local change",
  T2: "T2 · sensitive, always asks",
};

interface Props {
  request: ApprovalRequest;
  /** null = countdown paused (static preview). */
  secondsLeft: number | null;
  onDecision: (decision: ApprovalDecision, allowSession: boolean) => void;
}

export function ApprovalCard({ request, secondsLeft, onDecision }: Props) {
  const denyRef = useRef<HTMLButtonElement>(null);
  const untrusted = request.source === "untrusted_content";
  const canGrant = request.tier !== "T2" && !untrusted;
  const pct = secondsLeft === null ? 100 : Math.max(0, (secondsLeft / request.timeout_s) * 100);

  // Safe default: keyboard focus starts on Deny, never on an approving button.
  useEffect(() => {
    denyRef.current?.focus();
  }, [request.id]);

  return (
    <section
      className="approval"
      role="alertdialog"
      aria-labelledby="ap-title"
      aria-describedby="ap-desc"
    >
      <div className="approval-grid">
        <div>
          <h2 id="ap-title">
            <span className="chip-dot" aria-hidden="true" />
            Approval needed
            <span className={`tier tier-${request.tier}`}>{TIER_TEXT[request.tier]}</span>
          </h2>
          <p id="ap-desc" className="approval-summary">
            {request.summary}
          </p>
          <p className="approval-tool">{request.tool}</p>
          {untrusted ? (
            <p className="warning" role="note">
              Triggered by untrusted content (web or file text). Session grants are disabled for
              this action.
            </p>
          ) : (
            <p className="muted small" style={{ margin: "4px 0 0" }}>
              Requested by you.
            </p>
          )}
        </div>

        <pre className="approval-args" aria-label="Arguments (redacted)">
          {displaySafe(JSON.stringify(request.args, null, 2))}
        </pre>

        <div className="approval-actions">
          <div className="countdown" aria-hidden="true">
            <div className="countdown-bar" style={{ width: `${pct}%` }} />
          </div>
          <p className="muted small mono" style={{ margin: 0 }}>
            {secondsLeft === null
              ? `auto-deny after ${request.timeout_s}s (paused in preview)`
              : `auto-deny in ${secondsLeft}s`}
          </p>
          <button
            ref={denyRef}
            type="button"
            className="btn deny"
            onClick={() => onDecision("denied", false)}
          >
            Deny
          </button>
          <button
            type="button"
            className="btn approve"
            onClick={() => onDecision("approved", false)}
          >
            Approve once
          </button>
          {canGrant ? (
            <button
              type="button"
              className="btn grant small"
              onClick={() => onDecision("approved", true)}
            >
              Allow for this session
            </button>
          ) : null}
        </div>
      </div>
    </section>
  );
}
