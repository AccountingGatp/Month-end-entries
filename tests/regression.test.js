/* node tests/regression.test.js <gyg_dir> <groupon_dir> <airbnb.csv> <depreciation.xlsx> [gyg_pdf_text_dir]
   Rebuilds journals from the raw reports and compares line by line with the journals the team actually posted. */
const fs = require("fs"), path = require("path");
globalThis.ME = {}; globalThis.XLSX = require("../js/vendor/xlsx.full.min.js");
for (const f of ["config", "util", "journal", "engine/io", "engine/gyg", "engine/channels", "engine/books", "engine/accruals"]) require("../js/" + f + ".js");
const posted = require("./data/posted_journals.json"); const S = JSON.parse(JSON.stringify(ME.DEFAULTS)); const U = ME.U;
// FX is fetched live in the app; here the rates the team posted for August are fed in so the journal can be compared exactly
S.fx = { "2026-08": { EUR: 1.1593, GBP: 1.3541 }, "2026-09": { EUR: 1.1512, GBP: 1.3416 } };
const [gygDir, grpDir, abnb, dep, pdfDir] = process.argv.slice(2);
let fail = 0;
const ok = (c, m) => { console.log((c ? "PASS " : "FAIL ") + m); if (!c) fail++; };
const walk = (d, re) => fs.readdirSync(d, { recursive: true }).filter((f) => re.test(f)).map((f) => path.join(d, f));
const same = (j, key, label) => {
  const e = posted[key], g = j.lines.map((l) => ({ account: l.account, debit: l.debit, credit: l.credit, description: l.description, name: l.name, cls: l.cls }));
  const eq = JSON.stringify(e) === JSON.stringify(g); ok(eq, label);
  if (!eq) for (let i = 0; i < Math.max(e.length, g.length); i++) if (JSON.stringify(e[i]) !== JSON.stringify(g[i])) console.log("   posted:", JSON.stringify(e[i]), "\n   built :", JSON.stringify(g[i]));
};
const rd = (f) => { const b = fs.readFileSync(f); return { name: path.basename(f), hash: ME.io.hashOf(b), rows: ME.io.readWorkbook(b)[0].rows, sheets: ME.io.readWorkbook(b) }; };

