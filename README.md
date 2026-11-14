# Dezza's Pages

This repo is the site at **https://dezzacodes.github.io/**:

- https://dezzacodes.github.io/flower-inventory/
- https://dezzacodes.github.io/juju-inventory/
- https://dezzacodes.github.io/cj-money/
- https://dezzacodes.github.io/murakami/
- https://dezzacodes.github.io/smiski/
- https://dezzacodes.github.io/eyes/

(`/gym/` and `/rewards/` come from their own repos.)

Sortable, filterable pages of every flower and juju in the inventory spreadsheet, with photos, plus a private money page.

- `index.html` is the links page at the site root.
- `flower-inventory/index.html` (the sheet's flowers tab) and `juju-inventory/index.html` (the jujus tab) are the inventory pages. Each holds its rows in a `sheet-data` JSON block and its settings (column order, chip and filter columns, wording) in `window.INVENTORY`.
- The Colour column can name any shade ("hot pink", "champagne", "sage green"). The site shows the shade but files it under one of the main colours (Red, Pink, Orange, Yellow, Green, Blue, Purple, White, Cream, Brown, Black, Grey, Multicolour, Iridescent) for the filter and the colour dot: a main colour named in the shade, else a known shade (`SHADES` in `shared/inventory.js`), and a main colour in brackets ("champagne (white)") overrides both.
- A `status` column (a dropdown, one value per row) works the same way when it says sold; any other status (e.g. ISO) shows as a label beside the name and is hidden until its own switch in the Status section (e.g. **ISO**) is on, which then shows only the items with that status. A `sold` column in either tab marks items as sold (anything typed in it, e.g. yes, a date or a ticked checkbox, except no/false/0). Sold items are left out of the table, the counts and the total until the **Sold** switch in the Status section at the top of the filter panel is turned on (it starts off on every visit), and then appear greyed out with a Sold label.
- `shared/inventory.css` and `shared/inventory.js` are the shared look and behaviour of both inventory pages.
- Each inventory folder's `images.json` holds that page's table thumbnails, resized to 360px WebP.
- `murakami/index.html` is a grid of square photos from the sheet's murakami tab, which holds only photos: the sync reads along each row from A1 to the first empty cell, then the next row, stopping at the first row with nothing in column A. Thumbnails are in `murakami/images.json`.
- `eyes/index.html` is a grid of photo tiles like murakami (each shows its from at the top and description at the bottom), with search and a Colour and From filter panel at the side like the other pages, from the sheet's eyes tab (headings in the top row: from, image, description; thumbnails in `eyes/images.json`).
- `cj-money/index.html` is the Money page: income, expenses and the profit or loss. Its figures are not in this public repository. They live in `ledger.json` in the private repo `dezzaCodes/flower-ledger`, which the page reads and writes through the GitHub API. Each device is connected once with a fine-grained token that has **Contents: Read and write** on that repo only, and the token stays in that browser.
- `photos/` holds a high-resolution copy of each photo (up to 2400px, WebP) for the detail panel, for both pages. Files are named by a hash of the original, so unchanged photos aren't re-encoded, and unused ones are deleted on sync.
- A date column in the sheet named `purchased` (or `purchase date`, `date bought`, `date added`…) sets each row's date, and the site's column takes that name (any common date format; day-first unless the dates say otherwise). Where it's blank, the site uses the date the sync first saw the row:
  each sync records the date every row first appeared (`added` in the page data, shown as the Added column), keyed by each row's photo: a row's date is the first sync its photo appeared in, so filling in, editing or moving a row keeps its date, and replacing a row's photo counts as adding it. Rows without a photo are matched by their text instead. Rows present at the first sync (3 Oct 2026) show that date. The flower page sorts by it, newest first.
- `sync.py` rebuilds the pages' data, thumbnails and photos from the Google Sheet; its `TABS` and `PHOTO_TABS` lists map each tab (by gid, which survives renaming) to a page. It reads the sheet ID from the `SHEET_ID` environment variable.
- `find-colours` (run `./find-colours` on a Mac with Claude Code signed in) suggests colours for flowers whose Colour cell is empty: Claude Code looks at each photo, the answers are printed, and a block is copied to the clipboard to paste into the Colour column. It reads the sheet ID from `SHEET_ID` or an untracked `.sheet_id` file, and never writes to the sheet.
- `.github/workflows/sync.yml` runs `sync.py` every morning. It's scheduled for 3:17am Sydney time because GitHub starts scheduled runs hours late, so it usually lands around 5–7am (it's set at both 16:17 and 17:17 UTC and skips whichever isn't 3:17am in Sydney that day, so daylight saving doesn't move it) and commits any changes, which republishes the site through GitHub Pages. Run it by hand from the **Actions** tab with **Run workflow**.

The sync publishes nothing (and the site keeps its last data) if a tab can't be read, if rows are hidden in the sheet by a filter (the sheet's web view, where the photos come from, leaves hidden rows out), or if more than a tenth of a tab's photos fail to download.

The sheet must stay shared as "Anyone with the link can view", and the sheet ID is stored as the repository secret `SHEET_ID`.

`flower-inventory/jujus.html` and `flower-inventory/money.html` redirect the pages' old addresses.

- Each eyes photo gets a colour from its leather petals: the sync measures a ring between the button and the petal tips and names it after the nearest reference in `PETAL_COLOURS` (sync.py), filed under Red, Orange, Yellow, Green, Blue, Purple, Pink, White, Black, Brown or Grey. A colour typed in the eyes tab's colour column replaces the measured one.
