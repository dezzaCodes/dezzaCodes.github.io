"""Fill empty Colour cells in the sheet's flowers tab by asking Claude what colour each row's photo shows.

Usage: SHEET_ID=... ANTHROPIC_API_KEY=... GOOGLE_SERVICE_ACCOUNT='{...json key...}' python3 fill_colours.py [--dry-run]
Runs before sync.py in the daily workflow. Only rows that have a photo and an empty Colour cell are sent to
Claude, and only those empty cells are written. GOOGLE_SERVICE_ACCOUNT is a service account's JSON key; the
sheet must be shared with that account's email as an Editor. Without the credentials it does nothing.
--dry-run prints what it would write without writing.
"""
import base64, io, json, os, re, sys
from urllib.parse import quote

import anthropic
from google.auth.transport.requests import AuthorizedSession
from google.oauth2 import service_account
from PIL import Image, ImageOps

import sync

GID = 0  # the flowers tab
# The colour names the site has swatches for (see SWATCHES in shared/inventory.js).
COLOURS = ["Red", "Pink", "Orange", "Yellow", "Green", "Blue", "Purple", "White", "Cream", "Brown", "Black", "Grey", "Multicolour"]
MAX_PER_RUN = 25  # a cap so a run can't send hundreds of photos if the column is ever cleared
MODEL = "claude-opus-5-5"
API = "https://sheets.googleapis.com/v4/spreadsheets/" + os.environ.get("SHEET_ID", "")

PROMPT = """This photo shows a handmade plush flower from an art installation: "{flower}"{desc}.
The photo may also show other flowers behind it, a hand, a stem and leaves, text, or a phone's status bar. Ignore all of those.

Which of these colour names best describe the colour of this flower's head or petals (not its stem or leaves)?
{colours}

Give one colour, or two if the flower is clearly two-toned (e.g. petals one colour with a distinctly different centre or edging that a person would mention).
Use Multicolour only when there are three or more prominent colours. Peach and salmon shades count as Pink; lavender and violet count as Purple."""

SCHEMA = {
    "type": "object",
    "properties": {"colours": {"type": "array", "items": {"type": "string", "enum": COLOURS}}},
    "required": ["colours"],
    "additionalProperties": False,
}


def column_letter(i):
    s = ""
    i += 1
    while i:
        i, r = divmod(i - 1, 26)
        s = chr(65 + r) + s
    return s


def photo_jpeg(url):
    """The row's photo, 1024px wide, as base64 JPEG."""
    raw, _ = sync.get(re.sub(r"=[^=/]*$", "", url) + "=w1024")
    im = ImageOps.exif_transpose(Image.open(io.BytesIO(raw))).convert("RGB")
    out = io.BytesIO()
    im.save(out, "JPEG", quality=90)
    return base64.standard_b64encode(out.getvalue()).decode()


def ask_claude(client, url, flower, desc):
    response = client.beta.messages.create(
        model=MODEL,
        max_tokens=16000,
        # If a safety check declines the request, the API retries it on a fallback model in the same call.
        betas=["server-side-fallback-2026-07-01"],
        fallbacks="default",
        output_config={"format": {"type": "json_schema", "schema": SCHEMA}},
        messages=[{"role": "user", "content": [
            {"type": "image", "source": {"type": "base64", "media_type": "image/jpeg", "data": photo_jpeg(url)}},
            {"type": "text", "text": PROMPT.format(
                flower=flower, desc=f', described as "{desc}"' if desc else "", colours=", ".join(COLOURS))},
        ]}],
    )
    if response.stop_reason != "end_turn":
        raise RuntimeError(f"stopped with {response.stop_reason}")
    text = next(b.text for b in response.content if b.type == "text")
    colours = [c for c in json.loads(text)["colours"] if c in COLOURS]
    if not colours:
        raise RuntimeError("no colour in the answer")
    return list(dict.fromkeys(colours))[:2]


def main(dry_run=False):
    key = os.environ.get("GOOGLE_SERVICE_ACCOUNT", "").strip()
    if not key or not os.environ.get("ANTHROPIC_API_KEY"):
        print("GOOGLE_SERVICE_ACCOUNT or ANTHROPIC_API_KEY not set; not filling colours.")
        return
    creds = service_account.Credentials.from_service_account_info(
        json.loads(key), scopes=["https://www.googleapis.com/auth/spreadsheets"])
    sheets = AuthorizedSession(creds)

    # Read the tab through the Sheets API (by gid, so renaming the tab is fine).
    meta = sheets.get(API, params={"fields": "sheets.properties(sheetId,title)"})
    meta.raise_for_status()
    title = next(s["properties"]["title"] for s in meta.json()["sheets"] if s["properties"]["sheetId"] == GID)
    tab = "'" + title.replace("'", "''") + "'"
    values = sheets.get(f"{API}/values/{quote(tab)}")
    values.raise_for_status()
    rows = values.json().get("values", [])
    header = [h.strip().lower() for h in rows[0]]
    cell = lambda r, name: r[header.index(name)].strip() if name in header and header.index(name) < len(r) else ""
    if "colour" not in header:
        sys.exit("The flowers tab has no 'colour' column.")
    colour_col = column_letter(header.index("colour"))

    # Sheet row numbers (header is row 1) of non-blank rows with no colour.
    empty = [n for n, r in enumerate(rows[1:], start=2) if any(c.strip() for c in r) and not cell(r, "colour")]
    if not empty:
        print("No empty colours.")
        return
    html_view, _ = sync.get(sync.SHEET + f"/htmlview/sheet?headers=true&gid={GID}")
    parser = sync.SheetImages()
    parser.feed(html_view.decode("utf-8", "replace"))

    client = anthropic.Anthropic()
    updates = []
    for n in empty[:MAX_PER_RUN]:
        r = rows[n - 1]
        flower, desc = cell(r, "flower") or "a flower", " / ".join(cell(r, "description").split("\n"))
        if n not in parser.images:
            print(f"row {n} ({flower}): no photo, left empty")
            continue
        try:
            colours = ask_claude(client, parser.images[n], flower, desc)
        except Exception as e:
            print(f"row {n} ({flower}): skipped, {e}", file=sys.stderr)
            continue
        print(f"row {n} ({flower}, {desc or 'no description'}): {', '.join(colours)}")
        updates.append({"range": f"{tab}!{colour_col}{n}", "values": [[", ".join(colours)]]})
    if len(empty) > MAX_PER_RUN:
        print(f"{len(empty) - MAX_PER_RUN} more empty colours left for the next run.")

    if updates and not dry_run:
        res = sheets.post(f"{API}/values:batchUpdate", json={"valueInputOption": "RAW", "data": updates})
        res.raise_for_status()
        print(f"Wrote {len(updates)} colour(s) to the sheet.")


if __name__ == "__main__":
    main(dry_run="--dry-run" in sys.argv[1:])
