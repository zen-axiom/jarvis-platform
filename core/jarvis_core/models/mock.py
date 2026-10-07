"""Deterministic scripted provider. Pure function of the conversation; no I/O of any kind."""

from __future__ import annotations

import re
from collections.abc import Iterator

from .base import Message, ModelDelta, ModelRequest

_ROMAN_URDU_WORDS = {
    "dikhao",
    "karo",
    "kya",
    "mere",
    "meri",
    "hai",
    "bhejo",
    "likho",
    "batao",
    "kholo",
    "mita",
}

# Author-written samples; naturalness of the Roman Urdu is unreviewed.
_LIST_EN = "You have three notes: groceries, tomorrow's agenda, and gym schedule."
_LIST_UR_SPEECH = "آپ کے تین نوٹس ہیں: groceries، کل کا agenda، اور gym schedule۔"
_LIST_UR_CAPTION = "Aap ke teen notes hain: groceries, kal ka agenda, aur gym schedule."
_BAD_CAPTION = "آپ کے تین نوٹس ہیں۔"  # simulates a model that wrongly returns Urdu script


def _is_roman_urdu(text: str) -> bool:
    return any(w in _ROMAN_URDU_WORDS for w in re.findall(r"[a-z]+", text.lower()))


class MockProvider:
    name = "mock"

    def complete(self, request: ModelRequest) -> Iterator[ModelDelta]:
        user = next((m for m in request.messages if m.role == "user"), Message("user", ""))
        last = request.messages[-1]
        text = user.content.lower()
        urdu = _is_roman_urdu(text)
        if last.role == "tool":
            yield from self._after_tool(last, urdu)
            return
        if "credential" in text or "password" in text:
            yield ModelDelta.call("mock.read_credentials")
        elif "send" in text or "bhej" in text:
            yield ModelDelta.call("mock.send_message", {"to": "Ahmed", "body": "Meeting confirmed"})
        elif "delete" in text or "mita" in text:
            yield ModelDelta.call("mock.delete_item", {"name": "gym schedule"})
        elif "web page" in text or "untrusted" in text:
            yield ModelDelta.call(
                "mock.write_note",
                {"title": "from web page", "text": "text copied from a web page"},
                source="untrusted_content",
            )
        elif "save" in text or "write" in text or "likho" in text:
            yield ModelDelta.call("mock.write_note", {"title": "idea", "text": "mock note"})
        elif "badcaption" in text:
            yield ModelDelta.reply("ur-roman", _BAD_CAPTION, _BAD_CAPTION)
        elif "note" in text or urdu:
            yield ModelDelta.call("mock.list_notes")
        else:
            yield ModelDelta.reply("en", "I am a mock assistant.", "I am a mock assistant.")
        yield ModelDelta.done()

    def _after_tool(self, tool_msg: Message, urdu: bool) -> Iterator[ModelDelta]:
        out = tool_msg.content
        refused = out.startswith(("denied", "blocked", "timed out", "error"))
        if tool_msg.name == "mock.list_notes" and not refused:
            if urdu:
                yield ModelDelta.reply("ur-en", _LIST_UR_SPEECH, _LIST_UR_CAPTION)
            else:
                yield ModelDelta.reply("en", _LIST_EN, _LIST_EN)
        elif refused:
            if urdu:
                yield ModelDelta.reply(
                    "ur-en", "ٹھیک ہے، میں نے یہ نہیں کیا۔", "Theek hai, maine ye nahi kiya."
                )
            else:
                yield ModelDelta.reply("en", "Okay, I did not do that.", "Okay, I did not do that.")
        else:
            msg = "Done (mock only; nothing left this machine)."
            yield ModelDelta.reply("en", msg, msg)
        yield ModelDelta.done()
