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
from zoneinfo import ZoneInfo

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


def added_dates(old, cols, rows, today, old_photos=None, new_photos=None):
    """The date each row was first synced, carried over from the page's previous data (old).
    A row's photo is its key: a row whose photo (old_photos/new_photos: a photo key or None per row) was in
    the previous sync keeps that row's date. Rows left over (no photo, or a photo whose previous row is gone)
    fall back to matching text: an identical row, then the row at the same position if most of its cells are
    unchanged, then the most similar unmatched row anywhere. Rows that match nothing get today's date."""
    old_rows, old_dates = (old or {}).get("rows", []), (old or {}).get("added", [])
    if len(old_dates) != len(old_rows):
        old_dates = [None] * len(old_rows)

    def cells(cs, r):
        skip = {i for i, c in enumerate(cs) if c.strip().lower() == "image"}
        return tuple("" if i in skip else str(c).strip().lower() for i, c in enumerate(r))

    def similarity(a, b):
        """Share of the cells filled in either row that are equal in both."""
        pairs = [(x, y) for x, y in zip(a, b) if x or y] + [(x, "") for x in a[len(b):] if x] + [("", y) for y in b[len(a):] if y]
        return sum(x == y for x, y in pairs) / len(pairs) if pairs else 1.0

    old_keys = [cells(old.get("columns", []), r) for r in old_rows] if old else []
    new_keys = [cells(cols, r) for r in rows]
    used, dates = set(), [None] * len(rows)

    def take(i, j):
        used.add(j)
        dates[i] = old_dates[j]
    old_by_photo = {}  # several rows can share a photo
    for j, ph in enumerate(old_photos or []):
        if ph and j < len(old_keys):
            old_by_photo.setdefault(ph, []).append(j)
    for i, ph in enumerate(new_photos or []):  # same photo: the old row at the same position, else the first free one
        if ph and i < len(new_keys):
            free_rows = [j for j in old_by_photo.get(ph, []) if j not in used]
            if free_rows:
                take(i, i if i in free_rows else free_rows[0])
    # Rows left over are matched by text. A row with a photo that wasn't there before is new, so it can't take
    # an old row that had a photo, unless most photos changed at once (the photo files were re-encoded).
    has_photo = lambda photos, i: bool(photos and i < len(photos) and photos[i])
    with_photo = sum(has_photo(new_photos, i) for i in range(len(new_keys)))
    photos_changed = with_photo and sum(d is not None for d in dates) < with_photo / 2
    free = lambda i, j: j not in used and (photos_changed or not (has_photo(new_photos, i) and has_photo(old_photos, j)))
    for i, k in enumerate(new_keys):  # identical rows
        if dates[i] is None:
            j = next((j for j, o in enumerate(old_keys) if free(i, j) and o == k), None)
            if j is not None:
                take(i, j)
    for i, k in enumerate(new_keys):  # same position, mostly unchanged
        if dates[i] is None and i < len(old_keys) and free(i, i) and similarity(old_keys[i], k) >= 0.5:
            take(i, i)
    for i, k in enumerate(new_keys):  # most similar unmatched row elsewhere
        if dates[i] is None:
            best = max((j for j in range(len(old_keys)) if free(i, j)), key=lambda j: similarity(old_keys[j], k), default=None)
            if best is not None and similarity(old_keys[best], k) >= 0.6:
                take(i, best)
    return [d or today for d in dates]


def main(out_dir="."):
    os.makedirs(os.path.join(out_dir, PHOTO_DIR), exist_ok=True)
    title = sheet_title()
    tabs = [(page, thumbs, *read_tab(gid, out_dir)) for gid, page, thumbs in TABS]

    # Drop high-resolution files no longer used by any row of any tab.
    keep = {os.path.basename(p["src"]) for *_, photos, _ in tabs for p in photos.values()}
    for f in os.listdir(os.path.join(out_dir, PHOTO_DIR)):
        if f not in keep:
            os.remove(os.path.join(out_dir, PHOTO_DIR, f))

    now = datetime.datetime.now(datetime.timezone.utc)
    synced = now.isoformat(timespec="seconds")
    today = now.astimezone(ZoneInfo("Australia/Sydney")).date().isoformat()
    pattern = r'(<script type="application/json" id="sheet-data">)(.*?)(</script>)'
    pages = {}
    for page, thumbs, cols, kept, images, photos, sizes in tabs:
        html = open(page, encoding="utf-8").read()
        if not re.search(pattern, html, re.S):
            sys.exit(f"{page} has no sheet-data block. Nothing published.")
        try:
            old = json.loads(re.search(pattern, html, re.S).group(2))
        except ValueError:
            old = None
        rows = [r + [""] * (len(cols) - len(r)) for _, r in kept]
        # Each row's photo key: a hash of its thumbnail (thumbnails are made the same way every sync).
        photo_key = lambda uri: hashlib.md5(uri.encode()).hexdigest() if uri else None
        try:
            old_thumbs = json.load(open(thumbs))
        except (OSError, ValueError):
            old_thumbs = {}
        old_photos = [photo_key(old_thumbs.get(str(j))) for j in range(len((old or {}).get("rows", [])))]
        new_photos = [photo_key(images.get(str(i))) for i in range(len(rows))]
        data = {
            "synced": synced,
            "columns": cols,
            "rows": rows,
            # The Sydney date each row first appeared in a sync, by row.
            "added": added_dates(old, cols, rows, today, old_photos, new_photos),
            "images": len(images),
            "photos": photos,
            "sheet": SHEET + "/edit?usp=sharing",
            "sheetTitle": title,
        }
        blob = json.dumps(data, ensure_ascii=False).replace("<", "\\u003c")
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
