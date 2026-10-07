import { useCallback, useEffect, useReducer, useRef, useState } from "react";
import { ActivityStrip } from "./hud/ActivityStrip";
import { ApprovalCard } from "./hud/ApprovalCard";
import { Captions } from "./hud/Captions";
import { Controls } from "./hud/Controls";
import { CoreCanvas } from "./hud/CoreCanvas";
import {
  HUD_STATES,
  type HudModel,
  STATE_LABEL,
  type HudState,
  initialModel,
  reduce,
} from "./hud/hudState";
import {
  FROZEN,
  LiveRunner,
  type ScenarioName,
  SCENARIO_LABELS,
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
}

function readParams(): Params {
  const q = new URLSearchParams(window.location.search);
  const s = q.get("state");
  const sc = q.get("scenario");
  return {
    frozen: HUD_STATES.includes(s as HudState) ? (s as HudState) : null,
    scenario: sc && sc in SCENARIO_LABELS ? (sc as ScenarioName) : null,
  };
}

function frozenModel(state: HudState): HudModel {
  return FROZEN[state].reduce(reduce, initialModel());
}

export default function App() {
  const [params] = useState(readParams);
  const [model, dispatch] = useReducer(
    reduce,
    params.frozen,
    (f) => (f ? frozenModel(f) : initialModel()),
  );
  const reducedMotion = usePrefersReducedMotion();
  const runner = useRef<LiveRunner | null>(null);
  const [busy, setBusy] = useState(false);
  const [deadline, setDeadline] = useState<number | null>(null);
  const [, setTick] = useState(0);
  const started = useRef(false);

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

  const send = useCallback(
    (text: string) => start(matchScenario(text), text),
    [start],
  );

  // Escape always stops the current mock task.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") stop();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [stop]);

  // ?scenario=name auto-starts one scenario (used by the screenshot script).
  useEffect(() => {
    if (params.scenario && !params.frozen && !started.current) {
      started.current = true;
      start(params.scenario);
    }
  }, [params, start]);

  // Countdown for the open approval request (paused in ?state= previews).
  const approvalId = model.approval?.id ?? null;
  useEffect(() => {
    if (!approvalId || params.frozen) {
      setDeadline(null);
      return;
    }
    const secs = model.approval?.timeout_s ?? 0;
    setDeadline(Date.now() + secs * 1000);
    const id = setInterval(() => setTick((n) => n + 1), 250);
    return () => clearInterval(id);
  }, [approvalId, params.frozen, model.approval?.timeout_s]);

  const secondsLeft = deadline === null ? null : Math.max(0, Math.ceil((deadline - Date.now()) / 1000));

  // The mock voice turn alternates English / Roman Urdu. No microphone or audio is used.
  const voiceTurns = useRef(0);
  const sampleVoice = () => start(voiceTurns.current++ % 2 === 0 ? "english" : "roman_urdu");

  return (
    <div className="app" data-state={model.state}>
      <header className="topbar">
        <span className="brand">JARVIS</span>
        <span className="chip mock" title="No microphone, network, model or account is used">
          Prototype - mock mode
        </span>
        <span className="chip">model: mock (no live calls)</span>
        <span className="chip">cost: $0.00</span>
      </header>

      <main className="stage">
        <div className="core" role="img" aria-label={`Jarvis core, ${STATE_LABEL[model.state]}`}>
          <CoreCanvas state={model.state} reducedMotion={reducedMotion} />
        </div>
        <p className="state-label" role="status">
          {STATE_LABEL[model.state]}
        </p>
        {model.state === "error" && model.error ? (
          <div className="error-banner" role="alert">
            <span>{model.error}</span>
            <button type="button" className="btn small" onClick={() => dispatch({ type: "state", state: "idle" })}>
              Dismiss
            </button>
            <button
              type="button"
              className="btn small"
              onClick={() => {
                dispatch({ type: "state", state: "idle" });
                start("english");
              }}
            >
              Retry
            </button>
          </div>
        ) : null}
      </main>

      <Captions model={model} />
      <ActivityStrip items={model.activity} />

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
