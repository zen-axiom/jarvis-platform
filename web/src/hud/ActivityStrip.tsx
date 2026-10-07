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
    <section className="panel grow" aria-label="Activity">
      <h2 className="panel-title">Activity · mock</h2>
      <div className="panel-body grow scroll">
        {items.length === 0 ? (
          <p className="muted small">No actions yet.</p>
        ) : (
          <ol className="activity-list" role="log">
            {[...items].reverse().map((a) => (
              <li key={a.id} className={`act act-${a.status}`}>
                <span className="act-dot" aria-hidden="true" />
                <span className="act-label">{a.label}</span>
                <span className="act-meta">
                  <span className="act-status">
                    {a.tier ? <span className={`tier tier-${a.tier}`}>{a.tier}</span> : null}{" "}
                    {STATUS_TEXT[a.status]}
                  </span>
                  {a.approved_by ? <span className="act-by">by {a.approved_by}</span> : null}
                </span>
              </li>
            ))}
          </ol>
        )}
      </div>
    </section>
  );
}
