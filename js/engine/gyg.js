(function (g) {
  const ME = (g.ME = g.ME || {}); const U = ME.U;

  /* invoices: [{name, hash, rows}] (first sheet of each GIS-*.xlsx); pdfs: {invoiceNo: {account, commission, bookings,...}};
     overrides: {invoiceNo: class} chosen on screen */
  ME.buildGyg = function (month, invoices, pdfs, settings, overrides = {}) {
    const [y, mo] = month.split("-");
    const j = new ME.Journal("gyg", "GetYourGuide commission", `GYG-${y}-${mo}`, U.lastDate(month));
    const A = settings.accounts, label = U.monthLabel(month);
    const seen = new Map(), table = [], byClass = {}, noPdf = [], inferred = [], nyc = [];
    const fx = (cur) => { if (cur === "USD") return 1; const r = settings.fx[month] && settings.fx[month][cur]; if (!r) j.errors.push(`No ${cur} rate for ${month}. Add it in Settings > FX rates.`); return r; };

    for (const f of invoices) {
      if (seen.has(f.hash)) { j.notes.push(`Skipped duplicate download ${f.name} (same content as ${seen.get(f.hash)}).`); continue; }
      seen.set(f.hash, f.name);
      const inv = (f.name.match(/GIS-(\d+)/) || [])[1];
      if (!inv) { j.warnings.push(`${f.name}: file name has no GIS- invoice number, ignored.`); continue; }
      const rows = f.rows; const ix = U.indexHeaders(rows[0] || []);
      const c = {
        ref: U.findCol(ix, "booking ref #"), act: U.findCol(ix, "activity date"), prod: U.findCol(ix, "product reference"),
        cur: U.findCol(ix, "currency"), gross: U.findCol(ix, "retail price"), com: U.findCol(ix, "commission amount"),
        tax: U.findCol(ix, "sales tax amount"), adj: U.findCol(ix, "manual adjustments"), net: U.findCol(ix, /^retail price minus/)
      };
      const miss = ["ref", "act", "cur", "gross", "com", "net"].filter((k) => c[k] < 0);
      if (miss.length) { j.errors.push(`GIS-${inv}: columns not found: ${miss.join(", ")}. GYG changed the invoice layout - the file needs a look.`); continue; }
      const data = rows.slice(1).filter((r) => r[c.ref] !== null && r[c.ref] !== "");
      if (!data.length) { j.warnings.push(`GIS-${inv}: no rows.`); continue; }
      const months = {}; data.forEach((r) => { const d = U.toDate(r[c.act]); if (d) months[U.ym(d)] = (months[U.ym(d)] || 0) + 1; });
      const svc = Object.entries(months).sort((a, b) => b[1] - a[1])[0][0];
      const sumC = (col) => col < 0 ? 0 : U.sum(data.map((r) => U.cents(r[col])));
      const curs = [...new Set(data.map((r) => r[c.cur]))];
      const e = { inv, file: f.name, svc, rows: data.length, currency: curs[0], gross: sumC(c.gross), comm: -sumC(c.com), net: sumC(c.net), tax: sumC(c.tax), adj: sumC(c.adj), pdf: pdfs[inv] || null, included: false };
      if (svc !== month) { e.skip = `${U.monthLabel(svc)} invoice`; table.push(e); continue; }
      if (curs.length !== 1) { j.errors.push(`GIS-${inv}: mixed currencies ${curs.join("/")}.`); table.push(e); continue; }
      if (e.gross - e.comm - e.tax + e.adj !== e.net) j.warnings.push(`GIS-${inv}: gross ${U.fmt(e.gross)} - commission ${U.fmt(e.comm)} - tax ${U.fmt(e.tax)} + adjustments ${U.fmt(e.adj)} does not equal net ${U.fmt(e.net)}.`);
      if (e.adj) j.notes.push(`GIS-${inv}: payout adjustment ${U.fmt(e.adj)} has no commission effect and is not in this journal.`);
      if (e.pdf) {
        if (e.pdf.commission !== null && e.pdf.commission !== e.comm) j.errors.push(`GIS-${inv}: commission ${U.fmt(e.comm)} does not tie to the PDF (${U.fmt(e.pdf.commission)}).`);
        else if (e.pdf.bookings !== null && e.pdf.bookings !== e.gross) j.errors.push(`GIS-${inv}: bookings ${U.fmt(e.gross)} do not tie to the PDF (${U.fmt(e.pdf.bookings)}).`);
        else { e.tied = true; j.notes.push(`GIS-${inv}: gross and commission tie to the PDF to the penny.`); }
      } else noPdf.push(inv);

      // class: override > PDF account number > saved invoice map > product names
      let cls = overrides[inv], how = "chosen on screen";
      if (!cls && e.pdf && e.pdf.account && settings.gygAccountToClass[e.pdf.account]) { cls = settings.gygAccountToClass[e.pdf.account]; how = `PDF account ${e.pdf.account}`; }
      if (!cls && settings.gygInvoiceToClass[inv]) { cls = settings.gygInvoiceToClass[inv]; how = "saved invoice map"; }
      if (!cls && c.prod >= 0) {
        const hits = {};
        data.forEach((r) => { const k = U.inferClass(r[c.prod], settings.classRules); if (k) hits[k] = (hits[k] || 0) + 1; });
        const top = Object.entries(hits).sort((a, b) => b[1] - a[1])[0];
        if (top && top[1] / data.length > 0.5) { cls = top[0]; how = "detected from product names"; if (!e.tied) inferred.push(`${inv} → ${cls}`); }
      }
      e.cls = cls || ""; e.classSource = cls ? how : "";
      if (!cls) { j.errors.push(`GIS-${inv}: class not found. Pick it below or add the PDF.`); j.fixes.push({ type: "gyg", key: inv, label: `GIS-${inv}` }); table.push(e); continue; }
      if (cls === "NYC") nyc.push(inv);
      const r = fx(e.currency); if (!r) { table.push(e); continue; }
      e.rate = r; e.usd = e.currency === "USD" ? e.comm : U.mulRound(e.comm, r); e.included = true;
      if (e.currency !== "USD") j.notes.push(`GIS-${inv}: ${e.currency} ${U.fmt(e.comm)} converted at ${r} (month-average rate).`);
      (byClass[cls] = byClass[cls] || { usd: 0, invs: [] }); byClass[cls].usd += e.usd; byClass[cls].invs.push(`GIS-${inv}`);
      table.push(e);
    }
    // invoices that arrived only as a PDF (no Excel): read gross, commission, currency, class and month from the PDF itself
    const MONTHS = ["january","february","march","april","may","june","july","august","september","october","november","december"];
    for (const [inv, pdf] of Object.entries(pdfs)) {
      if (table.some((t) => t.inv === inv) || !pdf || pdf.commission === null || pdf.commission === undefined) continue;
      const pm = pdf.period && pdf.period.match(/^([A-Za-z]+)\s+\d+\s*-\s*\d+,\s*(\d{4})/);
      const svc = pm && MONTHS.indexOf(pm[1].toLowerCase()) >= 0 ? `${pm[2]}-${String(MONTHS.indexOf(pm[1].toLowerCase()) + 1).padStart(2, "0")}` : month;
      const e = { inv, file: `GIS-${inv}.pdf`, svc, rows: 0, currency: pdf.currency || "USD", gross: pdf.bookings || 0, comm: pdf.commission, net: 0, tax: 0, adj: 0, pdf, tied: true, fromPdf: true };
      if (!pdf.period) j.warnings.push(`GIS-${inv}: the PDF has no service period, so it is assumed to be ${label}.`);
      if (svc !== month) { e.skip = `${U.monthLabel(svc)} invoice`; table.push(e); continue; }
      let cls = overrides[inv], how = "chosen on screen";
      if (!cls && pdf.account && settings.gygAccountToClass[pdf.account]) { cls = settings.gygAccountToClass[pdf.account]; how = `PDF account ${pdf.account}`; }
      if (!cls && settings.gygInvoiceToClass[inv]) { cls = settings.gygInvoiceToClass[inv]; how = "saved invoice map"; }
      e.cls = cls || ""; e.classSource = cls ? how : "";
      if (!cls) { j.errors.push(`GIS-${inv}: class not found for PDF account ${pdf.account || "(none)"}. Pick it below.`); j.fixes.push({ type: "gyg", key: inv, label: `GIS-${inv}` }); table.push(e); continue; }
      if (cls === "NYC") nyc.push(inv);
      const r = fx(e.currency); if (!r) { table.push(e); continue; }
      e.rate = r; e.usd = e.currency === "USD" ? e.comm : U.mulRound(e.comm, r); e.included = true;
      j.notes.push(`GIS-${inv}: read from the PDF alone (no Excel file). Commission ${e.currency} ${U.fmt(e.comm)}${e.currency !== "USD" ? ` converted at ${r}` : ""}. Add the Excel file to tie the booking lines.`);
      (byClass[cls] = byClass[cls] || { usd: 0, invs: [] }); byClass[cls].usd += e.usd; byClass[cls].invs.push(`GIS-${inv}`);
      table.push(e);
    }
    if (noPdf.length) j.warnings.push(`No PDF added for ${noPdf.length} invoice(s) (${noPdf.map((x) => "GIS-" + x).join(", ")}). They are not tied to the invoice to the penny and their class is not confirmed by account number.`);
    if (inferred.length) j.warnings.push(`Class detected from product names (not yet confirmed by a PDF account number) for: ${inferred.join("; ")}. Confirm with the PDF account number.`);
    if (nyc.length) j.warnings.push(`NYC account 248305 (${nyc.map((x) => "GIS-" + x).join(", ")}): flag for entity review.`);
    let total = 0;
    for (const cls of Object.keys(byClass).sort(U.classSort)) {
      const v = byClass[cls]; total += v.usd;
      j.line(A.gygFee, { debit: v.usd, description: `GYG commission ${label} - ${cls} (${v.invs.sort().join(", ")})`, name: settings.names.gyg, cls });
    }
    if (total) j.line(A.gygClearing, { credit: total, description: `GYG commission clearing ${label}`, name: settings.names.gyg, cls: settings.classes.gygClearing });
    j.notes.push("GYG invoices by activity date but Xola by transaction date: one month will never equal the other. Reconcile cumulatively, not month by month.");
    j.notes.push("Do not post GYG_FIX_2026. Credit 10032.3 GYG Sales, never the parent 10029. Compensation fees for supplier cancellations are already inside the commission.");
    j.meta.table = table;
    return j;
  };
})(typeof window !== "undefined" ? window : globalThis);
