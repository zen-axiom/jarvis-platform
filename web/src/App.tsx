import { useCallback, useEffect, useMemo, useReducer, useRef, useState } from "react";
import { ActivityStrip } from "./hud/ActivityStrip";
import { ApprovalCard } from "./hud/ApprovalCard";
import { Captions } from "./hud/Captions";
import { Controls } from "./hud/Controls";
import { CoreCanvas } from "./hud/CoreCanvas";
import { MissionPanel } from "./hud/MissionPanel";
import { SystemsPanel } from "./hud/SystemsPanel";
import {
  HUD_STATES,
  type HudModel,
  type HudState,
  STATE_LABEL,
  initialModel,
  missionProgress,
  reduce,
} from "./hud/hudState";
import {
  FROZEN,
  LiveRunner,
  SCENARIO_LABELS,
  type ScenarioName,
  matchScenario,
  runScenario,
} from "./mock/mockStream";

function usePrefersReducedMotion(): boolean {
  const query = "(prefers-reduced-motion: reduce)";
  const [reduced, setReduced] = useState(
    () => typeof window.matchMedia === "function" && window.matchMedia(query).matches,
  );
  useEffect(() => {
    if (typeof window.matchMedia !== "function") return;
    const mq = window.matchMedia(query);
    const on = () => setReduced(mq.matches);
    mq.addEventListener("change", on);
    return () => mq.removeEventListener("change", on);
  }, []);
  return reduced;
}

interface Params {
  frozen: HudState | null;
  scenario: ScenarioName | null;
  /** ?demo=0 suppresses the mission that otherwise auto-runs on load. */
  autoDemo: boolean;
}

function readParams(): Params {
  const q = new URLSearchParams(window.location.search);
  const s = q.get("state");
  const sc = q.get("scenario");
  return {
    frozen: HUD_STATES.includes(s as HudState) ? (s as HudState) : null,
    scenario: sc && sc in SCENARIO_LABELS ? (sc as ScenarioName) : null,
    autoDemo: q.get("demo") !== "0",
  };
}

function frozenModel(state: HudState): HudModel {
  return FROZEN[state].reduce(reduce, initialModel());
}

/** Short centre readout for the core: mission progress, else the state. */
function coreReadout(model: HudModel): { readout: string; sub: string } {
  if (model.state === "error") return { readout: "!", sub: "FAULT" };
  if (model.mission) {
    const pct = Math.round(missionProgress(model.mission) * 100);
    return { readout: `${pct}`, sub: model.state === "approval_needed" ? "HOLD" : "MISSION %" };
  }
  return { readout: "--", sub: "STANDBY" };
}

export default function App() {
  const [params] = useState(readParams);
  const [model, dispatch] = useReducer(reduce, params.frozen, (f) =>
    f ? frozenModel(f) : initialModel(),
  );
  const reducedMotion = usePrefersReducedMotion();
  const runner = useRef<LiveRunner | null>(null);
  const [busy, setBusy] = useState(false);
  const [deadline, setDeadline] = useState<number | null>(null);
  const [, setTick] = useState(0);
  const started = useRef(false);
  const voiceTurns = useRef(0);

  const start = useCallback((name: ScenarioName, typedText?: string) => {
    if (runner.current) return;
    const r = new LiveRunner(dispatch);
    runner.current = r;
    setBusy(true);
    void runScenario(name, r, { typedText }).finally(() => {
      runner.current = null;
      setBusy(false);
    });
  }, []);

  const stop = useCallback(() => runner.current?.cancel(), []);
  const send = useCallback((text: string) => start(matchScenario(text), text), [start]);

  // Escape always stops the current mock task.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") stop();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [stop]);

  // On load, run a scenario so the HUD is alive: ?scenario=, else the demo mission.
  useEffect(() => {
    if (params.frozen || started.current) return;
    const name = params.scenario ?? (params.autoDemo ? "briefing" : null);
    if (!name) return;
    started.current = true;
    const id = setTimeout(() => start(name), 400);
    return () => clearTimeout(id);
  }, [params, start]);

  // Countdown for the open approval request (paused in ?state= previews).
  const approvalId = model.approval?.id ?? null;
  const approvalTimeout = model.approval?.timeout_s ?? 0;
  useEffect(() => {
    if (!approvalId || params.frozen) {
      setDeadline(null);
      return;
    }
    setDeadline(Date.now() + approvalTimeout * 1000);
    const id = setInterval(() => setTick((n) => n + 1), 250);
    return () => clearInterval(id);
  }, [approvalId, params.frozen, approvalTimeout]);

  const secondsLeft =
    deadline === null ? null : Math.max(0, Math.ceil((deadline - Date.now()) / 1000));

  const { readout, sub } = useMemo(() => coreReadout(model), [model]);
  const grants = useMemo(
    () => new Set(model.activity.filter((a) => a.approved_by?.startsWith("grant:")).map((a) => a.approved_by)).size,
    [model.activity],
  );

  const sampleVoice = () => start(voiceTurns.current++ % 2 === 0 ? "english" : "roman_urdu");

  return (
    <div className="app" data-state={model.state}>
      <header className="topbar">
        <span className="brand">JARVIS</span>
        <span className="brand-sub">control surface</span>
        <span className="chip mock">
          <span className="chip-dot" aria-hidden="true" />
          Prototype · mock mode
        </span>
        <span className="topbar-spacer" />
        <span className="chip live">
          <span className="chip-dot" aria-hidden="true" />
          {STATE_LABEL[model.state]}
        </span>
        <span className="chip">model: mock</span>
        <span className="chip">network: none</span>
        <span className="chip">cost: $0.00</span>
      </header>

      <div className="rail rail-left">
        <MissionPanel mission={model.mission} />
      </div>

      <main className="stage">
        <CoreCanvas
          state={model.state}
          reducedMotion={reducedMotion}
          readout={readout}
          readoutSub={sub}
        />
        <div className="stage-overlay">
          <p className="state-label" role="status">
            {STATE_LABEL[model.state]}
          </p>
          {model.state === "error" && model.error ? (
            <div className="error-banner" role="alert">
              <span>{model.error}</span>
              <button
                type="button"
                className="btn small"
                onClick={() => dispatch({ type: "state", state: "idle" })}
              >
                Dismiss
              </button>
              <button
                type="button"
                className="btn small"
                onClick={() => {
                  dispatch({ type: "state", state: "idle" });
                  start("briefing");
                }}
              >
                Retry
              </button>
            </div>
          ) : null}
          <Captions model={model} />
        </div>
      </main>

      <div className="rail rail-right">
        <SystemsPanel state={model.state} grants={grants} events={model.activity.length} />
        <ActivityStrip items={model.activity} />
      </div>

      {model.approval ? (
        <ApprovalCard
          request={model.approval}
          secondsLeft={secondsLeft}
          onDecision={(decision, allow) =>
            runner.current?.answerApproval(model.approval?.id ?? "", decision, allow)
          }
        />
      ) : null}

      <Controls
        busy={busy}
        onSend={send}
        onVoiceTurn={sampleVoice}
        onStop={stop}
        onScenario={(name) => start(name)}
      />
    </div>
  );
}
