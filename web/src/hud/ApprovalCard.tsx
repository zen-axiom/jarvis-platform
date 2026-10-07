import { useEffect, useRef } from "react";
import { displaySafe } from "../lib/captionGuard";
import type { ApprovalDecision, ApprovalRequest } from "./hudState";

const TIER_TEXT: Record<ApprovalRequest["tier"], string> = {
  T0: "T0 - read only",
  T1: "T1 - reversible local change",
  T2: "T2 - sensitive (always asks)",
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
    <div className="approval" role="alertdialog" aria-labelledby="ap-title" aria-describedby="ap-desc">
      <div className="approval-head">
        <h2 id="ap-title">Approval needed</h2>
        <span className={`tier tier-${request.tier}`}>{TIER_TEXT[request.tier]}</span>
      </div>
      <p id="ap-desc" className="approval-summary">
        {request.summary}
      </p>
      <p className="approval-tool">
        <code>{request.tool}</code>
      </p>
      <pre className="approval-args" aria-label="Arguments (redacted)">
        {displaySafe(JSON.stringify(request.args, null, 2))}
      </pre>
      {untrusted ? (
        <p className="warning" role="note">
          Triggered by untrusted content (web or file text). Session grants are disabled for this
          action.
        </p>
      ) : (
        <p className="muted small">Requested by you.</p>
      )}
      <div className="countdown" aria-hidden="true">
        <div className="countdown-bar" style={{ width: `${pct}%` }} />
      </div>
      <p className="muted small">
        {secondsLeft === null
          ? `Auto-deny after ${request.timeout_s}s (countdown paused in preview)`
          : `Auto-deny in ${secondsLeft}s`}
      </p>
      <div className="approval-actions">
        <button ref={denyRef} type="button" className="btn deny" onClick={() => onDecision("denied", false)}>
          Deny
        </button>
        <button type="button" className="btn approve" onClick={() => onDecision("approved", false)}>
          Approve once
        </button>
        {canGrant ? (
          <button type="button" className="btn grant" onClick={() => onDecision("approved", true)}>
            Allow for this session
          </button>
        ) : null}
      </div>
    </div>
  );
}