// GYG August (uses the rate the team posted: 1.1593 / 1.3541)
const inv = walk(gygDir, /\.xlsx$/i).map(rd);
same(ME.buildGyg("2026-08", inv, {}, S), "gyg", "GYG August 2026 equals posted journal");
const sep = ME.buildGyg("2026-09", inv, {}, S);
console.log("     GYG Sep (no PDFs): debits", U.fmt(sep.debits), "status", sep.status, "errors", sep.errors);
// Groupon September
same(ME.buildGroupon("2026-09", walk(grpDir, /PAYMENT_DETAILS.*\.xlsx$/i).map(rd), S), "groupon", "Groupon September 2026 equals posted journal");
// Airbnb September
same(ME.buildAirbnb("2026-09", fs.readFileSync(abnb, "utf8"), S), "airbnb", "Airbnb September 2026 equals posted journal");
// Depreciation
same(ME.buildDepreciation("2026-09", rd(dep).sheets, S), "dep", "Depreciation equals posted journal");
// Jonathan August: 100,000 x 15% x 31/365
const jo = ME.buildJonathan("2026-08", 10000000, [], S);
ok(jo.lines[0].debit === 127397, "Jonathan Aug interest = 1,273.97 (posted)");
// Jonathan workbook example: Feb 2026 = 3,575.34 (segments with advances)
const feb = ME.calcJonathan("2026-02", 0, [{ date: "2026-02-02", delta: 25000000 }, { date: "2026-02-20", delta: 10000000 }, { date: "2026-02-26", delta: 35000000 }], 15, 365);
ok(feb.interest === 357534, "Jonathan Feb interest with 3 advances = 3,575.34 (workbook)");
const apr = ME.calcJonathan("2026-04", 65000000, [{ date: "2026-04-08", delta: -5000000 }, { date: "2026-04-21", delta: -5000000 }, { date: "2026-04-28", delta: -5000000 }], 15, 365);
ok(apr.interest === 727397, "Jonathan Apr interest with repayments = 7,273.97 (workbook)");
// CFL SOP worked example: base 341,250.00 -> gross 262,762.50, ad 39,988.53, net 222,773.97
const k = ME.cfl.calc(36561200, 9, 32); ok(k.gross === 28152124 && k.fee === 3290508 && k.cpp === 11699584, "CFL Sep 16-30 SOP example: base 365,612.00 -> fee 32,905.08, CPP 116,995.84, gross 281,521.24");
const cj = ME.buildCflEstimate("2026-09", { base: 36561200, ad: 3998853 }, S);
ok(cj.lines[2].credit === 24153271 && cj.debits === cj.credits && cj.lines[2].description === "Sep 2026 CFL Accrual - due to CFL", "CFL net accrual = 241,532.71, journal balances, SOP descriptions");
ok(ME.cfl.validate(100000, 100080).level === "ok" && ME.cfl.validate(100000, 104900).level === "ok" && ME.cfl.validate(100000, 120000).level === "stop" && ME.cfl.validate(1, 0).level === "missing", "CFL Step 5: within 5% post, over 5% stop");
const sc0 = { rows: 1000, pax: 2500, paxFound: true };
ok(ME.cfl.sizeCheck(sc0, null, S.cfl).level === "light" && ME.cfl.sizeCheck({ rows: 2400, pax: 6300, paxFound: true }, null, S.cfl).level === "ok" && ME.cfl.sizeCheck({ rows: 2000, pax: 5000, paxFound: true }, { rows: 2200, pax: 5800 }, S.cfl).level === "ok", "CFL Step 2 size check vs SOP figures / last month");
const cq = ME.buildCflEstimate("2026-09", { base: 36561200, ad: 3998853 }, S); ok(ME.toQboCsv([cq], true).includes('"CHICAGO FROM THE LAKE, LTD_CFL"') && cq.lines.length === 3, "CFL CSV: vendor name quoted, three lines");
// the posted CFL journal implies base ~ 397,906
const kp = ME.cfl.calc(Math.round(30638743 / 0.77), 9, 32); console.log("     posted CFL gross 306,387.43 implies base", U.fmt(Math.round(30638743 / 0.77)), "(new SOP: Sep 16-30 gross 281,521.24, base 365,612.00)");
// CFL actual: reverse estimate and book actual balances
const ca = ME.buildCflActual("2026-08", { total: 27324400, ad: 3998853, priorGross: 24717500 + 3998853, priorAd: 3998853 }, S);
ok(ca.debits === ca.credits, "CFL actual journal balances (reverse estimate + book actual)");
// SIA: level-payment interest and reversal pair
const [sa, sr] = ME.buildSia("2026-09", ME.sia.fromBalance(5000000, 5.5), S);
ok(sa.lines[0].debit === 22917 && sr.lines[0].credit === 22917 && sr.date === "2026-10-01", "SIA accrual 50,000 x 5.5%/12 = 229.17 and reversal dated 1 Oct");
// Shoreline
const sh = ME.buildShoreline("2026-09", 10000000, S); ok(sh.lines[0].debit === 7000000 && sh.debits === sh.credits, "Shoreline = 70% of non-90-minute revenue");
// Viator
const V = JSON.parse(JSON.stringify(S)); V.accounts.viatorFee = "40002.x Viator"; V.accounts.viatorPriceDiff = "40002.y Viator diff";
const vj = ME.buildViator("2026-09", [{ cls: "NYC", gross: 100000, net: 70000, diff: 500 }], V); ok(vj.debits === vj.credits && vj.debits === 30500, "Viator commission 300.00 + price difference 5.00 balances");
ok(ME.buildViator("2026-09", [{ cls: "NYC", gross: 100000, net: 70000 }], S).status === "blocked", "Viator blocked until the commission account is set");
ok(ME.viatorBalanceCheck(-5, 1000).level === "stop" && ME.viatorBalanceCheck(0, 1000).level === "ok" && ME.viatorBalanceCheck(2500, 1000).level === "stop", "Viator clearing balance bands");
// QBO import CSV: date only on first line of each journal, sequential numbers
const csv = ME.toQboCsv([jo, sh], true).split("\r\n"); ok(csv[1].split(",")[0] === "1" && csv[1].includes("2026-08-31") && csv[3].startsWith("2,") , "QBO CSV numbering and date on first line");
// PDF text parse (London invoice)
if (pdfDir) { const t = fs.readFileSync(path.join(pdfDir, "london.txt"), "utf8"); const p = ME.io.parsePdfText(t); ok(p.account === "320550" && p.commission === 1172224 && p.bookings === 2980487, "PDF parse: account 320550, bookings 29,804.87, commission 11,722.24"); }
// CFL scan on a synthetic Xola export (column order shuffled, junk rows above the header, serial dates)
{
  const ser = (d) => Math.round(Date.UTC(...d.split("-").map((x, i) => (i === 1 ? x - 1 : +x))) / 86400000 + 25569);
  const hdr = ["Order #", "Source", "Status", "Product", "Arrival Date", "Purchase Type", "Type", "Base Amount"];
  const R = (src, st, prod, d, pt, ty, b) => ["X", src, st, prod, ser(d), pt, ty, b];
  const P1 = "90-Minute Original Chicago River Boat Architecture Cruise", P2 = "75-Minute River Boat Architecture Tour";
  const rows = [["Export", null], [], hdr,
    R("Direct", "Confirmed", P1, "2026-09-20", "Purchase", "Order", 1000.5), R("Viator", "Confirmed", P2, "2026-09-30", "Purchase", "Order", 500),
    R("Get Your Guide", "Confirmed", P1, "2026-09-21", "Purchase", "Order", 999), R("Direct", "Cancelled", P1, "2026-09-22", "Purchase", "Order", 888),
    R("Direct", "Confirmed", P1, "2026-09-23", "Waitlist", "Order", 777), R("Direct", "Confirmed", "45-Minute Skyline Lake Tour", "2026-09-24", "Purchase", "Order", 666), R("Direct", "Confirmed", "90-Minute Cocktail Cruise and Architecture Tour", "2026-09-26", "Purchase", "Order", 200), R("Direct", "Confirmed", "Chicago River boat Architecture Tour", "2026-09-27", "Purchase", "Order", 100),
    R("Direct", "Confirmed", "Brand New Boat Tour", "2026-09-25", "Purchase", "Order", 300), R("Direct", "Confirmed", P1, "2026-10-02", "Purchase", "Order", 555),
    R("Direct", "Confirmed", P1, "2026-09-10", "Purchase", "Order", 400)];
  const sc = ME.cfl.scan([{ name: "Reservations", rows }], "2026-09-16", "2026-09-30", S.cfl);
  ok(sc.base === 130050, "CFL scan: confirmed, direct, non-waitlist; all 90-minute tours incl. cocktail and old name/spelling; 75 and 45-minute excluded = 1,300.50 (got " + U.fmt(sc.base) + ")");
  ok(Object.keys(sc.unknown).join() === "Brand New Boat Tour" && sc.maxArrival === "2026-10-02", "CFL scan: unknown product flagged for a decision; arrival range reported");
  const f1 = ME.cfl.scan([{ name: "Reservations", rows }], "2026-09-01", "2026-09-15", S.cfl); ok(f1.base === 40000, "CFL scan: 1st-15th window = 400.00");
  ok(!!ME.cfl.scan([{ name: "x", rows: [["a"], ["b"]] }], "2026-09-16", "2026-09-30", S.cfl).error, "CFL scan: missing 'Base Amount' header reported, not guessed");
}
console.log(fail ? `\n${fail} FAILED` : "\nALL PASSED"); process.exit(fail ? 1 : 0);
