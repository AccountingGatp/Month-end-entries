# Empire Tours month-end automation (static site)

Drop all of the month's files in one place, press **Process month-end**, download the QBO import files.

## Flow
1. Pick the closing month (top right).
2. Drop every report at once (xlsx, csv, pdf or a .zip). Each file is recognised automatically: GYG invoices and PDFs, Groupon, Airbnb, depreciation tracker, Xola export, SIA workbook, Ventrata, Viator.
3. Type the few numbers that only exist in emails/QBO (Jonathan balance, ad spend, Connor's figure, SIA balance).
4. **Process**. Live ECB exchange rates are fetched from Frankfurter, classes are detected from product names, accounts and saved choices, every SOP journal is built and checked (balance, allowed classes, 30% variance).
5. Review, then download the zip (.xlsx per journal, QBO CSV per SOP section 4, close report). Import into QBO by hand; nothing is ever posted.

## Notes
- Exchange rates are never stored; if the service is unreachable the last fetched rates for that month are used (labelled Cached) or you can type them.
- Everything runs in the browser; files never leave it. Settings and remembered classes live in localStorage.
- Open SOP items (Viator accounts, SIA accounts, 80000 amortization source, CFL base discrepancy) are listed on the Checklist tab.
- Deploy: Vercel (connected to GitHub) (vercel.json, no build). Local: `python3 -m http.server`.
- Tests: `node tests/regression.test.js <gyg_dir> <groupon_dir> <airbnb.csv> <dep.xlsx> [pdf_text_dir]`.
