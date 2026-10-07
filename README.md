# Jarvis (personal prototype) - Phase 1A

A personal prototype of a Jarvis-style assistant HUD. **Phase 1A is mock-only.** It contains:

- `web/` - a React + TypeScript control-room HUD that runs a scripted mock stream. A full-viewport
  layout puts a luminous canvas core in the centre (segmented rings, tick ring, radar sweep,
  orbital satellites, particles and data traces) with a mission/step panel on the left and system
  cards plus an activity stream on the right. Six states (idle, listening, thinking, speaking,
  error, approval-needed) each have distinct motion. A demo mission runs on load so the screen is
  alive; it is labelled DEMO and every step is simulated.
- `core/` - a stdlib-only Python core: risk-tier policy, approval semantics, an append-only
  activity log, a cancellable mock turn loop, a mock model provider and mock tools.
- `shared/` - the event contract and caption test vectors used by both sides.

## What Phase 1A deliberately does not do

No live model calls, API keys, OmniRoute, Composio, microphone, audio, shell, browser or computer
automation, file access, account connections, or network access of any kind. The provider
registry accepts only `mock`; `ProviderConfig` has no URL or secret fields. Tests run with
sockets disabled, and a test scans the core source for network-capable imports.

Phase 1A is not intended for public use or distribution.

## Caption rule

Captions never show Urdu script. Each reply carries separate `speech_text` (for a future TTS
engine, never displayed) and `caption_text` (Roman Urdu, or English for English replies). The
guard rejects Arabic-script code points and bidi controls; a rejected caption is replaced by
`[caption unavailable]`. Both implementations (`core/jarvis_core/captions.py`,
`web/src/lib/captionGuard.ts`) are tested against `shared/fixtures/captions.json`.
The Roman Urdu sample lines are author-written and have not been reviewed by a native speaker.

## Run and test

Python 3.11+ and Node 20+ (developed with Python 3.13 and Node 22).

Linux/macOS:

```
python3 -m venv .venv && . .venv/bin/activate
pip install -e "core[dev]"
(cd core && python -m pytest && ruff check . && ruff format --check .)
cd web && npm ci && npm test && npm run build && npm run dev
```

Windows PowerShell:

```
py -3.11 -m venv .venv
.\.venv\Scripts\Activate.ps1
pip install -e "core[dev]"
cd core; python -m pytest; ruff check .; ruff format --check .; cd ..
cd web; npm ci; npm test; npm run build; npm run dev
```

Open `http://127.0.0.1:5173`. Useful URLs: `/?state=approval_needed` (static preview of one
state, no animation loop), `/?scenario=approval` (auto-start one scripted turn), `/?demo=0`
(skip the mission that otherwise runs on load).

`npm run shots` drives an already-installed Chromium (set `CHROMIUM_PATH` if needed), captures
every state at three desktop sizes plus a narrow window, and fails on any console error,
non-local request, visible Urdu script, horizontal overflow, blank core canvas, cramped stage,
or approval-flow regression. It never downloads a browser.

## Windows checklist (not yet done)

Still unverified on Windows: animation smoothness and CPU/GPU cost of the core canvas in
Edge/WebView2; DPI scaling at 100/125/150%; multi-monitor behaviour; OS reduced-motion and
high-contrast settings; Roman Urdu font rendering; keyboard-only use (Tab order, Esc to stop);
the PowerShell commands above. pywebview and the Python-to-HUD bridge belong to Phase 1B.
