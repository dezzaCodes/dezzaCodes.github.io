# Flower Inventory

**Live site: https://dezzacodes.github.io/flower-inventory/**

Sortable, filterable pages of every flower and juju in the inventory spreadsheet, with photos, plus a private money page.

- `index.html` (flowers, from the sheet's first tab) and `jujus.html` (the jujus tab) are the inventory pages. Each holds its rows in a `sheet-data` JSON block and its settings (column order, chip and filter columns, wording) in `window.INVENTORY`.
- `inventory.css` and `inventory.js` are the shared look and behaviour of both pages.
- `images.json` and `juju-images.json` hold each page's table thumbnails, resized to 360px WebP.
- `photos/` holds a high-resolution copy of each photo (up to 2400px, WebP) for the detail panel, for both pages. Files are named by a hash of the original, so unchanged photos aren't re-encoded, and unused ones are deleted on sync.
- `sync.py` rebuilds the pages' data, thumbnails and photos from the Google Sheet; its `TABS` list maps each tab (by gid, which survives renaming) to a page. It reads the sheet ID from the `SHEET_ID` environment variable.
- `.github/workflows/sync.yml` runs `sync.py` every day at 5am Sydney time (it's scheduled at both 18:00 and 19:00 UTC and skips whichever isn't 5am in Sydney that day, so daylight saving doesn't move it) and commits any changes, which republishes the site through GitHub Pages. Run it by hand from the **Actions** tab with **Run workflow**.

The sheet must stay shared as "Anyone with the link can view", and the sheet ID is stored as the repository secret `SHEET_ID`.
