import { useEffect, useRef } from "react";
import type { HudState } from "./hudState";

interface Props {
  state: HudState;
  reducedMotion: boolean;
  /** Short string shown at the centre of the core (e.g. mission progress). */
  readout: string;
  readoutSub: string;
}

type ColorKey = "cyan" | "blue" | "mint" | "amber" | "red";

interface Visual {
  color: ColorKey;
  ringSpeed: number;
  sweep: number;
  particle: number;
  trace: number;
  bloom: number;
  counter: boolean;
  bars: boolean;
  jitter: boolean;
  attention: boolean;
}

const V: Record<HudState, Visual> = {
  idle: { color: "cyan", ringSpeed: 0.08, sweep: 0, particle: 0.25, trace: 0.35, bloom: 0.42, counter: false, bars: false, jitter: false, attention: false },
  listening: { color: "cyan", ringSpeed: 0.3, sweep: 0.6, particle: 0.85, trace: 0.9, bloom: 0.8, counter: false, bars: true, jitter: false, attention: false },
  thinking: { color: "blue", ringSpeed: 1.05, sweep: 2.5, particle: 1.5, trace: 2, bloom: 0.85, counter: true, bars: false, jitter: false, attention: false },
  speaking: { color: "mint", ringSpeed: 0.34, sweep: 0.28, particle: 0.95, trace: 1.1, bloom: 1, counter: false, bars: false, jitter: false, attention: false },
  approval_needed: { color: "amber", ringSpeed: 0, sweep: 0, particle: 0.14, trace: 0.22, bloom: 0.62, counter: false, bars: false, jitter: false, attention: true },
  error: { color: "red", ringSpeed: 0.05, sweep: 0, particle: 0.3, trace: 0.25, bloom: 0.5, counter: false, bars: false, jitter: true, attention: false },
};

const FALLBACK: Record<ColorKey, string> = {
  cyan: "120, 225, 255",
  blue: "56, 142, 255",
  mint: "130, 255, 214",
  amber: "255, 176, 64",
  red: "255, 86, 86",
};

type Palette = Record<ColorKey, string>;

function readPalette(el: Element): Palette {
  const cs = getComputedStyle(el);
  const get = (n: string, k: ColorKey) => cs.getPropertyValue(n).trim() || FALLBACK[k];
  return {
    cyan: get("--cyan-rgb", "cyan"),
    blue: get("--blue-rgb", "blue"),
    mint: get("--mint-rgb", "mint"),
    amber: get("--amber-rgb", "amber"),
    red: get("--red-rgb", "red"),
  };
}

const TAU = Math.PI * 2;
const rgba = (rgb: string, a: number) => `rgba(${rgb}, ${Math.max(0, Math.min(1, a))})`;

/** Deterministic pseudo-random so the scene is stable frame to frame. */
function rnd(i: number, salt = 0): number {
  const x = Math.sin(i * 127.1 + salt * 311.7 + 1.23) * 43758.5453;
  return x - Math.floor(x);
}

/** Decorative labels only; the same information lives in the Systems panel (DOM). */
const CHIPS = ["CORE", "PLAN", "POLICY", "TOOLS", "LOG", "VOICE", "MODEL", "MEM"];

interface Frame {
  state: HudState;
  t: number;
  angle: number;
  motion: number;
  palette: Palette;
  readout: string;
  readoutSub: string;
}

function roundRect(ctx: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, r: number) {
  if (typeof ctx.roundRect === "function") {
    ctx.beginPath();
    ctx.roundRect(x, y, w, h, r);
    return;
  }
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.arcTo(x + w, y, x + w, y + h, r);
  ctx.arcTo(x + w, y + h, x, y + h, r);
  ctx.arcTo(x, y + h, x, y, r);
  ctx.arcTo(x, y, x + w, y, r);
  ctx.closePath();
}

