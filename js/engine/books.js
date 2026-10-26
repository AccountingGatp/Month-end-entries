(function (g) {
  const ME = (g.ME = g.ME || {}); const U = ME.U;

  /* ---------------- Depreciation (Garcia tracker, "Empire <year>" sheet only) ---------------- */
  ME.buildDepreciation = function (month, sheets, settings) {
    const [y, mo] = month.split("-");
    const j = new ME.Journal("depreciation", "Depreciation", `DEP-${y}${mo}`, U.lastDate(month));
    const sh = sheets.find((s) => /empire/i.test(s.name) && s.name.includes(y) && !/personal|consolidated/i.test(s.name));
    if (!sh) { j.errors.push(`No "Empire ${y}" sheet in the tracker. (The Personal sheets are Steven Garcia's own vehicles and are not used.)`); return j; }
    const hi = sh.rows.findIndex((r) => String(r[0]).trim() === "Month");
    const mi = sh.rows.findIndex((r) => String(r[0]).trim() === U.MONTHS[+mo - 1]);
    if (hi < 0 || mi < 0) { j.errors.push("Month row not found in the tracker."); return j; }
    const hdr = sh.rows[hi], row = sh.rows[mi]; const assets = [];
    let totalCol = -1;
    hdr.forEach((h, i) => { const s = String(h || ""); const m = s.match(/^\s*(ET-\d+)/); if (m) assets.push([m[1], U.cents(row[i])]); if (/total/i.test(s)) totalCol = i; });
    const total = totalCol >= 0 ? U.cents(row[totalCol]) : null;
    if (total !== null && U.sum(assets.map((a) => a[1])) !== total) j.warnings.push(`Per-asset sum ${U.fmt(U.sum(assets.map((a) => a[1])))} differs from TOTAL DEP ${U.fmt(total)}.`);
    for (const [a, v] of assets) {
      const cls = settings.depAssetClass[a];
      if (!cls) { j.errors.push(`Asset ${a} has no class. Add it in Settings > Depreciation.`); continue; }
      j.line(settings.accounts.depExpense, { debit: v, cls }); j.line(settings.accounts.depAccum, { credit: v, cls });
    }
    j.notes.push("One debit and credit pair per asset, using the classes in the posted journal (ET-1 Administrative, ET-2 and ET-3 SIA).");
    j.notes.push("Open item: QBO also shows 80000 Amortization expenses of 1,925.00 a month with no workings. Use the Amortization tab once the source is known.");
    return j;
  };

  /* ---------------- Jonathan loan interest: simple, actual/365, daily balance ---------------- */
  /* opening = balance (cents) on the 1st; movements = [{date:'YYYY-MM-DD', delta:cents}] (advance +, repayment -) */
  ME.calcJonathan = function (month, opening, movements, ratePct, basis) {
    const [y, mo] = month.split("-").map(Number); const last = U.lastDay(month);
    const pts = movements.filter((m) => m.date && m.date.startsWith(month) && m.delta).map((m) => ({ d: +m.date.slice(8, 10), delta: m.delta })).sort((a, b) => a.d - b.d);
    let bal = opening, cur = 1, interest = 0; const segs = [];
    for (const p of pts.concat([{ d: last + 1, delta: 0 }])) {
      const days = p.d - cur; if (days > 0) { const i = bal * (ratePct / 100) * days / basis; interest += i; segs.push({ from: cur, to: p.d - 1, days, balance: bal, interest: i }); }
      bal += p.delta; cur = p.d;
    }
    return { interest: Math.round(interest), closing: bal, segs };
  };
  ME.buildJonathan = function (month, opening, movements, settings) {
    const [y, mo] = month.split("-");
    const j = new ME.Journal("jonathan", "Jonathan loan interest", `JINT-${y}${mo}`, U.lastDate(month));
    const r = ME.calcJonathan(month, opening, movements, settings.jonathan.ratePct, settings.jonathan.basis);
    j.meta = r;
    if (!opening && !movements.length) { j.errors.push("Enter the 23021 balance at the start of the month (and any advances or repayments)."); return j; }
    if (r.interest > 0) {
      j.line(settings.accounts.jonathanExpense, { debit: r.interest, description: `${U.monthLabel(month)} Jonathan Interest Accrual`, cls: settings.classes.admin });
      j.line(settings.accounts.jonathanAccrued, { credit: r.interest, description: `${U.monthLabel(month)} Jonathan Interest Accrual`, cls: settings.classes.admin });
    }
    j.notes.push(`${settings.jonathan.ratePct}% p.a. simple, actual/${settings.jonathan.basis}, on the daily 23021 balance. A balance change counts from the day it happens, and month-end is not double counted.`);
    j.warnings.push("The 15% rate and the loan classification are marked PROVISIONAL in Jonathan's workbook pending the final loan agreement. Confirm before locking.");
    j.warnings.push("The balance is typed in, not read from QBO. Compare it with the 23021 balance in QBO before importing.");
    return j;
  };

  /* ---------------- SIA note payable (23014): level-payment loan, accrual that reverses next month ---------------- */
  /* Option A: opening principal + annual rate -> interest = balance x rate / 12.  Option B: amortization workbook row. */
  ME.sia = {
    fromBalance: (balanceCents, ratePct) => Math.round(balanceCents * (ratePct / 100) / 12),
    fromWorkbook(sheets, month) {
      for (const sh of sheets) {
        const hi = sh.rows.findIndex((r) => r.some((x) => /^interest$/i.test(String(x || "").trim())) && r.some((x) => /date/i.test(String(x || ""))));
        if (hi < 0) continue;
        const hdr = sh.rows[hi]; const di = hdr.findIndex((x) => /date/i.test(String(x || ""))); const ii = hdr.findIndex((x) => /^interest$/i.test(String(x || "").trim()));
        for (const r of sh.rows.slice(hi + 1)) { const d = U.toDate(r[di]); if (d && U.ym(d) === month) return { cents: U.cents(r[ii]), sheet: sh.name, date: U.ymd(d) }; }
      }
      return null;
    }
  };
  ME.buildSia = function (month, interestCents, settings) {
    const [y, mo] = month.split("-");
    const label = U.monthLabel(month), A = settings.accounts;
    const j = new ME.Journal("sia", "23014 Note Payable - SIA interest (accrual)", `SIA-${y}${mo}`, U.lastDate(month));
    const rev = new ME.Journal("sia", "23014 SIA interest (reversal)", `SIA-REV-${y}${mo}`, U.nextMonthFirst(month));
    if (!interestCents) { j.errors.push("Enter the month's interest."); return [j, rev]; }
    j.line(A.siaExpense, { debit: interestCents, description: `${label} SIA note interest accrual`, cls: settings.classes.admin });
    j.line(A.siaCredit, { credit: interestCents, description: `${label} SIA note interest accrual`, cls: settings.classes.admin });
    rev.line(A.siaExpense, { credit: interestCents, description: `Reverse ${label} SIA note interest accrual`, cls: settings.classes.admin });
    rev.line(A.siaCredit, { debit: interestCents, description: `Reverse ${label} SIA note interest accrual`, cls: settings.classes.admin });
    j.warnings.push("CONFIRM (open item): whether the debit needs its own sub-account or shares 60260, and which credit Empire uses (accrued interest vs the loan account 23011:23014).");
    j.notes.push("Accrual dated month-end. The reversal dated the 1st of next month stops the interest being counted twice when the payment is booked. The workbook marks each month 'Monthly Accrude' with a 'Monthly JE reverse'.");
    return [j, rev];
  };

  /* ---------------- Recurring fixed entry: amortization (80000) ---------------- */
  ME.buildAmort = function (month, amountCents, settings) {
    const [y, mo] = month.split("-");
    const j = new ME.Journal("amort", "Amortization (80000)", `AMORT-${y}${mo}`, U.lastDate(month));
    if (!amountCents) { j.errors.push("Enter the monthly amount. QBO shows 1,925.00 in Aug and Sep 2026, but the workings are not in the notes."); return j; }
    j.line(settings.accounts.amortExpense, { debit: amountCents, description: `${U.monthLabel(month)} amortization`, cls: settings.classes.admin });
    j.line(settings.accounts.amortCredit, { credit: amountCents, description: `${U.monthLabel(month)} amortization`, cls: settings.classes.admin });
    j.warnings.push("CONFIRM (open item): what is being amortised (for example intangibles from the See It All acquisition) and the accumulated amortization account to credit.");
    return j;
  };
})(typeof window !== "undefined" ? window : globalThis);
