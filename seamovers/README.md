# seamovers.net rebuild

Static rebuild of seamovers.net from the Wayback Machine snapshot of 2024-12-08.

## Layout

- `original/` - pages saved from the archive by hand (reference only)
- `apps-script/Code.gs` - Google Apps Script backend that reads and writes a Google Sheet
- site files (`index.html`, `css/`, `js/`, `images/`) - to be built from `original/`

## Connecting the Google Sheet

1. Create a Google Sheet. Put column headers in row 1 and copy the sheet ID from its URL.
2. In the sheet: Extensions > Apps Script. Paste `apps-script/Code.gs` and set `SHEET_ID`.
3. Deploy > New deployment > Web app. Execute as: Me. Who has access: Anyone.
4. Copy the web app URL into the site's JavaScript.

## Saving the original pages

1. Open `https://web.archive.org/web/20241208110212/https://seamovers.net/` in your browser.
2. Ctrl+S (Cmd+S on Mac) and choose "Webpage, Complete". Save into `seamovers/original/`.
3. Repeat for each other page on the site (open the menu links from the archived page).
