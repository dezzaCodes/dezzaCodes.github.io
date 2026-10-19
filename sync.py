"""Refresh the inventory pages from their Google Sheet, one tab per page (see TABS).

Usage: SHEET_ID=... python3 sync.py [out_dir]
Replaces the contents of <script type="application/json" id="sheet-data"> in each page,
rewrites its thumbnails file and writes a high-resolution copy of each photo to photos/. Exits non-zero without writing anything if the sheet is not readable.
The sheet ID comes from the environment so it never appears in this public repository.
"""
import base64, csv, datetime, hashlib, io, json, os, re, sys, urllib.request
import html as html_lib
from concurrent.futures import ThreadPoolExecutor
from html.parser import HTMLParser

SHEET = "https://docs.google.com/spreadsheets/d/" + os.environ["SHEET_ID"]
IMG_WIDTH, WEBP_QUALITY = 360, 70          # thumbnails, inlined in images.json
PHOTO_MAX, PHOTO_QUALITY = 2400, 90        # detail photos: longest side in pixels, one file each in photos/
PHOTO_DIR = "photos"


def get(url):
    req = urllib.request.Request(url, headers={"User-Agent": "Mozilla/5.0"})
    with urllib.request.urlopen(req, timeout=60) as r:
        return r.read(), r.headers.get("Content-Type", "")


class SheetImages(HTMLParser):
    """Collects {sheet row number: first image URL in that row} from the htmlview table."""
    def __init__(self):
        super().__init__()
        self.images, self.row, self.cell, self.rownum = {}, False, -1, None

    def handle_starttag(self, tag, attrs):
        a = dict(attrs)
        if tag == "tr":
            self.row, self.cell, self.rownum = True, -1, None
        elif tag in ("td", "th") and self.row:
            self.cell += 1
        elif tag == "img" and self.rownum and self.cell > 0 and "sheets-images-rt" in a.get("src", ""):
            self.images.setdefault(self.rownum, a["src"])

    def handle_data(self, data):
        if self.row and self.cell == 0 and data.strip().isdigit() and self.rownum is None:
            self.rownum = int(data.strip())


def webp_bytes(im, quality):
    out = io.BytesIO()
    im.save(out, "WEBP", quality=quality, method=6)
    return out.getvalue()


def photo(url, out_dir):
    """Downloads the original image once and returns (thumbnail data URI, {src, w, h} of the high-resolution file, original size).
    The high-resolution file is named by a hash of the original, so an unchanged photo is not re-encoded."""
    from PIL import Image, ImageOps  # imported here so the sheet-reading helpers work without Pillow
    base = re.sub(r"=[^=/]*$", "", url)
    try:
        raw, _ = get(base + "=s0")  # =s0 asks Google for the original size
    except Exception:
        raw, _ = get(base + "=w4000")
    im = ImageOps.exif_transpose(Image.open(io.BytesIO(raw))).convert("RGB")
    name = f"{PHOTO_DIR}/{hashlib.sha1(raw).hexdigest()[:16]}.webp"
    path = os.path.join(out_dir, name)
    big = im.copy()
    big.thumbnail((PHOTO_MAX, PHOTO_MAX), Image.LANCZOS)
    if not os.path.exists(path):
        open(path, "wb").write(webp_bytes(big, PHOTO_QUALITY))
    small = im.resize((IMG_WIDTH, round(im.height * IMG_WIDTH / im.width)), Image.LANCZOS) if im.width > IMG_WIDTH else im
    return "data:image/webp;base64," + base64.b64encode(webp_bytes(small, WEBP_QUALITY)).decode(), {"src": name, "w": big.width, "h": big.height}, im.size


# Each sheet tab feeds one page: (tab gid, page, thumbnails file), relative to the site root. The gid stays the same when a tab is renamed.
TABS = [
    ("0", "flower-inventory/index.html", "flower-inventory/images.json"),          # flowers
    ("1990863409", "juju-inventory/index.html", "juju-inventory/images.json"),     # jujus
]


