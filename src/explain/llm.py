# the interface a language model provider would satisfy, kept here so the rest of
# the code can type against it. nothing is wired up: note extraction runs locally.

from __future__ import annotations

from typing import Any, Protocol, runtime_checkable


@runtime_checkable
class LLMClient(Protocol):

    def generate(self, prompt: str, **kwargs: Any) -> str:
        ...

    def extract(self, text: str, schema: dict) -> dict:
        ...


class NoOpLLMClient:

    def generate(self, prompt: str, **kwargs: Any) -> str:
        raise NotImplementedError("LLM provider not configured yet (deferred to Week 2).")

    def extract(self, text: str, schema: dict) -> dict:
        raise NotImplementedError("LLM provider not configured yet (deferred to Week 2).")
