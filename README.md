# Month-End Desk

Prepares Empire Tours' recurring month-end journals from the raw reports, following the *Month-End Entries SOP*.
It is a static site: **everything runs in the browser tab**. No file is uploaded anywhere and nothing is posted to QuickBooks.
You download each journal and import it into QBO by hand, as the SOP requires.

## Entries

| SOP | Entry | Input |
|---|---|---|
| 3.1 | GetYourGuide | `GIS-*.xlsx` invoices (+ PDFs, or a .zip) |
| 3.1 | Groupon | `PAYMENT_DETAILS*.xlsx` exports |
| 3.1 | Airbnb | Transaction History `.csv` |
| 3.1 | Viator | typed or pasted rows (accounts still open) |
| 3.2 | Jonathan loan interest | balance + movements from QBO 23021 |
| 3.3 | 23014 SIA interest | balance and rate, amount, or the amortization workbook. Makes the accrual and its reversal |
| 3.4 | Depreciation | Garcia tracker `.xlsx` |
| 3.5 | CFL accrual (estimate, and actual with reversal) | Xola Events Export `.xlsx`, ad spend, Connor's figures |
| 3.5 | Shoreline accrual | Ventrata detail report or typed revenue |
| open | Amortization (80000) | typed amount, once the source is known |

Outputs: the posted layout (`ACCOUNT, DEBITS, CREDITS, DESCRIPTION, NAME, LOCATION, CLASS`) per journal as `.xlsx`, and a QBO
journal-import `.csv` (SOP section 4: sequential JournalNo, date on the first line of each journal).
Every journal is marked **OK / Review / Blocked**. A blocked journal cannot be downloaded.

## Deploy

**GitHub Pages:** push to `main`. Settings > Pages > Source: *GitHub Actions*. The included workflow publishes the site.

**Vercel:** import the repo. Framework preset *Other*, no build command, output directory `.`. `vercel.json` adds security headers.

**Locally:** `npm start`, then open http://localhost:8080 (or just open `index.html`).

All libraries (SheetJS, JSZip, pdf.js) are bundled in `js/vendor`, so the site makes no third-party requests. The only network call is the optional
*Fetch ECB monthly average* button, which asks `api.frankfurter.dev` for the month's rates.

## Tests

`tests/regression.test.js` rebuilds journals from the real reports and compares them line by line with the journals that were actually posted
(`tests/data/posted_journals.json`), and checks the SOP's worked examples (CFL 341,250.00 → 262,762.50 → 222,773.97; Jonathan workbook months).
Real reports are not in the repo. Point the test at them:

    GYG_DIR=... GROUPON_DIR=... AIRBNB_CSV=... DEP_XLSX=... npm test

## Settings and open items

Account names, class maps, rates and FX live in **Settings** (stored in the browser; export/import as JSON). Items the SOP leaves open (Viator accounts, SIA
accounts, the 80000 amortization, the 75-minute tour double count) are flagged on screen and some block the journal until set.
Do not commit real customer reports to the repo.