def read_tab(gid, out_dir):
    """Returns (columns, [(sheet row, cells)], thumbnails, photos, original sizes) for one tab."""
    raw, ctype = get(SHEET + f"/export?format=csv&gid={gid}")
    text = raw.decode("utf-8")
    if "csv" not in ctype or text.lstrip().startswith("<"):
        sys.exit(f"Tab {gid} did not return CSV (sheet no longer shared by link, or tab deleted). Nothing published.")
    allrows = list(csv.reader(io.StringIO(text)))
    cols = allrows[0]
    # CSV row index i corresponds to sheet row i + 1; keep that link while dropping blank rows.
    kept = [(i + 1, r) for i, r in enumerate(allrows[1:], start=1) if any(c.strip() for c in r)]
    if not kept:
        sys.exit(f"Tab {gid} has no data rows. Nothing published.")

    html_view, _ = get(SHEET + f"/htmlview/sheet?headers=true&gid={gid}")
    parser = SheetImages()
    parser.feed(html_view.decode("utf-8", "replace"))

    jobs = {k: parser.images[sheet_row] for k, (sheet_row, _) in enumerate(kept) if sheet_row in parser.images}
    images, photos, sizes = {}, {}, []
    with ThreadPoolExecutor(8) as pool:
        for k, res in zip(jobs, pool.map(lambda u: _safe(photo, u, out_dir), jobs.values())):
            if res:
                images[str(k)], photos[str(k)], size = res
                sizes.append(size)
    return cols, kept, images, photos, sizes


def main(out_dir="."):
    os.makedirs(os.path.join(out_dir, PHOTO_DIR), exist_ok=True)
    title = sheet_title()
    tabs = [(page, thumbs, *read_tab(gid, out_dir)) for gid, page, thumbs in TABS]

    # Drop high-resolution files no longer used by any row of any tab.
    keep = {os.path.basename(p["src"]) for *_, photos, _ in tabs for p in photos.values()}
    for f in os.listdir(os.path.join(out_dir, PHOTO_DIR)):
        if f not in keep:
            os.remove(os.path.join(out_dir, PHOTO_DIR, f))

    synced = datetime.datetime.now(datetime.timezone.utc).isoformat(timespec="seconds")
    pattern = r'(<script type="application/json" id="sheet-data">)(.*?)(</script>)'
    pages = {}
    for page, thumbs, cols, kept, images, photos, sizes in tabs:
        data = {
            "synced": synced,
            "columns": cols,
            "rows": [r + [""] * (len(cols) - len(r)) for _, r in kept],
            "images": len(images),
            "photos": photos,
            "sheet": SHEET + "/edit?usp=sharing",
            "sheetTitle": title,
        }
        blob = json.dumps(data, ensure_ascii=False).replace("<", "\\u003c")
        html = open(page, encoding="utf-8").read()
        if not re.search(pattern, html, re.S):
            sys.exit(f"{page} has no sheet-data block. Nothing published.")
        pages[page] = re.sub(pattern, lambda m: m.group(1) + blob + m.group(3), html, count=1, flags=re.S)

    for page, thumbs, cols, kept, images, photos, sizes in tabs:
        open(os.path.join(out_dir, page), "w", encoding="utf-8").write(pages[page])
        json.dump(images, open(os.path.join(out_dir, thumbs), "w"), separators=(",", ":"))
        print(f"{page}: {len(cols)} columns, {len(kept)} rows, {len(images)} images "
              f"({os.path.getsize(os.path.join(out_dir, thumbs)) // 1024} KB thumbnails)")
        if sizes:
            widths = sorted(w for w, _ in sizes)
            print(f"  originals {widths[0]}-{widths[-1]}px wide (median {widths[len(widths) // 2]})")
    print(f"photos/ {sum(os.path.getsize(os.path.join(out_dir, PHOTO_DIR, f)) for f in keep) // 1024} KB")


def sheet_title():
    """The spreadsheet's name, or "" if Google doesn't say."""
    try:
        page, _ = get(SHEET + "/htmlview")
        m = re.search(r'property="og:title" content="([^"]*)"', page.decode("utf-8", "replace"))
        return html_lib.unescape(m.group(1)).strip() if m else ""
    except Exception:
        return ""


def _safe(fn, arg, *rest):
    try:
        return fn(arg, *rest)
    except Exception as e:
        print("image failed:", arg[:80], e, file=sys.stderr)
        return None


if __name__ == "__main__":
    main(*sys.argv[1:2])
