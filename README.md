# Dezza's Pages

This repo is the site at **https://dezzacodes.github.io/**:

- https://dezzacodes.github.io/flower-inventory/
- https://dezzacodes.github.io/juju-inventory/
- https://dezzacodes.github.io/cj-money/

(`/gym/` and `/rewards/` come from their own repos.)

Sortable, filterable pages of every flower and juju in the inventory spreadsheet, with photos, plus a private money page.

- `index.html` is the links page at the site root.
- `flower-inventory/index.html` (the sheet's flowers tab) and `juju-inventory/index.html` (the jujus tab) are the inventory pages. Each holds its rows in a `sheet-data` JSON block and its settings (column order, chip and filter columns, wording) in `window.INVENTORY`.
- `shared/inventory.css` and `shared/inventory.js` are the shared look and behaviour of both inventory pages.
- Each inventory folder's `images.json` holds that page's table thumbnails, resized to 360px WebP.
- `cj-money/index.html` is the Money page: income, expenses and the profit or loss. Its figures are not in this public repository. They live in `ledger.json` in the private repo `dezzaCodes/flower-ledger`, which the page reads and writes through the GitHub API. Each device is connected once with a fine-grained token that has **Contents: Read and write** on that repo only, and the token stays in that browser.
- `photos/` holds a high-resolution copy of each photo (up to 2400px, WebP) for the detail panel, for both pages. Files are named by a hash of the original, so unchanged photos aren't re-encoded, and unused ones are deleted on sync.
- Each sync records the date every row first appeared (`added` in the page data, shown as the Added column), carrying dates over by matching rows to the previous sync, so filling in or editing a row keeps its date. Rows present at the first sync (3 Oct 2026) show that date. The flower page sorts by it, newest first.
- `sync.py` rebuilds the pages' data, thumbnails and photos from the Google Sheet; its `TABS` list maps each tab (by gid, which survives renaming) to a page. It reads the sheet ID from the `SHEET_ID` environment variable.
- `find-colours` (run `./find-colours` on a Mac with Claude Code signed in) suggests colours for flowers whose Colour cell is empty: Claude Code looks at each photo, the answers are printed, and a block is copied to the clipboard to paste into the Colour column. It reads the sheet ID from `SHEET_ID` or an untracked `.sheet_id` file, and never writes to the sheet.
- `.github/workflows/sync.yml` runs `sync.py` every day at 5am Sydney time (it's scheduled at both 18:00 and 19:00 UTC and skips whichever isn't 5am in Sydney that day, so daylight saving doesn't move it) and commits any changes, which republishes the site through GitHub Pages. Run it by hand from the **Actions** tab with **Run workflow**.

The sheet must stay shared as "Anyone with the link can view", and the sheet ID is stored as the repository secret `SHEET_ID`.

`flower-inventory/jujus.html` and `flower-inventory/money.html` redirect the pages' old addresses.
