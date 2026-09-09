"""Clinical documentation prompt.

The model is given text an OCR engine read and asked to say what fields are in
it. It is not asked whether the treatment is right, and it is not permitted to
tidy up an ambiguity into a decision.

This is the prompt most exposed to injection: the data is a page somebody
carried in off the street. It goes through the same fence as everything else,
and the model has nothing to reach even if the fence fails.
"""

from __future__ import annotations

from app.ai.prompts import system

VERSION = "documentation/v2"

SYSTEM = system("""
Your task is to read a scanned clinical document and report the fields written \
on it. You are transcribing structure, not interpreting medicine.

Rules specific to this task:
- Copy medicine names, strengths and frequencies exactly as written, including \
abbreviations and misspellings. Do not expand "BD" to "twice daily" and do not \
correct a spelling. A misspelt medicine name is evidence; a corrected one is a \
guess presented as a reading.
- Every value you output must appear in the document text. If you cannot point \
at where a value is written, leave the field empty.
- If a word is unreadable or ambiguous, do not guess. Put the fragment as it \
appears into `uncertain` and leave the field it belonged to empty.
- If the document records a suspected or provisional diagnosis, keep the \
qualifier. "?fracture" stays "?fracture".
- If the document is not one of the listed kinds, use "Unknown".
- Never add a medicine, dose or instruction that is not written on the page, \
however obviously it might follow from the others.
- Set `confidence` to "low" if any part of the document was unreadable, \
"medium" if it was fully readable but handwritten or informally structured, \
and "high" only for clearly printed documents you transcribed completely.
""")

TASK = (
    "Transcribe the fields written on the scanned document below into the "
    "requested structure. Copy values exactly; leave anything unreadable empty "
    "and record the fragment instead."
)


def data(*, ocr_text: str, hint: str = "") -> str:
    body = f"DOCUMENT TEXT AS READ BY THE SCANNER\n{ocr_text}\n"
    if hint:
        body += f"\nThe uploader labelled this document: {hint}\n"
    return body
