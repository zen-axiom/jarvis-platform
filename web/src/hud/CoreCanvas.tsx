import { useEffect, useRef } from "react";
import type { HudState } from "./hudState";

interface Props {
  state: HudState;
  reducedMotion: boolean;
}

type ColorKey = "ice" | "pulse" | "amber" | "red";

interface Style {
  speed: number; // rad/s of ring rotation; 0 freezes the rings
  color: ColorKey;
  alpha: number;
  counter?: boolean; // alternate ring directions
  spark?: boolean; // orbiting highlight
  mic?: boolean; // reacts to the (synthetic) input level
  voice?: boolean; // pulses with a (synthetic) speech envelope
  jitter?: boolean;
  hold?: boolean; // slow attention pulse
}

const STYLE: Record<HudState, Style> = {
  idle: { speed: 0.12, color: "ice", alpha: 0.5 },
  listening: { speed: 0.35, color: "ice", alpha: 0.92, mic: true },
  thinking: { speed: 0.9, color: "ice", alpha: 0.95, counter: true, spark: true },
  speaking: { speed: 0.3, color: "pulse", alpha: 0.95, voice: true },
  error: { speed: 0.05, color: "red", alpha: 0.9, jitter: true },
  approval_needed: { speed: 0, color: "amber", alpha: 0.9, hold: true },
};

const FALLBACK: Record<ColorKey, string> = {
  ice: "127, 216, 255",
  pulse: "140, 255, 214",
  amber: "255, 179, 64",
  red: "255, 93, 93",
};

type Palette = Record<ColorKey, string>;

function readPalette(el: Element): Palette {
  const cs = getComputedStyle(el);
  const get = (name: string, key: ColorKey) => cs.getPropertyValue(name).trim() || FALLBACK[key];
  return {
    ice: get("--ice-rgb", "ice"),
    pulse: get("--pulse-rgb", "pulse"),
    amber: get("--amber-rgb", "amber"),
    red: get("--red-rgb", "red"),
  };
}

interface Frame {
  state: HudState;
  t: number; // seconds since mount
  angle: number; // accumulated rotation (freezes in approval)
  sinceEnter: number; // seconds since the current state began
  motion: number; // 0 for reduced motion, else 1
  palette: Palette;
}

const TAU = Math.PI * 2;
const rgba = (rgb: string, a: number) => `rgba(${rgb}, ${Math.max(0, Math.min(1, a))})`;

function drawFrame(ctx: CanvasRenderingContext2D, w: number, h: number, f: Frame): void {
  const s = STYLE[f.state];
  const rgb = f.palette[s.color];
  const cx = w / 2;
  const cy = h / 2;
  const R = Math.min(w, h) * 0.2;
  const m = f.motion;

  // Synthetic envelopes: nothing here reads a microphone or audio output.
  const micLevel = s.mic ? 0.5 + 0.35 * Math.sin(f.t * 3.1) + 0.15 * Math.sin(f.t * 8.3 + 1) : 0;
  const voice = s.voice ? (0.5 + 0.5 * Math.sin(f.t * 7)) * (0.55 + 0.45 * Math.sin(f.t * 2.3 + 1)) : 0;
  const breathe = f.state === "idle" ? 0.03 * Math.sin(f.t * 1.2) : 0;
  const attention = s.hold ? 0.55 + 0.35 * Math.sin(f.t * 2) : 1;
  const alpha = s.alpha * (m ? attention : 1);

  ctx.clearRect(0, 0, w, h);

  const glow = ctx.createRadialGradient(cx, cy, 0, cx, cy, R * 1.1);
  glow.addColorStop(0, rgba(rgb, 0.34 * alpha + 0.1 * voice * m));
  glow.addColorStop(1, rgba(rgb, 0));
  ctx.fillStyle = glow;
  ctx.beginPath();
  ctx.arc(cx, cy, R * 1.1, 0, TAU);
  ctx.fill();

  ctx.lineCap = "round";
  for (let i = 0; i < 4; i++) {
    const scale = 1 + m * (breathe + (i >= 2 ? 0.1 * micLevel : 0.04 * micLevel) + 0.09 * voice);
    const r = R * (0.62 + i * 0.34) * scale;
    const n = 10 + i * 6;
    const dir = s.counter && i % 2 ? -1 : 1;
    const offset = f.angle * (1 + i * 0.35) * dir;
    const decay = Math.exp(-f.sinceEnter * 3);
    ctx.lineWidth = 1.6 + (3 - i) * 0.7;
    ctx.strokeStyle = rgba(rgb, alpha * (0.95 - i * 0.17));
    const arc = (TAU / n) * 0.72;
    for (let k = 0; k < n; k++) {
      const jitter = s.jitter && m ? Math.sin(f.t * 37 + k * 11 + i) * 0.22 * decay : 0;
      const a0 = (k * TAU) / n + offset + jitter;
      ctx.beginPath();
      ctx.arc(cx, cy, r, a0, a0 + arc);
      ctx.stroke();
    }
  }

  if (s.spark && m) {
    const sa = f.t * 2.4;
    const sr = R * (0.62 + 2 * 0.34);
    ctx.shadowColor = rgba(rgb, 1);
    ctx.shadowBlur = 14;
    ctx.fillStyle = rgba(rgb, 1);
    ctx.beginPath();
    ctx.arc(cx + Math.cos(sa) * sr, cy + Math.sin(sa) * sr, 3.2, 0, TAU);
    ctx.fill();
    ctx.shadowBlur = 0;
  }
}

