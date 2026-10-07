import { type FormEvent, useState } from "react";
import { SCENARIO_LABELS, type ScenarioName } from "../mock/mockStream";

interface Props {
  busy: boolean;
  onSend: (text: string) => void;
  onVoiceTurn: () => void;
  onStop: () => void;
  onScenario: (name: ScenarioName) => void;
}

export function Controls({ busy, onSend, onVoiceTurn, onStop, onScenario }: Props) {
  const [text, setText] = useState("");

  const submit = (e: FormEvent) => {
    e.preventDefault();
    const t = text.trim();
    if (!t || busy) return;
    onSend(t);
    setText("");
  };

  return (
    <section className="controls" aria-label="Controls">
      <form className="composer" onSubmit={submit}>
        <label className="sr-only" htmlFor="msg">
          Message (mock)
        </label>
        <input
          id="msg"
          type="text"
          value={text}
          onChange={(e) => setText(e.target.value)}
          placeholder="Type a message (mock): notes, send, save, password, mere notes dikhao..."
          autoComplete="off"
          disabled={busy}
        />
        <button type="submit" className="btn" disabled={busy || text.trim() === ""}>
          Send (mock)
        </button>
        <button type="button" className="btn" disabled={busy} onClick={onVoiceTurn}>
          Mock voice turn
        </button>
        <button type="button" className="btn stop" onClick={onStop} aria-keyshortcuts="Escape">
          Stop <kbd>Esc</kbd>
        </button>
      </form>
      <details className="dev">
        <summary>Mock scenarios</summary>
        <div className="dev-grid">
          {(Object.keys(SCENARIO_LABELS) as ScenarioName[]).map((name) => (
            <button key={name} type="button" className="btn small" disabled={busy} onClick={() => onScenario(name)}>
              {SCENARIO_LABELS[name]}
            </button>
          ))}
        </div>
      </details>
    </section>
  );
}
