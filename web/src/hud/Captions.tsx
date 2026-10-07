import type { HudModel } from "./hudState";

const LANG_LABEL = { en: "English", "ur-roman": "Roman Urdu", "ur-en": "Roman Urdu + English" } as const;

/**
 * Conversation panel. Only guarded, Roman-only text reaches this component:
 * the reducer replaces any invalid caption with a placeholder and never stores speech_text.
 */
export function Captions({ model }: { model: HudModel }) {
  const { transcript, caption, captionNotice } = model;
  return (
    <section className="conversation" aria-label="Conversation">
      <p className="line you">
        <span className="who">you</span>
        <span className="text" lang={transcript?.lang === "en" ? "en" : "ur-Latn"}>
          {transcript?.text ?? <span className="muted">...</span>}
        </span>
      </p>
      <p className="line jarvis" aria-live="polite">
        <span className="who">jarvis</span>
        <span className="text caption" lang={caption?.lang === "en" ? "en" : "ur-Latn"}>
          {caption?.text ?? <span className="muted">...</span>}
        </span>
        {caption ? <span className="lang-chip">{LANG_LABEL[caption.lang]}</span> : null}
      </p>
      {captionNotice ? (
        <p className="notice" role="note">
          {captionNotice}
        </p>
      ) : null}
    </section>
  );
}