function draw(ctx: CanvasRenderingContext2D, w: number, h: number, f: Frame): void {
  const v = V[f.state];
  const rgb = f.palette[v.color];
  const cool = f.palette.cyan;
  const cx = w / 2;
  const cy = h / 2;
  const R = Math.max(70, Math.min(w * 0.3, h * 0.4));
  const m = f.motion;
  const t = f.t;

  // synthetic envelopes - no microphone or audio is read anywhere
  const mic = v.bars ? 0.45 + 0.3 * Math.sin(t * 3.1) + 0.2 * Math.sin(t * 8.3 + 1) : 0;
  const voice = f.state === "speaking" ? (0.5 + 0.5 * Math.sin(t * 7)) * (0.55 + 0.45 * Math.sin(t * 2.3)) : 0;
  const breathe = f.state === "idle" ? 0.028 * Math.sin(t * 1.15) : 0;
  const attention = v.attention && m ? 0.6 + 0.4 * Math.sin(t * 2.1) : 1;
  const jitter = (k: number) => (v.jitter && m ? Math.sin(t * 29 + k * 7.3) * 0.16 : 0);
  const A = attention;

  ctx.clearRect(0, 0, w, h);

  // ---- 1. ambient bloom behind the core
  const bloom = ctx.createRadialGradient(cx, cy, 0, cx, cy, R * 2.1);
  bloom.addColorStop(0, rgba(rgb, 0.16 * A + 0.07 * voice * m));
  bloom.addColorStop(0.45, rgba(rgb, 0.05 * A));
  bloom.addColorStop(1, rgba(rgb, 0));
  ctx.fillStyle = bloom;
  ctx.fillRect(0, 0, w, h);

  // ---- 2. dot-matrix field in a polar grid, fading outward
  for (let ring = 3; ring < 13; ring++) {
    const rr = R * (0.45 + ring * 0.16);
    const n = 14 + ring * 5;
    for (let k = 0; k < n; k++) {
      const a = (k / n) * TAU + ring * 0.21 + (m ? t * 0.012 * (ring % 2 ? 1 : -1) : 0);
      const x = cx + Math.cos(a) * rr;
      const y = cy + Math.sin(a) * rr * 0.98;
      if (x < -8 || x > w + 8 || y < -8 || y > h + 8) continue;
      const twinkle = m ? 0.5 + 0.5 * Math.sin(t * 1.4 + ring + k * 0.7) : 0.7;
      ctx.fillStyle = rgba(cool, 0.055 * twinkle * A * Math.max(0, 1 - ring / 14));
      ctx.fillRect(x - 1, y - 1, 2, 2);
    }
  }

  // ---- 3. data traces running out to the side panels
  const traceY = [-0.44, -0.2, 0.2, 0.44];
  for (let s = 0; s < 2; s++) {
    const dir = s === 0 ? -1 : 1;
    for (let i = 0; i < traceY.length; i++) {
      const y = cy + R * traceY[i];
      const x0 = cx + dir * R * 1.42;
      const x1 = dir < 0 ? 0 : w;
      ctx.strokeStyle = rgba(cool, 0.14 * A);
      ctx.lineWidth = 1;
      ctx.beginPath();
      ctx.moveTo(x0, y);
      const elbow = x0 + dir * Math.abs(x1 - x0) * 0.35;
      ctx.lineTo(elbow, y);
      ctx.lineTo(elbow + dir * 14, y + (i < 2 ? -12 : 12));
      ctx.lineTo(x1, y + (i < 2 ? -12 : 12));
      ctx.stroke();
      if (!m) continue;
      // travelling pulse
      const phase = (t * v.trace * 0.35 + i * 0.27 + s * 0.4) % 1;
      const px = x0 + (elbow - x0) * phase;
      const g = ctx.createLinearGradient(px - dir * 26, 0, px, 0);
      g.addColorStop(0, rgba(rgb, 0));
      g.addColorStop(1, rgba(rgb, 0.85 * A));
      ctx.strokeStyle = g;
      ctx.lineWidth = 1.8;
      ctx.beginPath();
      ctx.moveTo(px - dir * 26, y);
      ctx.lineTo(px, y);
      ctx.stroke();
    }
  }

  // ---- 4. particles drifting in an annulus
  const P = 46;
  for (let i = 0; i < P; i++) {
    const base = rnd(i) * TAU;
    const rr = R * (1.05 + rnd(i, 1) * 0.95);
    const spd = (0.06 + rnd(i, 2) * 0.16) * v.particle * (i % 2 ? 1 : -1);
    const a = base + (m ? t * spd : 0);
    const x = cx + Math.cos(a) * rr;
    const y = cy + Math.sin(a) * rr * 0.9;
    const size = 0.7 + rnd(i, 3) * 1.5;
    const fade = m ? 0.35 + 0.65 * Math.abs(Math.sin(t * 0.7 + i)) : 0.6;
    ctx.fillStyle = rgba(cool, 0.4 * fade * A);
    ctx.beginPath();
    ctx.arc(x, y, size, 0, TAU);
    ctx.fill();
  }

  // ---- 5. outer tick ring
  const tickR = R * 1.33;
  const TICKS = 96;
  for (let i = 0; i < TICKS; i++) {
    const a = (i / TICKS) * TAU + (m ? f.angle * 0.12 : 0);
    const major = i % 8 === 0;
    const len = major ? 11 : 5;
    ctx.strokeStyle = rgba(cool, (major ? 0.5 : 0.2) * A);
    ctx.lineWidth = major ? 1.4 : 1;
    ctx.beginPath();
    ctx.moveTo(cx + Math.cos(a) * tickR, cy + Math.sin(a) * tickR);
    ctx.lineTo(cx + Math.cos(a) * (tickR + len), cy + Math.sin(a) * (tickR + len));
    ctx.stroke();
  }

  // ---- 6. chip ring (decorative labels; real values are in the Systems panel)
  const cw = Math.max(44, R * 0.3);
  const ch = Math.max(14, R * 0.085);
  // Clamp to an ellipse that fits inside the canvas so labels never clip at the edges.
  const chipRx = Math.min(R * 1.58, w / 2 - cw / 2 - 8);
  const chipRy = Math.min(R * 1.4, h / 2 - ch / 2 - 8);
  ctx.font = `500 ${Math.max(7, Math.round(R * 0.045))}px ui-monospace, monospace`;
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  for (let i = 0; i < CHIPS.length; i++) {
    const a = (i / CHIPS.length) * TAU - Math.PI / 2 + 0.2;
    const x = cx + Math.cos(a) * chipRx;
    const y = cy + Math.sin(a) * chipRy;
    // Draw a chip only where the ellipse clears the tick ring, so none overlaps or clips.
    if (Math.hypot(x - cx, y - cy) < tickR + ch * 0.75) continue;
    // one chip lights up at a time, travelling around the ring
    const lit = m && Math.floor(t * (v.ringSpeed > 0.4 ? 3 : 1)) % CHIPS.length === i;
    roundRect(ctx, x - cw / 2, y - ch / 2, cw, ch, 3);
    ctx.fillStyle = rgba(lit ? rgb : cool, lit ? 0.22 * A : 0.07 * A);
    ctx.fill();
    ctx.strokeStyle = rgba(lit ? rgb : cool, lit ? 0.75 * A : 0.22 * A);
    ctx.lineWidth = 1;
    ctx.stroke();
    ctx.fillStyle = rgba(lit ? rgb : cool, lit ? 0.95 * A : 0.42 * A);
    ctx.fillText(CHIPS[i], x, y + 0.5);
  }

  // ---- 7. radar sweep
  if (v.sweep > 0 && m) {
    const a = t * v.sweep;
    const span = 0.55;
    const grad = ctx.createRadialGradient(cx, cy, R * 0.3, cx, cy, tickR);
    grad.addColorStop(0, rgba(rgb, 0));
    grad.addColorStop(1, rgba(rgb, 0.085));
    ctx.fillStyle = grad;
    ctx.beginPath();
    ctx.moveTo(cx, cy);
    ctx.arc(cx, cy, tickR, a - span, a);
    ctx.closePath();
    ctx.fill();
    ctx.strokeStyle = rgba(rgb, 0.38);
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(cx, cy);
    ctx.lineTo(cx + Math.cos(a) * tickR, cy + Math.sin(a) * tickR);
    ctx.stroke();
  }

  // ---- 8. segmented arc rings
  ctx.lineCap = "round";
  const RINGS = [
    { r: 0.58, n: 3, gap: 0.3, lw: 2.6, sp: 1 },
    { r: 0.74, n: 18, gap: 0.42, lw: 2, sp: -0.7 },
    { r: 0.9, n: 6, gap: 0.22, lw: 3.4, sp: 0.45 },
    { r: 1.08, n: 28, gap: 0.5, lw: 1.6, sp: -0.3 },
    { r: 1.2, n: 2, gap: 0.12, lw: 5, sp: 0.22 },
  ];
  for (let i = 0; i < RINGS.length; i++) {
    const ring = RINGS[i];
    const scale = 1 + m * (breathe + 0.07 * mic + 0.085 * voice);
    const r = R * ring.r * scale;
    const dir = v.counter && i % 2 ? -ring.sp : ring.sp;
    const off = f.angle * dir * 1.6 + jitter(i);
    const arc = (TAU / ring.n) * (1 - ring.gap);
    ctx.lineWidth = ring.lw;
    ctx.strokeStyle = rgba(rgb, (0.9 - i * 0.1) * A);
    ctx.shadowColor = rgba(rgb, 0.55 * A);
    ctx.shadowBlur = 10;
    for (let k = 0; k < ring.n; k++) {
      const a0 = (k * TAU) / ring.n + off;
      ctx.beginPath();
      ctx.arc(cx, cy, r, a0, a0 + arc);
      ctx.stroke();
    }
    ctx.shadowBlur = 0;
  }

  // ---- 9. listening bars around the inner ring
  if (v.bars && m) {
    const BARS = 64;
    for (let i = 0; i < BARS; i++) {
      const a = (i / BARS) * TAU;
      const amp = (0.35 + 0.65 * Math.abs(Math.sin(t * 5 + i * 0.5))) * mic;
      const r0 = R * 1.24;
      const r1 = r0 + R * 0.1 * amp;
      ctx.strokeStyle = rgba(rgb, 0.25 + 0.6 * amp);
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.moveTo(cx + Math.cos(a) * r0, cy + Math.sin(a) * r0);
      ctx.lineTo(cx + Math.cos(a) * r1, cy + Math.sin(a) * r1);
      ctx.stroke();
    }
  }

  // ---- 10. orbital satellites with trails
  if (m) {
    const ORB = [
      { r: 1.08, sp: 0.9, size: 3.4 },
      { r: 0.74, sp: -1.5, size: 2.6 },
      { r: 1.2, sp: 0.55, size: 2.2 },
    ];
    for (let i = 0; i < ORB.length; i++) {
      const o = ORB[i];
      const a = t * o.sp * (v.ringSpeed > 0 ? 1 : 0.15) + i * 2.1;
      const r = R * o.r;
      for (let k = 0; k < 10; k++) {
        const ta = a - k * 0.045 * Math.sign(o.sp);
        ctx.fillStyle = rgba(rgb, (0.5 - k * 0.05) * A);
        ctx.beginPath();
        ctx.arc(cx + Math.cos(ta) * r, cy + Math.sin(ta) * r, o.size * (1 - k * 0.07), 0, TAU);
        ctx.fill();
      }
      ctx.shadowColor = rgba(rgb, 0.9);
      ctx.shadowBlur = 12;
      ctx.fillStyle = rgba(rgb, A);
      ctx.beginPath();
      ctx.arc(cx + Math.cos(a) * r, cy + Math.sin(a) * r, o.size, 0, TAU);
      ctx.fill();
      ctx.shadowBlur = 0;
    }
  }

  // ---- 11. inner orb and readout
  const orbR = R * 0.44 * (1 + m * (0.06 * voice + 0.03 * mic + breathe));
  const orb = ctx.createRadialGradient(cx - orbR * 0.25, cy - orbR * 0.3, orbR * 0.1, cx, cy, orbR);
  orb.addColorStop(0, rgba(rgb, (0.5 + 0.35 * voice) * v.bloom * A));
  orb.addColorStop(0.55, rgba(rgb, 0.16 * v.bloom * A));
  orb.addColorStop(1, rgba(rgb, 0.02));
  ctx.fillStyle = orb;
  ctx.beginPath();
  ctx.arc(cx, cy, orbR, 0, TAU);
  ctx.fill();
  ctx.strokeStyle = rgba(rgb, 0.45 * A);
  ctx.lineWidth = 1.2;
  ctx.stroke();

  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  ctx.fillStyle = rgba(rgb, 0.98 * A);
  ctx.shadowColor = rgba(rgb, 0.8 * A);
  ctx.shadowBlur = 18;
  ctx.font = `600 ${Math.round(R * 0.26)}px ui-monospace, monospace`;
  ctx.fillText(f.readout, cx, cy - R * 0.03);
  ctx.shadowBlur = 0;
  ctx.font = `500 ${Math.round(R * 0.062)}px ui-monospace, monospace`;
  ctx.fillStyle = rgba(cool, 0.6 * A);
  ctx.fillText(f.readoutSub, cx, cy + R * 0.16);
}

