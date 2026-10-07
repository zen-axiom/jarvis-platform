import { type Mission, missionProgress, settledSteps } from "./hudState";

const STATUS_NOTE: Record<string, string> = {
  active: "running",
  done: "complete",
  cancelled: "cancelled",
  failed: "failed",
};

export function MissionPanel({ mission }: { mission: Mission | null }) {
  const pct = Math.round(missionProgress(mission) * 100);
  const settled = settledSteps(mission);

  return (
    <section className="panel grow" aria-label="Current mission">
      <h2 className="panel-title">Mission</h2>
      <div className="panel-body grow scroll">
        {!mission ? (
          <p className="muted small">No mission running. Send a mock command to start one.</p>
        ) : (
          <>
            <div className="mission-head">
              <h3 className="mission-title">{mission.title}</h3>
            </div>
            <p className="mission-meta">
              DEMO · {STATUS_NOTE[mission.status] ?? mission.status} · {settled}/{mission.steps.length} steps · {pct}%
            </p>
            <div className="mission-progress" role="progressbar" aria-valuenow={pct} aria-valuemin={0} aria-valuemax={100} aria-label="Mission progress">
              <span style={{ width: `${pct}%` }} />
            </div>
            <ol className="steps">
              {mission.steps.map((s) => (
                <li key={s.id} className={`step step-${s.status}`}>
                  <span className="step-mark" aria-hidden="true" />
                  <span>
                    <span className="step-label">{s.label}</span>
                    <span className="sr-only"> - {s.status}</span>
                    {s.note ? <span className="step-note">{s.note}</span> : null}
                  </span>
                </li>
              ))}
            </ol>
            <p className="demo-note">
              Simulated steps. No real apps, files, accounts or networks are touched.
            </p>
          </>
        )}
      </div>
    </section>
  );
}
