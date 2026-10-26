// Google Apps Script backend for seamovers.net
// Deploy as a web app: Deploy > New deployment > Web app
//   Execute as: Me
//   Who has access: Anyone

// ID of the Google Sheet (the long string in the sheet's URL between /d/ and /edit)
const SHEET_ID = 'PASTE_SHEET_ID_HERE';
const SHEET_NAME = 'Sheet1';

function getSheet() {
  return SpreadsheetApp.openById(SHEET_ID).getSheetByName(SHEET_NAME);
}

function jsonResponse(data) {
  return ContentService
    .createTextOutput(JSON.stringify(data))
    .setMimeType(ContentService.MimeType.JSON);
}

// Read rows from the sheet, e.g. GET <web app URL>
function doGet(e) {
  const values = getSheet().getDataRange().getValues();
  const headers = values.shift();
  const rows = values.map(row => {
    const item = {};
    headers.forEach((header, i) => item[header] = row[i]);
    return item;
  });
  return jsonResponse({ ok: true, rows: rows });
}

// Append a row to the sheet, e.g. POST with a JSON body
// The static site sends Content-Type text/plain to avoid CORS preflight
function doPost(e) {
  try {
    const data = JSON.parse(e.postData.contents);
    const sheet = getSheet();
    sheet.appendRow([new Date(), ...Object.values(data)]);
    return jsonResponse({ ok: true });
  } catch (err) {
    return jsonResponse({ ok: false, error: String(err) });
  }
}
