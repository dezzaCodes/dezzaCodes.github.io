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
- `sync.py` rebuilds the pages' data, thumbnails and photos from the Google Sheet; its `TABS` list maps each tab (by gid, which survives renaming) to a page. It reads the sheet ID from the `SHEET_ID` environment variable.
- `fill_colours.py` runs before each sync: for flowers with a photo but an empty Colour cell, it asks Claude (`claude-opus-5-5`) which of the site's colour names fit the photo and writes the answer into the sheet. It needs the repository secrets `ANTHROPIC_API_KEY` and `GOOGLE_SERVICE_ACCOUNT` (a Google service account's JSON key; the sheet is shared with that account's email as an Editor), and does nothing without them.
- `.github/workflows/sync.yml` runs `sync.py` every day at 5am Sydney time (it's scheduled at both 18:00 and 19:00 UTC and skips whichever isn't 5am in Sydney that day, so daylight saving doesn't move it) and commits any changes, which republishes the site through GitHub Pages. Run it by hand from the **Actions** tab with **Run workflow**.

The sheet must stay shared as "Anyone with the link can view", and the sheet ID is stored as the repository secret `SHEET_ID`.

`flower-inventory/jujus.html` and `flower-inventory/money.html` redirect the pages' old addresses.