export function CoreCanvas({ state, reducedMotion }: Props) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const stateRef = useRef<HudState>(state);
  const enteredRef = useRef(0);
  const renderRef = useRef<((now: number) => void) | null>(null);

  useEffect(() => {
    stateRef.current = state;
    enteredRef.current = performance.now();
  }, [state]);

  useEffect(() => {
    const canvas = canvasRef.current;
    const ctx = canvas?.getContext("2d");
    if (!canvas || !ctx) return; // e.g. jsdom: nothing to draw
    const palette = readPalette(canvas);
    const start = performance.now();
    let angle = 0;
    let last = start;
    let lastDraw = 0;
    let raf = 0;
    let w = 0;
    let h = 0;

    const resize = () => {
      const dpr = window.devicePixelRatio || 1;
      w = canvas.clientWidth;
      h = canvas.clientHeight;
      canvas.width = Math.max(1, Math.round(w * dpr));
      canvas.height = Math.max(1, Math.round(h * dpr));
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    };

    const render = (now: number) => {
      const st = stateRef.current;
      const dt = Math.min(0.1, (now - last) / 1000);
      last = now;
      if (!reducedMotion) angle += dt * STYLE[st].speed;
      drawFrame(ctx, w, h, {
        state: st,
        t: reducedMotion ? 0 : (now - start) / 1000,
        angle: reducedMotion ? 0 : angle,
        sinceEnter: reducedMotion ? 99 : (now - enteredRef.current) / 1000,
        motion: reducedMotion ? 0 : 1,
        palette,
      });
    };

    const loop = (now: number) => {
      raf = requestAnimationFrame(loop);
      // Idle is low-power: ~20 fps.
      if (stateRef.current === "idle" && now - lastDraw < 50) return;
      lastDraw = now;
      render(now);
    };

    resize();
    renderRef.current = render;
    const ro =
      typeof ResizeObserver === "function"
        ? new ResizeObserver(() => {
            resize();
            render(performance.now());
          })
        : null;
    ro?.observe(canvas);

    if (reducedMotion) {
      render(performance.now());
    } else {
      raf = requestAnimationFrame(loop);
    }
    return () => {
      renderRef.current = null;
      cancelAnimationFrame(raf);
      ro?.disconnect();
    };
  }, [reducedMotion]);

  // Reduced motion draws a single static frame, so redraw whenever the state changes.
  useEffect(() => {
    if (reducedMotion) renderRef.current?.(performance.now());
  }, [state, reducedMotion]);

  return <canvas ref={canvasRef} className="core-canvas" aria-hidden="true" data-state={state} />;
}
