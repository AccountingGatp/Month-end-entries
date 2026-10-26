(function (g) {
  const ME = (g.ME = g.ME || {}); const U = ME.U;
  const has = (hay, needle) => U.norm(hay).includes(U.norm(needle));

  /* ================= CFL (Chicago From the Lake) =================
     Reads the Xola Events Export (Reservations sheet). Header row is located by "Base Amount" because Xola
     changed the layout from 43 to 39 columns, so nothing is positional. */
  ME.cfl = {
    calc(baseCents, feePct, cppPct) {
      return { base: baseCents, fee: U.mulRound(baseCents, feePct / 100), cpp: U.mulRound(baseCents, cppPct / 100),
               gross: U.mulRound(baseCents, (100 - cppPct + feePct) / 100) };   // 77% with 9% / 32%
    },
    scan(sheets, from, to, cfg) {
      const sh = sheets.find((s) => /reserv/i.test(s.name)) || sheets[0];
      const hi = sh.rows.slice(0, 15).findIndex((r) => r.some((x) => /^base amount$/i.test(U.norm(x))));
      if (hi < 0) return { error: 'Header row with "Base Amount" not found. Xola may have changed the export again.' };
      const ix = U.indexHeaders(sh.rows[hi]);
      const c = { arr: U.findCol(ix, /^arrival date/), st: U.findCol(ix, "status"), src: U.findCol(ix, "source"), pt: U.findCol(ix, "purchase type"),
                  type: U.findCol(ix, "type"), prod: U.findCol(ix, /^(product|product name|experience|experience name|item|item name)$/), base: U.findCol(ix, "base amount") };
      const need = ["arr", "st", "src", "prod", "base"].filter((k) => c[k] < 0);
      if (need.length) return { error: `Columns not found in the Xola export: ${need.join(", ")}.` };
      const out = { sheet: sh.name, base: 0, rows: 0, byProduct: {}, unknown: {}, excluded: { status: 0, source: 0, waitlist: 0, type: 0, notCfl: 0, outOfRange: 0 }, minArrival: null, maxArrival: null };
      for (const r of sh.rows.slice(hi + 1)) {
        const a = U.toDate(r[c.arr]); if (!a || r[c.prod] === null) continue;
        const ad = U.ymd(a);
        if (!out.minArrival || ad < out.minArrival) out.minArrival = ad; if (!out.maxArrival || ad > out.maxArrival) out.maxArrival = ad;
        if (ad < from || ad > to) { out.excluded.outOfRange++; continue; }
        if (c.pt >= 0 && has(r[c.pt], "waitlist")) { out.excluded.waitlist++; continue; }
        if (c.type >= 0 && r[c.type] && U.norm(r[c.type]) !== "order") { out.excluded.type++; continue; }
        if (U.norm(r[c.st]) !== "confirmed") { out.excluded.status++; continue; }
        if (/get\s?your\s?guide/i.test(String(r[c.src] || ""))) { out.excluded.source++; continue; }
        const p = String(r[c.prod]).trim();
        if (cfg.notCfl.some((n) => has(p, n))) { out.excluded.notCfl++; continue; }
        if (!cfg.products.some((n) => has(p, n) || has(n, p))) { out.unknown[p] = (out.unknown[p] || 0) + U.cents(r[c.base]); continue; }
        const b = U.cents(r[c.base]); out.base += b; out.rows++; out.byProduct[p] = (out.byProduct[p] || 0) + b;
      }
      return out;
    },
    /* thresholds from the SOP: <0.5% post; 0.5-5% note and post; >5% stop */
    validate(ourBase, connorBase) {
      if (!connorBase) return { level: "missing", pct: null };
      const pct = Math.abs(ourBase - connorBase) / connorBase * 100;
      return { level: pct < 0.5 ? "ok" : pct <= 5 ? "note" : "stop", pct };
    }
  };

  /* accrual (estimate) for the 16th to month end */
  ME.buildCflEstimate = function (month, p, settings) {
    const [y, mo] = month.split("-"); const A = settings.accounts, label = U.monthLabel(month);
    const j = new ME.Journal("cfl", "CFL accrual (16th to month end)", `CFL-${y}${mo}`, U.lastDate(month));
    const k = ME.cfl.calc(p.base, settings.cfl.feePct, settings.cfl.cppPct); j.meta = { ...k, ad: p.ad };
    if (!p.base) { j.errors.push("Base amount is zero. Check the Xola export, the date range and the CFL product list."); return j; }
    const net = k.gross - (p.ad || 0), desc = `${label} CFL Accrual (16-${U.lastDay(month)})`, nm = settings.names.cfl, cls = settings.classes.boats;
    j.line(A.cflCogs, { debit: k.gross, description: desc, name: nm, cls });
    if (p.ad) j.line(A.cflMarketing, { credit: p.ad, description: desc, name: nm, cls });
    j.line(A.accountsPayable, { credit: net, description: desc, name: nm, cls });
    if (!p.ad) j.warnings.push("No ad-spend credit yet. Post without it and add it when Aanand's 'Marketing Accrual for CFL' email arrives. Do not guess a percentage.");
    if (p.validation) {
      const v = p.validation;
      if (v.level === "stop") j.errors.push(`Validation failed: the 1st-15th base differs from Connor's by ${v.pct.toFixed(2)}% (over 5%). Product scope or rates have changed. Stop and check.`);
      else if (v.level === "note") j.warnings.push(`Validation: 1st-15th base is ${v.pct.toFixed(2)}% from Connor's (0.5%-5%). Note it and post.`);
      else if (v.level === "ok") j.notes.push(`Validation: 1st-15th base is ${v.pct.toFixed(2)}% from Connor's (under 0.5%). Post.`);
      else j.warnings.push("Connor's reconciliation was not entered, so the validation step was skipped. Say so on handover.");
    }
    j.notes.push(`Base ${U.fmt(k.base)}; CFL fee ${settings.cfl.feePct}% = ${U.fmt(k.fee)}; CPP commission ${settings.cfl.cppPct}% = ${U.fmt(k.cpp)}; gross to CFL = base x ${100 - settings.cfl.cppPct + settings.cfl.feePct}% = ${U.fmt(k.gross)}; less ad spend = net accrual ${U.fmt(net)}.`);
    j.notes.push("The credit goes to A/P (not 21090), so the reversal when the actual arrives is essential. Leaving it in double-charges the period. The vendor name must match exactly or QBO creates a new vendor.");
    j.notes.push("Excluded on purpose: GYG and other OTAs, charters (booked off-platform), cancellations. Not the boat-booking accrual (70% of unsailed bookings), which Empire does not book.");
    j.notes.push("Past runs came out light: 16-31 Aug 2026 was accrued at 247,175 against an actual of 273,244 (10.5% short).");
    return j;
  };

  /* actual arrives: reverse the estimate in full, book the actual */
  ME.buildCflActual = function (month, p, settings) {
    const [y, mo] = month.split("-"); const A = settings.accounts, label = U.monthLabel(month);
    const j = new ME.Journal("cfl", "CFL actual (reverses estimate)", `CFL-ACT-${y}${mo}`, p.date || U.lastDate(month));
    const nm = settings.names.cfl, cls = settings.classes.boats;
    if (!p.total) { j.errors.push("Enter Connor's total payable to CFL."); return j; }
    if (p.priorGross) {
      const pnet = p.priorGross - (p.priorAd || 0);
      j.line(A.cflCogs, { credit: p.priorGross, description: `Reverse ${label} CFL accrual estimate`, name: nm, cls });
      if (p.priorAd) j.line(A.cflMarketing, { debit: p.priorAd, description: `Reverse ${label} CFL accrual estimate`, name: nm, cls });
      j.line(A.accountsPayable, { debit: pnet, description: `Reverse ${label} CFL accrual estimate`, name: nm, cls });
    } else j.warnings.push("No estimate entered, so only the actual is booked. The estimate still has to be reversed in full.");
    const ad = p.ad || 0;
    j.line(A.cflCogs, { debit: p.total + ad, description: `${label} CFL actual per Connor's reconciliation`, name: nm, cls });
    if (ad) j.line(A.cflMarketing, { credit: ad, description: `${label} CFL actual per Connor's reconciliation`, name: nm, cls });
    j.line(A.accountsPayable, { credit: p.total, description: `${label} CFL actual per Connor's reconciliation`, name: nm, cls });
    j.notes.push("Dr 50015 at his total plus ad spend, Cr 60017 for the ad spend, Cr 20000 for his total to CFL. Reply to Jonathan to confirm.");
    if (p.priorGross) j.notes.push(`Estimate ${U.fmt(p.priorGross - (p.priorAd || 0))} vs actual ${U.fmt(p.total)}: ${(((p.total - (p.priorGross - (p.priorAd || 0))) / p.total) * 100).toFixed(1)}% ${p.total > p.priorGross - (p.priorAd || 0) ? "short" : "over"}.`);
    return j;
  };

  /* ================= Shoreline ================= */
  ME.shoreline = {
    /* rows from the Ventrata detail report using the columns chosen on screen */
    sumRevenue(sheet, hdrIdx, prodCol, amtCol, cfg) {
      let total = 0, excluded = 0, n = 0; const pats = [...cfg.excludePatterns]; if (cfg.exclude75) pats.push("75[- ]?min");
      const res = pats.map((p) => new RegExp(p, "i")); const byProduct = {};
      for (const r of sheet.rows.slice(hdrIdx + 1)) {
        const p = r[prodCol]; if (p === null || p === undefined || r[amtCol] === null) continue;
        const a = U.cents(r[amtCol]); if (res.some((re) => re.test(String(p)))) { excluded += a; continue; }
        total += a; n++; byProduct[p] = (byProduct[p] || 0) + a;
      }
      return { total, excluded, n, byProduct };
    }
  };
  ME.buildShoreline = function (month, revenueCents, settings) {
    const [y, mo] = month.split("-"); const A = settings.accounts, label = U.monthLabel(month);
    const j = new ME.Journal("shoreline", "Shoreline accrual", `SHR-${y}${mo}`, U.lastDate(month));
    if (!revenueCents) { j.errors.push("Enter the non-90-minute cruise revenue."); return j; }
    const acc = U.mulRound(revenueCents, settings.shoreline.sharePct / 100);
    j.meta = { revenue: revenueCents, accrual: acc };
    j.line(A.shorelineCogs, { debit: acc, description: `${label} Shoreline accrual`, name: settings.names.shoreline, cls: settings.classes.boats });
    j.line(A.shorelineAccrued, { credit: acc, description: `${label} Shoreline accrual`, name: settings.names.shoreline, cls: settings.classes.boats });
    j.notes.push(`${settings.shoreline.sharePct}% of non-90-minute cruise revenue ${U.fmt(revenueCents)} = ${U.fmt(acc)}. Separate arrangement from CFL.`);
    j.warnings.push("If the Shoreline actual has not arrived, this is an estimate by Jonathan's method. Flag it and correct when the actual arrives.");
    j.warnings.push("CONFIRM: the 75-minute tour now sits inside Connor's CFL report as well. Make sure it is not accrued twice (Jonathan raised this on 16 Sep).");
    return j;
  };

  /* ================= Viator ================= */
  ME.buildViator = function (month, rows, settings) {
    const [y, mo] = month.split("-"); const A = settings.accounts, label = U.monthLabel(month);
    const j = new ME.Journal("viator", "Viator commission", `VIA-${y}${mo}`, U.lastDate(month));
    if (!rows.length) { j.errors.push("Add at least one Viator row (class, gross, net)."); return j; }
    if (!A.viatorFee) j.errors.push("The Viator commission account is not set (open item). Fill it in under Settings > Accounts.");
    let total = 0;
    const byCls = {};
    for (const r of rows) { const b = (byCls[r.cls] = byCls[r.cls] || { comm: 0, diff: 0 }); b.comm += r.gross - r.net; b.diff += r.diff || 0; }
    for (const cls of Object.keys(byCls).sort(U.classSort)) {
      const b = byCls[cls];
      if (b.comm) { j.line(A.viatorFee, { debit: b.comm, description: `${label} Viator commission - ${cls}`, name: settings.names.viator, cls }); total += b.comm; }
      if (b.diff) {
        if (!A.viatorPriceDiff) j.errors.push("The Viator price-difference account is not set. It is its own line, not commission.");
        j.line(A.viatorPriceDiff, { debit: b.diff, description: `${label} Viator vs Xola base price difference (dynamic pricing) - ${cls}`, name: settings.names.viator, cls }); total += b.diff;
      }
    }
    j.line(A.viatorClearing, { credit: total, description: `${label} Viator commission clearing`, name: settings.names.viator });
    j.notes.push("Commission = Viator gross less net received. A higher older rate (for example 50% before the 30%/40% product rate) counts as commission. The Xola base vs Viator gross difference is its own line.");
    j.warnings.push("CONFIRM (open item): Viator commission account and class, and the report source. Also check that every entity on the Viator advice appears in the Xola report.");
    return j;
  };
  ME.viatorBalanceCheck = function (balance, monthSales) {
    if (balance < 0) return { level: "stop", text: "Negative: cash was coded with no sale behind it." };
    if (balance === 0) return { level: "ok", text: "Nil: everything is settled." };
    const r = monthSales ? balance / monthSales : null;
    if (r !== null && r >= 1.8) return { level: "stop", text: `About ${r.toFixed(1)} months of sales are uncollected. Two months or more means a missing advice or a late payment.` };
    return { level: "ok", text: `About ${r === null ? "one" : r.toFixed(1)} month of sales outstanding, which is expected (Viator pays a month in arrears).` };
  };
})(typeof window !== "undefined" ? window : globalThis);
