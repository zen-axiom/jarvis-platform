// Roman-only caption guard. Mirrors core/jarvis_core/captions.py; both are tested against
// shared/fixtures/captions.json. speech_text is for a future TTS engine and is never shown.

export type CaptionLang = "en" | "ur-roman" | "ur-en";
export type CaptionReason =
  | "unknown_lang"
  | "empty_caption"
  | "arabic_script"
  | "bidi_control"
  | "english_mismatch";

export interface CaptionPair {
  lang: string;
  speech_text: string;
  caption_text: string;
}

export type CaptionCheck = { ok: true } | { ok: false; reason: CaptionReason };

export const CAPTION_PLACEHOLDER = "[caption unavailable]";
const LANGS: readonly string[] = ["en", "ur-roman", "ur-en"];

// Arabic, Arabic Supplement, Arabic Extended-A, Presentation Forms A and B.
const ARABIC_SCRIPT = /[؀-ۿݐ-ݿࢠ-ࣿﭐ-﷿ﹰ-﻿]/;
// ZWNJ/ZWJ/LRM/RLM, bidi embeddings/overrides, bidi isolates.
const BIDI_CONTROL = /[‌-‏‪-‮⁦-⁩]/;

export function containsArabicScript(text: string): boolean {
  return ARABIC_SCRIPT.test(text);
}

/** Check order is part of the shared contract. */
export function validateCaption(p: CaptionPair): CaptionCheck {
  if (!LANGS.includes(p.lang)) return { ok: false, reason: "unknown_lang" };
  if (p.caption_text.trim() === "") return { ok: false, reason: "empty_caption" };
  if (ARABIC_SCRIPT.test(p.caption_text)) return { ok: false, reason: "arabic_script" };
  if (BIDI_CONTROL.test(p.caption_text)) return { ok: false, reason: "bidi_control" };
  if (p.lang === "en" && p.caption_text !== p.speech_text) {
    return { ok: false, reason: "english_mismatch" };
  }
  return { ok: true };
}

export const HIDDEN_TEXT = "[non-Roman text hidden]";

/** Defense in depth: any other string the HUD shows (transcript, labels, errors) is Roman-only too. */
export function displaySafe(text: string): string {
  return ARABIC_SCRIPT.test(text) || BIDI_CONTROL.test(text) ? HIDDEN_TEXT : text;
}

/** The only text the HUD may display for a caption. */
export function safeCaption(p: CaptionPair): string {
  return validateCaption(p).ok ? p.caption_text : CAPTION_PLACEHOLDER;
}
