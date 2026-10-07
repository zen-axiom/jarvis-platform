import type { ActivityItem } from "./hudState";

const STATUS_TEXT: Record<ActivityItem["status"], string> = {
  pending: "running",
  ok: "done",
  denied: "denied",
  timeout: "timed out",
  blocked: "blocked",
  cancelled: "cancelled",
  error: "error",
};

export function ActivityStrip({ items }: { items: ActivityItem[] }) {
  return (
    <section className="activity" aria-label="Activity">
      <h2 className="activity-title">Activity (mock)</h2>
      {items.length === 0 ? (
        <p className="muted small">Nothing yet.</p>
      ) : (
        <ol className="activity-list" role="log">
          {[...items].reverse().map((a) => (
            <li key={a.id} className={`act act-${a.status}`}>
              <span className="act-dot" aria-hidden="true" />
              <span className="act-label">{a.label}</span>
              {a.tier ? <span className={`tier tier-${a.tier}`}>{a.tier}</span> : null}
              <span className="act-status">{STATUS_TEXT[a.status]}</span>
              {a.approved_by ? <span className="act-by">by {a.approved_by}</span> : null}
            </li>
          ))}
        </ol>
      )}
    </section>
  );
}
