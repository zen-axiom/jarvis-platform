import { describe, expect, it } from "vitest";
import fixtures from "../../../shared/fixtures/captions.json";
import {
  CAPTION_PLACEHOLDER,
  HIDDEN_TEXT,
  containsArabicScript,
  displaySafe,
  safeCaption,
  validateCaption,
} from "./captionGuard";

type Case = {
  id: string;
  lang: string;
  speech_text: string;
  caption_text: string;
  valid: boolean;
  reason?: string;
};

describe("shared caption fixtures", () => {
  for (const c of fixtures.cases as Case[]) {
    it(c.id, () => {
      const check = validateCaption(c);
      expect(check.ok).toBe(c.valid);
      if (!c.valid) {
        expect(check.ok === false && check.reason).toBe(c.reason);
        expect(safeCaption(c)).toBe(CAPTION_PLACEHOLDER);
      }
      expect(containsArabicScript(safeCaption(c))).toBe(false);
    });
  }
});

describe("displaySafe", () => {
  it("passes Roman text and hides Urdu script or bidi controls", () => {
    expect(displaySafe("Aap ke notes hain")).toBe("Aap ke notes hain");
    expect(displaySafe("آپ کے نوٹس")).toBe(HIDDEN_TEXT);
    expect(displaySafe("abc‮def")).toBe(HIDDEN_TEXT);
  });
});
