"""Officer-note PII masking: composite identifiers must not leak their parts."""
from __future__ import annotations

import pytest

from src.features.notes_signals import sanitize_pii


@pytest.mark.parametrize(
    "text, token",
    [
        ("PAN ABCDE1234F", "[REDACTED_PAN]"),
        ("Aadhaar 1234 5678 9012", "[REDACTED_AADHAAR]"),
        ("Aadhaar 1234-5678-9012", "[REDACTED_AADHAAR]"),
        ("call +91 98765 43210", "[REDACTED_PHONE]"),
        ("call 98765-43210", "[REDACTED_PHONE]"),
        ("GSTIN 27ABCDE1234F1Z5", "[REDACTED_GSTIN]"),
        ("A/c 0123456789012", "[REDACTED_ACCOUNT]"),
        ("mail ramesh.k@gmail.com", "[REDACTED_EMAIL]"),
        ("IFSC IDIB0001234", "[REDACTED_IFSC]"),
        ("UDYAM-MH-03-0091821", "[REDACTED_UDYAM]"),
        ("card 4111 1111 1111 1111", "[REDACTED_CARD]"),
    ],
)
def test_identifier_is_masked(text: str, token: str) -> None:
    out = sanitize_pii(text)
    assert token in out
    assert not any(ch.isdigit() for ch in out.replace(token, "")), out


def test_credit_narrative_is_untouched() -> None:
    note = "stock down 22% since March, 3 cheque returns, Rs 25,00,000 limit"
    assert sanitize_pii(note) == note
