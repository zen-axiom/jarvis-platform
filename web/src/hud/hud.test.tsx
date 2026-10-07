import { act } from "react";
import { type Root, createRoot } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import App from "../App";
import { containsArabicScript } from "../lib/captionGuard";
import { ApprovalCard } from "./ApprovalCard";
import { HUD_STATES, type ApprovalRequest } from "./hudState";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

let container: HTMLDivElement;
let root: Root;

beforeEach(() => {
  // jsdom has no canvas; the HUD must degrade gracefully.
  vi.spyOn(HTMLCanvasElement.prototype, "getContext").mockReturnValue(null);
  container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container);
});

afterEach(() => {
  act(() => root.unmount());
  container.remove();
  window.history.replaceState({}, "", "/");
  vi.restoreAllMocks();
});

const REQ: ApprovalRequest = {
  id: "ap",
  tool: "mock.write_note",
  tier: "T1",
  summary: "Save note 'x' (in memory)",
  args: { title: "x" },
  source: "user_request",
  timeout_s: 20,
};

function renderCard(req: ApprovalRequest, onDecision = vi.fn()) {
  act(() => root.render(<ApprovalCard request={req} secondsLeft={12} onDecision={onDecision} />));
  return onDecision;
}

const buttons = () => [...container.querySelectorAll("button")].map((b) => b.textContent);

describe("ApprovalCard", () => {
  it("offers a session grant only for trusted T0/T1 requests", () => {
    renderCard(REQ);
    expect(buttons()).toContain("Allow for this session");
    renderCard({ ...REQ, tier: "T2" });
    expect(buttons()).not.toContain("Allow for this session");
    renderCard({ ...REQ, source: "untrusted_content" });
    expect(buttons()).not.toContain("Allow for this session");
    expect(container.textContent).toContain("untrusted content");
  });

  it("starts with keyboard focus on Deny, never on an approving button", () => {
    renderCard(REQ);
    expect(document.activeElement?.textContent).toBe("Deny");
  });

  it("reports the chosen decision", () => {
    const onDecision = renderCard(REQ);
    const click = (label: string) =>
      act(() => {
        [...container.querySelectorAll("button")].find((b) => b.textContent === label)?.click();
      });
    click("Deny");
    click("Approve once");
    click("Allow for this session");
    expect(onDecision.mock.calls).toEqual([
      ["denied", false],
      ["approved", false],
      ["approved", true],
    ]);
  });

  it("shows the countdown", () => {
    renderCard(REQ);
    expect(container.textContent).toContain("Auto-deny in 12s");
  });
});

describe("App (static state previews)", () => {
  it.each(HUD_STATES)("?state=%s renders without Urdu script and with mock labelling", (state) => {
    window.history.replaceState({}, "", `/?state=${state}`);
    act(() => root.render(<App />));
    const text = container.textContent ?? "";
    expect(containsArabicScript(text)).toBe(false);
    expect(text).toContain("mock mode");
    expect(container.querySelector(".app")?.getAttribute("data-state")).toBe(state);
    expect(container.querySelector('[role="alertdialog"]') !== null).toBe(state === "approval_needed");
  });

  it("Stop is always present and enabled", () => {
    act(() => root.render(<App />));
    const stop = [...container.querySelectorAll("button")].find((b) => b.textContent?.startsWith("Stop"));
    expect(stop).toBeDefined();
    expect(stop?.disabled).toBe(false);
  });
});