export function CoreCanvas({ state, reducedMotion, readout, readoutSub }: Props) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const live = useRef({ state, readout, readoutSub });
  const renderRef = useRef<((now: number) => void) | null>(null);

  live.current = { state, readout, readoutSub };

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
      const dpr = Math.min(2, window.devicePixelRatio || 1);
      w = canvas.clientWidth;
      h = canvas.clientHeight;
      canvas.width = Math.max(1, Math.round(w * dpr));
      canvas.height = Math.max(1, Math.round(h * dpr));
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    };

    const render = (now: number) => {
      const cur = live.current;
      const dt = Math.min(0.1, (now - last) / 1000);
      last = now;
      if (!reducedMotion) angle += dt * V[cur.state].ringSpeed;
      draw(ctx, w, h, {
        state: cur.state,
        t: reducedMotion ? 0 : (now - start) / 1000,
        angle: reducedMotion ? 0 : angle,
        motion: reducedMotion ? 0 : 1,
        palette,
        readout: cur.readout,
        readoutSub: cur.readoutSub,
      });
    };

    const loop = (now: number) => {
      raf = requestAnimationFrame(loop);
      // standby is low-power: ~20fps
      if (live.current.state === "idle" && now - lastDraw < 50) return;
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

    if (reducedMotion) render(performance.now());
    else raf = requestAnimationFrame(loop);

    return () => {
      renderRef.current = null;
      cancelAnimationFrame(raf);
      ro?.disconnect();
    };
  }, [reducedMotion]);

  // Reduced motion draws a single static frame, so redraw when the content changes.
  useEffect(() => {
    if (reducedMotion) renderRef.current?.(performance.now());
  }, [state, readout, readoutSub, reducedMotion]);

  return <canvas ref={canvasRef} className="core-canvas" aria-hidden="true" data-state={state} />;
}
