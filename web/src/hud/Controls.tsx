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
    <section className="panel controls" aria-label="Controls">
      <div className="panel-body" style={{ padding: "10px 12px" }}>
        <form className="composer" onSubmit={submit}>
          <label className="sr-only" htmlFor="msg">
            Mock command
          </label>
          <input
            id="msg"
            type="text"
            value={text}
            onChange={(e) => setText(e.target.value)}
            placeholder="Mock command - try: notes, send a message, save a note, password, mere notes dikhao"
            autoComplete="off"
            disabled={busy}
          />
          <button type="submit" className="btn" disabled={busy || text.trim() === ""}>
            Send
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
              <button
                key={name}
                type="button"
                className="btn small"
                disabled={busy}
                onClick={() => onScenario(name)}
              >
                {SCENARIO_LABELS[name]}
              </button>
            ))}
          </div>
        </details>
      </div>
    </section>
  );
}
