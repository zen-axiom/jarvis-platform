import type { HudState } from "./hudState";

interface Props {
  state: HudState;
  grants: number;
  events: number;
}

/**
 * Honest status of the Phase 1A prototype. Nothing here reads a real subsystem:
 * the values describe what this mock build actually has (and does not have).
 */
export function SystemsPanel({ state, grants, events }: Props) {
  const cards: { k: string; v: string; on: boolean }[] = [
    { k: "Model", v: "mock (no live calls)", on: true },
    { k: "Tools", v: "5 mock, 0 real", on: true },
    { k: "Policy", v: "T0-T3 active", on: true },
    { k: "Approvals", v: state === "approval_needed" ? "waiting on you" : "idle", on: state === "approval_needed" },
    { k: "Voice", v: "off - phase 2", on: false },
    { k: "Network", v: "none", on: false },
    { k: "Grants", v: grants === 0 ? "none" : `${grants} active`, on: grants > 0 },
    { k: "Log", v: `${events} events`, on: events > 0 },
  ];

  return (
    <section className="panel" aria-label="Systems">
      <h2 className="panel-title">Systems</h2>
      <div className="panel-body">
        <div className="cards">
          {cards.map((c) => (
            <div key={c.k} className={`card ${c.on ? "card-on" : "card-off"}`}>
              <span className="card-k">{c.k}</span>
              <span className="card-v">
                <span className="chip-dot" aria-hidden="true" />
                {c.v}
              </span>
            </div>
          ))}
        </div>
      </div>
    </section>
  );
}
