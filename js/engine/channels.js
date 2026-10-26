(function (g) {
  const ME = (g.ME = g.ME || {}); const U = ME.U;
  const norm = ME.normName = (s) => String(s || "").toLowerCase().replace(/[^a-z0-9 ]+/g, " ").replace(/\s+/g, " ").trim();

  /* ---------------- Groupon ---------------- */
  /* files: [{name, rows}]  (PAYMENT_DETAILS exports, any number, any layout order) */
  ME.buildGroupon = function (month, files, settings) {
    const [y, mo] = month.split("-");
    const j = new ME.Journal("groupon", "Groupon commission", `GRP-${y}${mo}`, U.lastDate(month));
    const A = settings.accounts, label = U.monthLabel(month);
    const seen = new Set(), guessed = new Set(); let dup = 0, voided = 0, shifted = 0; const byClass = {}, bad = new Set(); let used = 0;
    for (const f of files) {
      const hdr = f.rows[0] || [];
      if (hdr.length < 5 || f.rows.length < 2) { j.notes.push(`Skipped empty export ${f.name}.`); continue; }
      const ix = U.indexHeaders(hdr);
      const c = ["date processed", "payable name", "payment status", "payment type", "sell price (pre-tax)", "payment", "groupon number", "voucher id", "ach/check number", "currency", "service fee (-)"].reduce((o, k) => (o[k] = U.findCol(ix, k), o), {});
      if (["date processed", "payable name", "sell price (pre-tax)", "payment"].some((k) => c[k] < 0)) { j.errors.push(`${f.name}: required Groupon columns not found.`); continue; }
      for (const r of f.rows.slice(1)) {
        if (r[c["payable name"]] === null) continue;
        const key = [r[c["ach/check number"]], r[c["date processed"]], r[c["payable name"]], r[c["payment status"]], r[c["payment type"]], r[c["groupon number"]], r[c["voucher id"]], r[c["payment"]], r[c["sell price (pre-tax)"]]].join("|");
        if (seen.has(key)) { dup++; continue; } seen.add(key);
        const raw = U.toDate(r[c["date processed"]]); if (!raw) continue;
        // exports show midnight-UTC as 20:00 (or 19:00) Eastern the evening before: add 12h, then take the month
        const pm = U.ym(new Date(raw.getTime() + 12 * 3600000));
        if (pm !== month) continue;
        if (U.ym(raw) !== pm) shifted++;
        if (String(r[c["payment status"]]) === "Voided") voided++;
        if (c["service fee (-)"] >= 0 && U.cents(r[c["service fee (-)"]]) !== 0) j.warnings.push("The Service fee column is not zero on this export. The SOP says it was zero, so review.");
        if (c.currency >= 0 && r[c.currency] && r[c.currency] !== "USD") j.errors.push("Non-USD Groupon row found.");
        const nm = r[c["payable name"]]; let cls = settings.groupPayableToClass[norm(nm)];
        if (!cls) { cls = U.inferClass(nm, settings.classRules); if (cls) guessed.add(`${nm} → ${cls}`); }
        if (!cls) { bad.add(nm); continue; }
        byClass[cls] = (byClass[cls] || 0) + (U.cents(r[c["sell price (pre-tax)"]]) - U.cents(r[c.payment])); used++;
      }
    }
    bad.forEach((b) => { j.errors.push(`Payable Name "${b}" has no class.`); j.fixes.push({ type: "groupon", key: b, label: `Groupon payable "${b}"` }); });
    if (guessed.size) j.warnings.push(`Class detected from the Payable Name (no saved entry yet): ${[...guessed].join("; ")}. Confirm once and it is remembered.`);
    if (dup) j.notes.push(`${dup} rows appeared in more than one export and were counted once.`);
    if (shifted) j.notes.push(`${shifted} rows show an Eastern time in the previous month but were processed on the 1st (midnight UTC). They are included in ${label}, as in the posted journal.`);
    if (voided) j.notes.push(`${voided} Voided rows included (SOP).`);
    j.notes.push("Month is taken from Date Processed, not purchase date. Commission per row = Sell price (pre-tax) minus Payment, which captures markup commission, Groupon Promotions marketing and voided reversals.");
    j.notes.push("Groupon pays only on redemption, with catch-up payments months late. Do not size a year-end receivable from early-January runs.");
    let total = 0;
    for (const cls of Object.keys(byClass).sort(U.classSort)) { total += byClass[cls]; j.line(A.groupFee, { debit: byClass[cls], description: `${label} Groupon commission - ${cls}`, cls }); }
    if (total) j.line(A.groupClearing, { credit: total, description: `${label} Groupon commission clearing` });
    else if (!j.errors.length) j.warnings.push("No Groupon rows found for this month.");
    j.meta.rows = used;
    return j;
  };

  /* ---------------- Airbnb ---------------- */
  ME.buildAirbnb = function (month, csvText, settings) {
    const [y, mo] = month.split("-");
    const j = new ME.Journal("airbnb", "Airbnb Experiences commission", `ABNB-${y}${mo}`, U.lastDate(month));
    const A = settings.accounts, label = U.monthLabel(month);
    const parts = (Array.isArray(csvText) ? csvText : [csvText]).map(U.parseCSV);
    const rows = parts[0].concat(...parts.slice(1).map((p) => p.slice(1))); const ix = U.indexHeaders(rows[0] || []);
    const c = Object.fromEntries(["date", "type", "confirmation code", "listing", "currency", "amount", "paid out", "service fee", "gross earnings", "details"].map((k) => [k, U.findCol(ix, k)]));
    if (Object.values(c).some((v) => v < 0)) { j.errors.push("Airbnb CSV columns not found. Export Transaction History as CSV."); return j; }
    const inMonth = rows.slice(1).filter((r) => { const d = U.toDate(r[c.date]); return d && U.ym(d) === month; });
    if (!inMonth.length) { j.errors.push(`No rows dated ${label} in this CSV.`); return j; }
    const exp = inMonth.filter((r) => r[c.type] === "Experience");
    j.notes.push(`Excluded ${inMonth.filter((r) => ["Reservation", "Co-Host payout", "Resolution Adjustment", "Resolution Payout", "Adjustment"].includes(r[c.type])).length} rows that are not Experiences (Reservations are Steven Garcia's STR properties, plus Co-Host payouts and Resolution items).`);
    const by = {}, countBy = {}, guessed = new Set(); let usdPay = 0, tot = 0;
    for (const r of exp) {
      const amt = U.cents(r[c.amount]), fee = U.cents(r[c["service fee"]]), gross = U.cents(r[c["gross earnings"]]);
      if (amt + fee !== gross) { j.errors.push(`${r[c["confirmation code"]]}: Payout + Service fee does not equal Gross earnings. Re-download the CSV.`); continue; }
      let cls = settings.airbnbListingToClass[r[c.listing]];
      if (!cls) { cls = U.inferClass(r[c.listing], settings.classRules); if (cls) guessed.add(`${r[c.listing]} → ${cls}`); }
      if (!cls) { j.errors.push(`New Experience product with no class: "${r[c.listing]}". SOP: escalate to the Controller before posting.`); j.fixes.push({ type: "airbnb", key: r[c.listing], label: `Airbnb listing "${r[c.listing]}"` }); continue; }
      if (r[c.currency] !== "USD") j.warnings.push(`${r[c["confirmation code"]]}: fee is in ${r[c.currency]} (${U.fmt(fee)}). It is booked at face value, as in earlier posted journals. Airbnb pays out in USD, so confirm the treatment.`);
      else usdPay += amt;
      by[cls] = (by[cls] || 0) + fee; countBy[cls] = (countBy[cls] || 0) + 1; tot += fee;
    }
    const paid = U.sum(inMonth.filter((r) => r[c.type] === "Payout" && String(r[c.details]).includes("6673")).map((r) => U.cents(r[c["paid out"]])));
    const nonUsd = U.sum(exp.filter((r) => r[c.currency] !== "USD").map((r) => U.cents(r[c.amount])));
    j.notes.push(`Payouts to Chase 6673: ${U.fmt(paid)}. USD Experience earnings: ${U.fmt(usdPay)}. Difference ${U.fmt(paid - usdPay)}${nonUsd ? " (the non-USD Experience payouts)" : ""}.`);
    if (guessed.size) j.warnings.push(`Class detected from the listing name (no saved entry yet): ${[...guessed].join("; ")}. The SOP says a new product goes to the Controller, so confirm it.`);
    for (const cls of Object.keys(by).sort(U.classSort)) j.line(A.airbnbFee, { debit: by[cls], description: `Airbnb commission ${label} - ${cls} (${countBy[cls]} experiences)`, cls });
    if (tot) j.line(A.airbnbClearing, { credit: tot, description: `Airbnb commission clearing ${label}` });
    return j;
  };
})(typeof window !== "undefined" ? window : globalThis);
