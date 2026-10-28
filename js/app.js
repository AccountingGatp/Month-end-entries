(function () {
  "use strict";
  const ME = window.ME, U = ME.U, fmt = U.fmt, cents = U.cents;

  /* ================= tiny DOM helper (text always set as text, never HTML) ================= */
  const PROPS = new Set(["value", "checked", "disabled", "selected", "textContent"]);
  function h(tag, attrs, ...kids) {
    const e = document.createElement(tag);
    for (const [k, v] of Object.entries(attrs || {})) {
      if (v === null || v === undefined || v === false) continue;
      if (k === "class") e.className = v; else if (k.startsWith("on")) e.addEventListener(k.slice(2), v);
      else if (PROPS.has(k)) e[k] = v; else e.setAttribute(k, v === true ? "" : v);
    }
    for (const kid of kids.flat(3)) { if (kid === null || kid === undefined || kid === false) continue; e.append(kid.nodeType ? kid : document.createTextNode(String(kid))); }
    return e;
  }
  const toastEl = document.createElement("div"); const toastHost = document.getElementById("toast"); let tt;
  const toast = (m) => { toastHost.textContent = m; toastHost.classList.add("show"); clearTimeout(tt); tt = setTimeout(() => toastHost.classList.remove("show"), 3200); };
  const save = (blob, name) => { const a = h("a", { href: URL.createObjectURL(blob), download: name }); document.body.append(a); a.click(); a.remove(); setTimeout(() => URL.revokeObjectURL(a.href), 3000); };
  const LS = { get(k) { try { return localStorage.getItem(k); } catch (e) { return null; } }, set(k, v) { try { localStorage.setItem(k, v); } catch (e) { /* private mode */ } } };

  /* ================= settings: class maps etc. live in this browser; FX is never stored here ================= */
  const merge = (a, b) => { for (const k of Object.keys(b || {})) { if (b[k] && typeof b[k] === "object" && !Array.isArray(b[k])) a[k] = merge(a[k] && typeof a[k] === "object" ? a[k] : {}, b[k]); else a[k] = b[k]; } return a; };
  let settings = merge(JSON.parse(JSON.stringify(ME.DEFAULTS)), (() => { try { return JSON.parse(LS.get("med-settings") || "{}"); } catch (e) { return {}; } })());
  settings.fx = {};
  (function enforce() {   // 75-minute tour: Shoreline only, never CFL
    const t = "75-Minute River Boat Architecture Tour"; settings.cfl.products = settings.cfl.products.filter((x) => !/^75/.test(x));
    if (!settings.cfl.notCfl.includes(t)) settings.cfl.notCfl.push(t); settings.shoreline.exclude75 = false;
  })();
  const saveSettings = () => { const c = JSON.parse(JSON.stringify(settings)); delete c.fx; LS.set("med-settings", JSON.stringify(c)); };

  const nowD = new Date();
  const state = {
    page: "close", month: LS.get("med-month") || U.prevMonth(`${nowD.getFullYear()}-${String(nowD.getMonth() + 1).padStart(2, "0")}`),
    files: [], overrides: {}, fx: null, results: {}, processed: false, stale: false, busy: false, progress: [],
    jon: { opening: "", moves: [{ date: "", amt: "" }] }, sia: { balance: "", rate: "5.5", direct: "" },
    cfl: { ad: "", cppFirst: "", baseFirst: "", manualBase: "", total: "", adActual: "", priorGross: "", priorAd: "" },
    shr: { prod: -1, amt: -1, hdr: 0, manual: "" }, amort: { amount: "" }
  };
  let uid = 0;

  /* ================= reading files ================= */
  async function readFiles(list) {
    const out = [];
    for (const f of list) {
      if (/\.zip$/i.test(f.name)) {
        const z = await JSZip.loadAsync(await f.arrayBuffer());
        for (const [p, en] of Object.entries(z.files)) if (!en.dir && !/__MACOSX|(^|\/)\./.test(p)) out.push({ name: p.split("/").pop(), buf: await en.async("arraybuffer") });
      } else out.push({ name: f.name, buf: await f.arrayBuffer() });
    }
    return out;
  }
  async function pdfText(buf) {
    pdfjsLib.GlobalWorkerOptions.workerSrc = "js/vendor/pdf.worker.min.js";
    const doc = await pdfjsLib.getDocument({ data: buf }).promise; let t = "";
    for (let i = 1; i <= doc.numPages; i++) { const c = await (await doc.getPage(i)).getTextContent(); t += c.items.map((x) => x.str).join(" ") + "\n"; }
    return t;
  }
  const TYPES = { gyg: "GYG invoice (.xlsx)", gygpdf: "GYG invoice PDF", groupon: "Groupon PAYMENT_DETAILS", airbnb: "Airbnb transaction history", depreciation: "Depreciation tracker", xola: "Xola Events Export", sia: "23014 SIA amortization workbook", jonathanwb: "Jonathan interest workbook", shoreline: "Ventrata / Shoreline report", empty: "Empty export (ignored)", unknown: "Not recognised" };

  /* recognise a file from its name and contents, so nothing has to be sorted by hand */
  async function classify(it) {
    const name = it.name, ext = ((name.match(/\.(\w+)$/) || [])[1] || "").toLowerCase();
    const rec = { id: ++uid, name, hash: ME.io.hashOf(it.buf), type: "unknown" };
    if (ext === "pdf") {
      const text = await pdfText(it.buf); const p = ME.io.parsePdfText(text); rec.pdf = p; rec.invoice = p.invoice || (name.match(/GIS-(\d+)/) || [])[1];
      rec.type = p.account || rec.invoice || /getyourguide/i.test(text) ? "gygpdf" : "unknown"; return rec;
    }
    if (ext === "csv" || ext === "txt" || ext === "xlsx" || ext === "xls") {
      const isText = ext === "csv" || ext === "txt";
      if (isText) { rec.text = new TextDecoder().decode(it.buf); rec.sheets = [{ name: name, rows: U.parseCSV(rec.text) }]; }
      else rec.sheets = ME.io.readWorkbook(it.buf);
      rec.rows = rec.sheets[0] ? rec.sheets[0].rows : [];
      const head = (rec.rows[0] || []).map(U.norm);
      const topCells = rec.sheets.flatMap((s) => s.rows.slice(0, 15).flat()).map(U.norm);
      if (head.includes("confirmation code") && head.includes("service fee")) rec.type = "airbnb";
      else if (/GIS-\d+/i.test(name)) rec.type = "gyg";
      else if (head.includes("payable name") || head.includes("groupon number")) rec.type = "groupon";
      else if (/PAYMENT_DETAILS/i.test(name) && rec.rows.length < 2) rec.type = "empty";
      else if (rec.sheets.some((s) => /empire\s*20\d\d/i.test(s.name))) rec.type = "depreciation";
      else if (topCells.includes("base amount")) rec.type = "xola";
      else if (rec.sheets.some((s) => /loan calc/i.test(s.name)) || /23014|amortization/i.test(name)) rec.type = "sia";
      else if (rec.sheets.some((s) => /interest accrual/i.test(s.name)) || (/jonathan/i.test(name) && /interest/i.test(name))) rec.type = "jonathanwb";
      else if (/ventrata|shoreline/i.test(name)) rec.type = "shoreline";
     
      return rec;
    }
    return rec;
  }
  async function ingest(list) {
    const items = await readFiles(list); let added = 0, dup = 0;
    for (const it of items) {
      try {
        const rec = await classify(it);
        if (state.files.some((f) => f.hash === rec.hash && f.name === rec.name)) { dup++; continue; }
        state.files.push(rec); added++;
      } catch (e) { toast(`Could not read ${it.name}: ${e.message}`); }
    }
    state.stale = true; autoShoreline(); renderClose(); toast(`${added} file${added === 1 ? "" : "s"} added${dup ? `, ${dup} already there` : ""}.`);
  }
  const filesOf = (...t) => state.files.filter((f) => t.includes(f.type));
  function autoShoreline() {   // pick the product and revenue columns of a Ventrata report by header wording
    const f = filesOf("shoreline")[0]; if (!f || !f.sheets) return; const sh = f.sheets[0];
    const hdr = Math.max(0, sh.rows.findIndex((r) => r.filter((x) => typeof x === "string" && x.trim()).length >= 3)); const ix = U.indexHeaders(sh.rows[hdr] || []);
    state.shr.hdr = hdr; state.shr.prod = U.findCol(ix, /product|tour|experience|item/); state.shr.amt = U.findCol(ix, /^(total|amount|revenue|sales|gross)|price/);
  }

  /* ================= live FX (ECB reference rates via Frankfurter) ================= */
  async function loadFx(month) {
    const url = `https://api.frankfurter.dev/v1/${month}-01..${U.lastDate(month)}?base=USD&symbols=EUR,GBP`;
    try {
      const ctrl = new AbortController(); const t = setTimeout(() => ctrl.abort(), 12000);
      const r = await fetch(url, { signal: ctrl.signal }); clearTimeout(t); if (!r.ok) throw new Error("HTTP " + r.status);
      const d = await r.json(); const out = { live: true, fetchedAt: new Date().toISOString(), source: "ECB reference rates via Frankfurter" };
      for (const cur of ["EUR", "GBP"]) { const v = Object.entries(d.rates || {}).filter(([k]) => k.startsWith(month)).map(([, x]) => x[cur]).filter(Boolean); if (v.length) { out[cur] = Math.round(v.length / v.reduce((a, b) => a + b, 0) * 1e4) / 1e4; out["days" + cur] = v.length; } }
      if (!out.EUR || !out.GBP) throw new Error("no rates for this month");
      LS.set("med-fx-" + month, JSON.stringify(out)); return out;
    } catch (e) {
      let c = null; try { c = JSON.parse(LS.get("med-fx-" + month) || "null"); } catch (x) { /* ignore */ }
      if (c) return { ...c, live: false, note: `Live fetch failed (${e.message}); using the rates fetched on ${c.fetchedAt.slice(0, 10)}.` };
      return { live: false, failed: true, note: `Could not reach the rate service (${e.message}). Type the rates below, or check your connection and process again.` };
    }
  }

  /* ================= building every journal ================= */
  const ORDER = ["gyg", "groupon", "airbnb", "jonathan", "sia", "depreciation", "cfl", "shoreline", "amort"];
  const dollars = (s) => (s === "" || s === null ? 0 : cents(s));
  const BUILD = {
    gyg() {
      const inv = filesOf("gyg"); if (!inv.length) return [];
      const pdfs = {}; filesOf("gygpdf").forEach((f) => { if (f.invoice) pdfs[f.invoice] = f.pdf; });
      return [ME.buildGyg(state.month, inv.map((f) => ({ name: f.name, hash: f.hash, rows: f.rows })), pdfs, settings, state.overrides)];
    },
    groupon() { const fs = filesOf("groupon", "empty"); return fs.some((f) => f.type === "groupon") ? [ME.buildGroupon(state.month, fs.map((f) => ({ name: f.name, rows: f.rows || [] })), settings)] : []; },
    airbnb() { const fs = filesOf("airbnb"); return fs.length ? [ME.buildAirbnb(state.month, fs.map((f) => f.text || f.rows.map((r) => r.map((x) => U.csvEscape(x === null || x === undefined ? "" : x)).join(",")).join("\n")), settings)] : []; },
    depreciation() { const f = filesOf("depreciation")[0]; return f ? [ME.buildDepreciation(state.month, f.sheets, settings)] : []; },
    jonathan() {
      const s = state.jon; if (s.opening === "" && !s.moves.some((m) => m.date && m.amt !== "")) return [];
      return [ME.buildJonathan(state.month, dollars(s.opening), s.moves.filter((m) => m.date && m.amt !== "").map((m) => ({ date: m.date, delta: cents(m.amt) })), settings)];
    },
    sia() {
      const s = state.sia, wb = filesOf("sia")[0]; let ic = 0;
      if (wb) { const r = ME.sia.fromWorkbook(wb.sheets, state.month); if (r) ic = r.cents; else { const j = new ME.Journal("sia", "23014 Note Payable - SIA interest (accrual)", "SIA", U.lastDate(state.month)); j.errors.push("The workbook has no row with a date in the closing month and an Interest column. Type the balance below instead."); if (s.balance === "" && s.direct === "") return [j]; } }
      if (!ic && s.direct !== "") ic = cents(s.direct); if (!ic && s.balance !== "") ic = ME.sia.fromBalance(cents(s.balance), +s.rate);
      return ic ? ME.buildSia(state.month, ic, settings) : [];
    },
    amort() { return state.amort.amount !== "" ? [ME.buildAmort(state.month, dollars(state.amort.amount), settings)] : []; },
    shoreline() {
      const f = filesOf("shoreline")[0], s = state.shr; let rev = 0;
      if (f && s.prod >= 0 && s.amt >= 0) rev = ME.shoreline.sumRevenue(f.sheets[0], s.hdr, s.prod, s.amt, settings.shoreline).total; else if (s.manual !== "") rev = cents(s.manual);
      return rev ? [ME.buildShoreline(state.month, rev, settings)] : [];
    },
    cfl() {
      const c = state.cfl, m = state.month, last = U.lastDate(m), xf = filesOf("xola")[0];
      if (c.total !== "") {   // Connor's actual has arrived: reverse the estimate and book the actual
        const est = state.cflEst || {};
        return [ME.buildCflActual(m, { total: dollars(c.total), ad: dollars(c.adActual), priorGross: c.priorGross !== "" ? dollars(c.priorGross) : est.gross || 0, priorAd: c.priorAd !== "" ? dollars(c.priorAd) : est.ad || 0 }, settings)];
      }
      let base = 0, validation = null, scan = null, size = null; state.cflScan = null;
      const xfs = filesOf("xola");
      const best = (from, to) => { let b = null; for (const f of xfs) { const r = ME.cfl.scan(f.sheets, from, to, settings.cfl); r.file = f.name; if (!b || (!r.error && (b.error || r.rows > b.rows))) b = r; } return b; };
      if (xfs.length) {
        const second = best(`${m}-16`, last), first = best(`${m}-01`, `${m}-15`);
        state.cflScan = { second, first };
        if (second.error) { const j = new ME.Journal("cfl", "CFL accrual (16th to month end)", `CFL-${m.replace("-", "")}`, last); j.errors.push(second.error); return [j]; }
        base = second.base; scan = second;
        const cb = c.baseFirst !== "" ? dollars(c.baseFirst) : c.cppFirst !== "" ? Math.round(dollars(c.cppFirst) / (settings.cfl.cppPct / 100)) : 0;
        validation = first.rows > 0 || !cb ? ME.cfl.validate(first.base, cb) : { level: "nofile" };
        size = ME.cfl.sizeCheck(second, (settings.cflSize || {})[U.prevMonth(m)], settings.cfl);
        if (size.level === "ok" && second.rows) { settings.cflSize = settings.cflSize || {}; settings.cflSize[m] = { rows: second.rows, pax: Math.round(second.pax) }; saveSettings(); }
      } else if (c.manualBase !== "") base = dollars(c.manualBase); else return [];
      const j = ME.buildCflEstimate(m, { base, ad: dollars(c.ad), validation: validation && validation.level === "nofile" ? null : validation, size }, settings);
      if (validation && validation.level === "nofile") j.warnings.push("Step 5 check skipped: this export has no 1st-15th rows. Drop a second Xola export for the 1st to 15th to run it. Say so when you hand over.");
      if (scan) {
        if (scan.excluded.outOfRange) j.warnings.push(`Step 2 date check: the export has ${scan.excluded.outOfRange} row(s) dated outside ${m}-16 to ${last} (arrivals ${scan.minArrival} to ${scan.maxArrival}). The filter may not have applied. Only the 16th to month end was used, but confirm the pull is complete.`);
        j.notes.push(`Step 2: Base Amount found in column ${scan.baseCol} of "${scan.sheet}"; ${scan.rows} qualifying reservations${scan.paxFound ? `, ${Math.round(scan.pax)} passengers` : ""}. Xola moved this column during 2026, so confirm it is the Base Amount.`);
        const unk = Object.keys(scan.unknown); if (unk.length) j.warnings.push(`${unk.length} product(s) in the export are not on the CFL list (90-minute tours) or the not-CFL list: ${unk.join("; ")}. Classify them below.`);
      } else j.warnings.push("The base was typed in, not calculated from the Xola export, so the Step 2 check, the product filters and the Step 5 check did not run.");
      state.cflEst = { gross: j.meta.gross, ad: j.meta.ad };
      return [j];
    }
  };
  function buildAll() {
    settings.fx = state.fx && !state.fx.failed ? { [state.month]: { EUR: state.fx.EUR, GBP: state.fx.GBP } } : {};
    ORDER.forEach((id) => {
      let js = []; try { js = BUILD[id](); } catch (e) { console.error(e); const j = new ME.Journal(id, "Error in " + id, id, U.lastDate(state.month)); j.errors.push("Unexpected error: " + e.message); js = [j]; }
      js.forEach((j) => j.check(settings, state.month)); state.results[id] = js;
    });
    const jc = (state.results.jonathan || [])[0]; if (jc && jc.meta && jc.meta.closing !== undefined) LS.set("med-carry", JSON.stringify({ month: state.month, closing: jc.meta.closing }));
  }
  async function processAll() {
    if (state.busy) return; state.busy = true; state.progress = [["Reading files", "now"]]; renderClose();
    const step = (label) => { state.progress.forEach((p) => (p[1] = "ok")); state.progress.push([label, "now"]); renderProgress(); };
    await new Promise((r) => setTimeout(r, 60));
    if (filesOf("gyg").length) { step("Fetching live exchange rates (ECB via Frankfurter)"); state.fx = await loadFx(state.month); } else state.fx = null;
    step("Building the journals and running the SOP checks"); await new Promise((r) => setTimeout(r, 60));
    buildAll(); state.processed = true; state.stale = false; state.busy = false; state.progress = []; renderClose();
    setTimeout(() => { const r = document.getElementById("results"); if (r) r.scrollIntoView({ behavior: "smooth", block: "start" }); }, 50);
  }
  function rebuild() { buildAll(); state.stale = false; renderClose(); }   // after a fix or an override: no new FX fetch

  /* ================= exports ================= */
  function xlsxBlob(j) {
    const wb = XLSX.utils.book_new(), ws = XLSX.utils.aoa_to_sheet(ME.toPostedRows(j));
    ws["!cols"] = [{ wch: 70 }, { wch: 12 }, { wch: 12 }, { wch: 70 }, { wch: 32 }, { wch: 10 }, { wch: 34 }]; XLSX.utils.book_append_sheet(wb, ws, "File");
    return new Blob([XLSX.write(wb, { bookType: "xlsx", type: "array" })], { type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" });
  }
  const allJournals = () => ORDER.flatMap((id) => state.results[id] || []);
  const readyJournals = () => allJournals().filter((j) => j.status !== "blocked" && j.lines.length);
  function reportBlob() {
    const wb = XLSX.utils.book_new(), js = allJournals();
    const sum = [[`Empire Tours month-end close - ${U.monthLabel(state.month)}`], [], ["Entry", "Journal no.", "Date", "Debits", "Credits", "Status"]].concat(js.map((j) => [j.title, j.journalNo, j.date, j.debits / 100, j.credits / 100, j.status]));
    if (state.fx && !state.fx.failed) sum.push([], ["FX used", `EUR ${state.fx.EUR}`, `GBP ${state.fx.GBP}`, state.fx.source, state.fx.live ? "live" : "cached", state.fx.fetchedAt]);
    const s1 = XLSX.utils.aoa_to_sheet(sum); s1["!cols"] = [{ wch: 48 }, { wch: 18 }, { wch: 12 }, { wch: 14 }, { wch: 14 }, { wch: 12 }]; XLSX.utils.book_append_sheet(wb, s1, "Summary");
    const chk = [["Journal", "Level", "Message"]]; js.forEach((j) => { j.errors.forEach((m) => chk.push([j.journalNo, "BLOCKED", m])); j.warnings.forEach((m) => chk.push([j.journalNo, "REVIEW", m])); j.notes.forEach((m) => chk.push([j.journalNo, "Note", m])); });
    const s2 = XLSX.utils.aoa_to_sheet(chk); s2["!cols"] = [{ wch: 16 }, { wch: 10 }, { wch: 140 }]; XLSX.utils.book_append_sheet(wb, s2, "Checks");
    js.forEach((j) => { if (j.lines.length) XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet(ME.toPostedRows(j)), j.journalNo.slice(0, 31)); });
    return new Blob([XLSX.write(wb, { bookType: "xlsx", type: "array" })], { type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" });
  }
  async function downloadAll() {
    const z = new JSZip(), ok = readyJournals(); const folder = z.folder(`Empire_${state.month}_close`);
    ok.forEach((j) => folder.file(`${j.journalNo}.xlsx`, xlsxBlob(j)));
    folder.file(`QBO_journal_import_${state.month}.csv`, ME.toQboCsv(ok, true)); folder.file(`Close_report_${state.month}.xlsx`, reportBlob());
    save(await z.generateAsync({ type: "blob" }), `Empire_${state.month}_month-end.zip`);
  }

  /* ================= UI pieces ================= */
  const TAG = { ok: "OK", review: "Review", blocked: "Blocked" };
  function msgs(j) {
    const items = [...j.errors.map((m) => ["e", "Blocked", m]), ...j.warnings.map((m) => ["w", "Review", m]), ...j.notes.map((m) => ["n", "Note", m])];
    return items.length ? h("ul", { class: "msgs" }, items.map(([c, t, m]) => h("li", { class: c }, h("b", {}, t), m))) : null;
  }
  function fixes(j) {
    return (j.fixes || []).map((f) => {
      const sel = h("select", { "aria-label": "Class for " + f.label }, h("option", { value: "" }, "Choose class…"), settings.classes.allowed.map((c) => h("option", { value: c }, c)));
      return h("div", { class: "fix" }, h("span", {}, `${f.label} needs a class:`), sel, h("button", { class: "btn small primary", onclick: () => { if (!sel.value) return toast("Choose a class first."); applyFix(f, sel.value); } }, "Save and rebuild"));
    });
  }
  function applyFix(f, cls) {
    if (f.type === "airbnb") settings.airbnbListingToClass[f.key] = cls;
    else if (f.type === "groupon") settings.groupPayableToClass[ME.normName(f.key)] = cls;
    else if (f.type === "gyg") settings.gygInvoiceToClass[f.key] = cls;
    saveSettings(); toast("Saved. It will be remembered next month."); rebuild();
  }
  function journalBody(j) {
    const blocked = j.status === "blocked";
    const table = j.lines.length ? h("div", { class: "scroll" }, h("table", {},
      h("thead", {}, h("tr", {}, ["Account", "Debit", "Credit", "Description", "Name", "Class"].map((c, i) => h("th", { class: i === 1 || i === 2 ? "n" : "" }, c)))),
      h("tbody", {}, j.lines.map((l) => h("tr", {}, h("td", { class: "acct" }, l.account || "(account not set)"), h("td", { class: "n" }, l.debit === null ? "" : fmt(l.debit)), h("td", { class: "n" }, l.credit === null ? "" : fmt(l.credit)), h("td", {}, l.description), h("td", {}, l.name), h("td", {}, l.cls)))),
      h("tfoot", {}, h("tr", {}, h("td", {}, "Total"), h("td", { class: "n" }, fmt(j.debits)), h("td", { class: "n" }, fmt(j.credits)), h("td", { colspan: 3 }, ""))))) : null;
    return h("div", { class: "body" }, table, fixes(j), msgs(j),
      h("div", { class: "row", style: "margin-top:12px" },
        h("button", { class: "btn small primary", disabled: blocked || !j.lines.length, onclick: () => save(xlsxBlob(j), `${j.journalNo}.xlsx`) }, "Download .xlsx"),
        h("button", { class: "btn small", disabled: blocked || !j.lines.length, onclick: () => save(new Blob([ME.toQboCsv([j], false)], { type: "text/csv" }), `${j.journalNo}_QBO-import.csv`) }, "QBO import .csv"),
        h("button", { class: "btn small", disabled: !j.lines.length, onclick: () => { navigator.clipboard && navigator.clipboard.writeText(ME.toPostedRows(j).map((r) => r.map((x) => x === null ? "" : x).join("\t")).join("\n")).then(() => toast("Copied. Paste into Excel."), () => toast("Copy blocked by the browser.")); } }, "Copy")));
  }

  /* extra detail under particular journals */
  const EXTRA = {
    gyg() {
      const t = ((state.results.gyg || [])[0] || { meta: {} }).meta.table; if (!t || !t.length) return null;
      return h("details", { class: "set", open: true }, h("summary", {}, "GYG invoices read"), h("div", { class: "scroll" }, h("table", {},
        h("thead", {}, h("tr", {}, ["Invoice", "Service month", "Cur", "Rows", "Commission", "USD", "Class", "How", "PDF"].map((c, i) => h("th", { class: i >= 3 && i <= 5 ? "n" : "" }, c)))),
        h("tbody", {}, t.map((e) => h("tr", { style: e.skip ? "opacity:.55" : "" }, h("td", { class: "mono" }, "GIS-" + e.inv), h("td", {}, e.skip ? `${U.monthLabel(e.svc)} (skipped)` : U.monthLabel(e.svc)), h("td", {}, e.currency), h("td", { class: "n" }, e.rows), h("td", { class: "n" }, fmt(e.comm)), h("td", { class: "n" }, e.usd !== undefined ? fmt(e.usd) : ""),
          h("td", {}, e.skip ? "" : h("select", { onchange: (ev) => { state.overrides[e.inv] = ev.target.value; rebuild(); } }, h("option", { value: "" }, "(choose)"), settings.classes.allowed.map((c) => h("option", { value: c, selected: c === e.cls }, c)))),
          h("td", {}, e.classSource || ""), h("td", {}, e.skip ? "" : e.tied ? "✓ tied" : e.pdf ? "mismatch" : "none")))))));
    },
    jonathan() {
      const j = (state.results.jonathan || [])[0]; if (!j || !j.meta || !j.meta.segs) return null;
      return h("details", { class: "set" }, h("summary", {}, "Interest by period"), h("table", {}, h("thead", {}, h("tr", {}, ["From", "To", "Days", "Balance", "Interest"].map((c, i) => h("th", { class: i > 1 ? "n" : "" }, c)))),
        h("tbody", {}, j.meta.segs.map((g) => h("tr", {}, h("td", {}, `${state.month}-${String(g.from).padStart(2, "0")}`), h("td", {}, `${state.month}-${String(g.to).padStart(2, "0")}`), h("td", { class: "n" }, g.days), h("td", { class: "n" }, fmt(g.balance)), h("td", { class: "n" }, (g.interest / 100).toFixed(4))))),
        h("tfoot", {}, h("tr", {}, h("td", { colspan: 4 }, `Closing balance ${fmt(j.meta.closing)}`), h("td", { class: "n" }, fmt(j.meta.interest))))));
    },
    cfl() {
      if (!state.cflScan || state.cflScan.second.error) return null; const { second, first } = state.cflScan;
      const box = h("details", { class: "set", open: true }, h("summary", {}, "What the Xola export contained"));
      box.append(h("div", { class: "kv" }, h("div", {}, h("small", {}, "Base 16th–end"), h("span", {}, fmt(second.base))), h("div", {}, h("small", {}, "Qualifying rows"), h("span", {}, second.rows)), h("div", {}, h("small", {}, "Base 1st–15th"), h("span", {}, fmt(first.base))), h("div", {}, h("small", {}, "Arrivals in file"), h("span", { style: "font-size:13px" }, `${second.minArrival || "-"} → ${second.maxArrival || "-"}`))));
      const ex = second.excluded; box.append(h("p", { class: "hint" }, `Excluded in the 16th–end window: ${ex.waitlist} waitlist, ${ex.type} non-order, ${ex.status} not confirmed, ${ex.source} from Get Your Guide, ${ex.notCfl} non-CFL products.`));
      const unk = Object.entries(second.unknown);
      if (unk.length) box.append(h("div", { class: "fix", style: "display:block" }, h("b", {}, "Products on neither list. Decide before posting (this list has changed before):"), unk.map(([p, b]) => h("div", { class: "unk" }, h("span", {}, `${p} (${fmt(b)})`), h("button", { class: "btn small", onclick: () => { settings.cfl.products.push(p); saveSettings(); rebuild(); } }, "It's CFL"), h("button", { class: "btn small", onclick: () => { settings.cfl.notCfl.push(p); saveSettings(); rebuild(); } }, "Not CFL")))));
      return box;
    }
  };
  const ENTRY_OF = { gyg: "gyg", groupon: "groupon", airbnb: "airbnb", jonathan: "jonathan", sia: "sia", depreciation: "depreciation", cfl: "cfl", shoreline: "shoreline", amort: "amort" };

  /* ----- tiles: one per SOP entry, showing what is received and what is still needed ----- */
  const ENTRIES = [
    { id: "gyg", sop: "3.1", title: "GetYourGuide", rule: "Book one commission journal per service month. Debit the GYG commission income account by class, credit the GYG clearing account. EUR and GBP invoices use the month-average rate. Invoices are grouped by activity date, so a month is never mixed with another.", hint: "GIS-….xlsx invoices, plus the PDFs for tie-out", types: ["gyg", "gygpdf"] },
    { id: "groupon", sop: "3.1", title: "Groupon", rule: "Commission = what the customer paid less what Groupon paid out, per class (payable name). Month comes from Date Processed. Voided rows are included.", hint: "PAYMENT_DETAILS exports", types: ["groupon", "empty"] },
    { id: "airbnb", sop: "3.1", title: "Airbnb", rule: "Experience bookings only. Commission = Airbnb service fee, by listing class. Payout plus fee must equal gross. Compare the payouts to Chase 6673.", hint: "Transaction History CSV", types: ["airbnb"] },
    { id: "jonathan", sop: "3.2", title: "Jonathan loan interest", rule: "15% a year, simple interest, actual/365, on the daily balance. Take the balance on the 1st from QBO 23021 and list any advances or repayments with their dates.", hint: "Balance on 23021 from QBO", types: ["jonathanwb"], inputs: true },
    { id: "sia", sop: "3.3", title: "23014 SIA interest", rule: "Accrue one month of interest on the note: principal x rate / 12. The tool also makes the reversal dated the 1st of next month.", hint: "Amortization workbook, or balance and rate", types: ["sia"], inputs: true },
    { id: "depreciation", sop: "3.4", title: "Depreciation", rule: "Total depreciation for the month from the Garcia tracker, one debit and credit per asset, with the asset class.", hint: "Garcia depreciation tracker", types: ["depreciation"] },
    { id: "cfl", sop: "3.5", title: "CFL accrual", rule: "Run only if Connor's 16th to month-end report has not arrived (if it has, enter it in the box below and the tool books the actual). Base = Xola Base Amount for arrivals 16th to month end, Type Order, not Waitlist, Status Confirmed, Source not Get Your Guide, 90-minute tours only (the 75-minute tour is Shoreline). Gross to CFL = base x 77% (base + 9% fee - 32% CPP); net accrual = gross less ad spend. Check the export is complete (Step 2) and that the 1st to 15th is within 5% of Connor (Step 5). Credit goes to 20000 A/P with the vendor name.", hint: "Xola Events Export (16th to month end), ad spend, Connor's 1st-15th figure", types: ["xola"], inputs: true },
    { id: "shoreline", sop: "3.5", title: "Shoreline accrual", rule: "Accrue 70% of the non-90-minute cruise revenue from the Ventrata report. The 75-minute tour is included here, and is not in CFL.", hint: "Ventrata report, or the revenue", types: ["shoreline"], inputs: true },
    { id: "amort", sop: "open", title: "Amortization (80000)", rule: "Optional. Only if you know the monthly amortization amount.", hint: "Open item: optional until its source is known", types: [], inputs: true }
  ];
  function readiness(id) {
    const n = (...t) => filesOf(...t).length, R = (t) => ({ s: "ready", t }), P = (t) => ({ s: "partial", t }), W = (t) => ({ s: "waiting", t });
    switch (id) {
      case "gyg": { const a = n("gyg"), p = n("gygpdf"); return !a ? W("Waiting for the invoices") : R(`${a} invoice file${a > 1 ? "s" : ""}${p ? ` · ${p} PDF${p > 1 ? "s" : ""}` : " · no PDFs yet"}`); }
      case "groupon": { const a = n("groupon"); return a ? R(`${a} export${a > 1 ? "s" : ""}${n("empty") ? ` · ${n("empty")} empty ignored` : ""}`) : W("Waiting for the exports"); }
      case "airbnb": return n("airbnb") ? R("CSV received") : W("Waiting for the CSV");
      case "depreciation": return n("depreciation") ? R("Tracker received") : W("Waiting for the tracker");
      case "jonathan": return state.jon.opening !== "" ? R("Balance entered") : W("Enter the 23021 balance");
      case "sia": return n("sia") ? R("Workbook received") : state.sia.balance !== "" || state.sia.direct !== "" ? R("Balance entered") : W("Workbook or balance needed");
      case "cfl": return state.cfl.total !== "" ? R("Actual entered: reverse and rebook") : n("xola") ? (state.cfl.ad !== "" ? R("Export and ad spend received") : P("Add the ad-spend figure")) : state.cfl.manualBase !== "" ? P("Base typed by hand") : W("Waiting for the Xola export");
      case "shoreline": return n("shoreline") && state.shr.prod >= 0 && state.shr.amt >= 0 ? R("Report received") : state.shr.manual !== "" ? R("Revenue entered") : n("shoreline") ? P("Pick the product and revenue columns") : W("Waiting for the report");
      case "amort": return state.amort.amount !== "" ? R("Amount entered") : W("Optional");
    }
  }
  const field = (label, input) => h("label", { class: "field" }, label, input);
  const numIn = (get, set, ph, w) => h("input", { type: "number", step: "0.01", value: get(), placeholder: ph || "", style: `width:${w || 140}px`, oninput: (e) => { set(e.target.value); touched(); } });
  function touched() { state.stale = true; updateTileStatus(); const b = document.getElementById("processBtn"); if (b && state.processed) b.textContent = "Inputs changed. Process again"; }

  function inputsFor(id) {
    if (id === "jonathan") {
      const s = state.jon, moves = h("div", {}); let carry = null; try { carry = JSON.parse(LS.get("med-carry") || "null"); } catch (e) { /* ignore */ }
      const draw = () => { moves.textContent = ""; s.moves.forEach((m, i) => moves.append(h("div", { class: "row", style: "margin-bottom:6px" },
        field(i ? "" : "Date", h("input", { type: "date", value: m.date, min: state.month + "-01", max: U.lastDate(state.month), onchange: (e) => { m.date = e.target.value; touched(); } })),
        field(i ? "" : "Advance (+) or repayment (−), USD", numIn(() => m.amt, (v) => (m.amt = v), "-50000.00", 190)),
        h("button", { class: "btn small", "aria-label": "Remove movement", onclick: () => { s.moves.splice(i, 1); if (!s.moves.length) s.moves.push({ date: "", amt: "" }); draw(); touched(); } }, "Remove")))); }; draw();
      const op = numIn(() => s.opening, (v) => (s.opening = v), "100000.00", 200);
      return [h("div", { class: "row" }, field("Balance on the 1st (USD, from QBO 23021)", op),
        carry && carry.month === U.prevMonth(state.month) ? h("button", { class: "btn small", onclick: () => { s.opening = (carry.closing / 100).toFixed(2); op.value = s.opening; touched(); } }, `Use last month's closing ${fmt(carry.closing)}`) : null),
        h("div", { style: "margin-top:10px" }, moves), h("button", { class: "btn small", onclick: () => { s.moves.push({ date: "", amt: "" }); draw(); } }, "Add advance or repayment"),
        h("p", { class: "hint" }, `${settings.jonathan.ratePct}% p.a. simple, actual/${settings.jonathan.basis}, on the daily balance. Jonathan's workbook ends May 2026, so take the balance and movements from QBO.`)];
    }
    if (id === "sia") { const s = state.sia; return [h("div", { class: "row" }, field("Loan principal at the start of the month (USD)", numIn(() => s.balance, (v) => (s.balance = v), "50000.00", 220)), field("Annual rate %", numIn(() => s.rate, (v) => (s.rate = v), "5.5", 90)), field("…or the interest itself (USD)", numIn(() => s.direct, (v) => (s.direct = v), "229.17", 160))), h("p", { class: "hint" }, "If the amortization workbook is dropped above, its Interest column for this month is used. Otherwise interest = principal × rate ÷ 12. Makes the accrual and its reversal on the 1st.")]; }
    if (id === "cfl") {
      const c = state.cfl; return [h("div", { class: "row" }, field("CFL share of ad spend (USD, Aanand's email)", numIn(() => c.ad, (v) => (c.ad = v), "39988.53", 230)), field("Connor 1st–15th: CPP commission (USD)", numIn(() => c.cppFirst, (v) => (c.cppFirst = v), "", 220)), field("…or his base (USD)", numIn(() => c.baseFirst, (v) => (c.baseFirst = v), "", 150)), !filesOf("xola").length ? field("No export yet? Base 16th–end (USD)", numIn(() => c.manualBase, (v) => (c.manualBase = v), "365612.00", 210)) : null),
        h("details", { style: "margin-top:10px" }, h("summary", {}, "Connor's actual has arrived"), h("div", { class: "row", style: "margin-top:8px" }, field("His total payable to CFL (USD)", numIn(() => c.total, (v) => (c.total = v), "273244.00", 200)), field("Ad spend (USD)", numIn(() => c.adActual, (v) => (c.adActual = v), "", 150)), field("Estimate booked: gross (USD)", numIn(() => c.priorGross, (v) => (c.priorGross = v), "", 170)), field("Estimate's ad credit (USD)", numIn(() => c.priorAd, (v) => (c.priorAd = v), "", 160))), h("p", { class: "hint" }, "Reverses the estimate in full, then books the actual. Leave the estimate boxes empty to use the estimate from this session.")),
        h("details", { style: "margin-top:8px" }, h("summary", {}, "How to pull the Xola export (SOP step 1)"), h("ol", { class: "hint" }, ["Log in to seller.xola.app (authenticator app needed).", "Reports, Analytics, Export Events.", "Arrival Date between the 16th and the last day of the month; Purchase Type is not Waitlist; Status leave all ticked; Type Order.", "Open the Reservations sheet (the one with Base Amount on every line). Ignore the Events sheet.", "For the Step 5 check, pull the same export again for the 1st to 15th and drop both files here."].map((t) => h("li", {}, t)))),
        h("p", { class: "hint" }, "The tool applies the SOP filters itself, checks the dates and size of the export (Step 2), and re-runs the 1st to 15th against Connor: within 5% post, over 5% stop. Without the ad-spend figure it books the cost without the credit. Without Connor's 1st-15th report it skips Step 5 and says so.")];
    }
    if (id === "shoreline") {
      const s = state.shr, f = filesOf("shoreline")[0], hdrRow = f ? f.sheets[0].rows[s.hdr] || [] : [];
      const sel = (k, l) => field(l, h("select", { onchange: (e) => { s[k] = +e.target.value; touched(); } }, h("option", { value: -1 }, "(choose)"), hdrRow.map((x, i) => x !== null ? h("option", { value: i, selected: i === s[k] }, String(x)) : null)));
      return [f ? h("div", { class: "row" }, sel("prod", "Product column"), sel("amt", "Revenue column")) : null, h("div", { class: "row", style: "margin-top:8px" }, field("…or type non-90-minute cruise revenue (USD)", numIn(() => s.manual, (v) => (s.manual = v), "100000.00", 240))),
        h("p", { class: "hint" }, `${settings.shoreline.sharePct}% of non-90-minute cruise revenue. The 75-minute tour stays in Shoreline (it is not part of CFL).`)];
    }
    if (id === "amort") return [field("Monthly amount (USD)", numIn(() => state.amort.amount, (v) => (state.amort.amount = v), "1925.00", 180)), h("p", { class: "hint" }, "QBO shows 1,925.00 in Aug and Sep 2026 but the workings are not in the notes. Set the accumulated-amortization account in Settings before using this.")];
    return null;
  }

  let tileRefs = {};
  function renderTiles(ids) {
    const wrap = h("div", { class: "tiles" });
    for (const e of ENTRIES.filter((x) => ids.includes(x.id))) {
      const st = h("span", { class: "st" }); const body = [];
      const mine = filesOf(...e.types);
      if (mine.length) body.push(h("div", { class: "chips" }, mine.map((f) => h("span", { class: "chip", title: `${f.name} (${TYPES[f.type]})` }, h("span", {}, f.name), h("button", { "aria-label": "Remove " + f.name, onclick: () => { state.files = state.files.filter((x) => x.id !== f.id); state.stale = true; autoShoreline(); renderClose(); } }, "×")))));
      else body.push(h("p", {}, e.hint));
      const inp = e.inputs ? inputsFor(e.id) : null;
      const t = h("div", { class: "tile" }, h("div", { class: "t" }, h("b", {}, e.title), h("span", { class: "sop" }, "SOP " + e.sop), st), body,
        inp ? h("div", { style: "margin-top:8px" }, inp) : null,
        h("details", { class: "rule" }, h("summary", {}, "SOP rule"), h("p", { class: "hint" }, e.rule)));
      tileRefs[e.id] = { t, st }; wrap.append(t);
    }
    updateTileStatus(); return wrap;
  }
  function updateTileStatus() { for (const e of ENTRIES) { const r = tileRefs[e.id]; if (!r) continue; const x = readiness(e.id); r.t.className = "tile " + x.s; r.st.className = "st " + x.s; r.st.textContent = x.t; } }

  function dropzone(compact) {
    const inp = h("input", { type: "file", multiple: true, hidden: true, onchange: () => { if (inp.files.length) ingest([...inp.files]); inp.value = ""; } });
    const z = h("div", { class: "drop" + (compact ? " compact" : ""), tabindex: "0", role: "button", "aria-label": "Add files", onclick: () => inp.click(), onkeydown: (e) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); inp.click(); } },
      ondragover: (e) => { e.preventDefault(); z.classList.add("over"); }, ondragleave: () => z.classList.remove("over"), ondrop: (e) => { e.preventDefault(); z.classList.remove("over"); if (e.dataTransfer.files.length) ingest([...e.dataTransfer.files]); } },
      h("span", { class: "big" }, compact ? "Add more files" : "Drop all of this month's files here"), h("span", {}, compact ? "Drop or click" : "Excel, CSV and PDF reports, or a .zip of them. Each file is recognised automatically."), inp);
    return z;
  }

  /* ----- close page ----- */
  function renderProgress() { const p = document.getElementById("progress"); if (!p) return; p.textContent = ""; state.progress.forEach(([l, s]) => p.append(h("div", { class: s }, (s === "ok" ? "✓ " : "… ") + l))); }
  function renderClose() {
    const m = document.getElementById("main"); m.textContent = ""; tileRefs = {};
    const unk = state.files.filter((f) => f.type === "unknown");
    const n = state.files.length;
    m.append(h("h1", {}, `Month-end close · ${U.monthLabel(state.month)}`), h("p", { class: "sub" }, "Three steps. Nothing is posted to QuickBooks; you import the result yourself after review."));
    const stepHead = (n, t, d) => h("div", { class: "sh" }, h("i", {}, n), h("div", {}, h("h2", {}, t), h("p", {}, d)));
    m.append(h("section", { class: "card" }, stepHead("1", "Add the reports", "Drop everything at once. Each file is recognised for you."), n ? dropzone(true) : dropzone(false), renderTiles(["gyg", "groupon", "airbnb", "depreciation"])));
    m.append(h("section", { class: "card" }, stepHead("2", "Type the numbers only you have", "From QBO and the emails. Leave an entry blank to skip it."), renderTiles(["jonathan", "sia", "cfl", "shoreline"]),
      h("details", { style: "margin-top:12px" }, h("summary", {}, "Optional: Amortization (80000)"), h("div", { style: "margin-top:8px" }, renderTiles(["amort"])))));
    if (unk.length) m.append(h("section", { class: "card" }, h("h2", {}, "Files I could not recognise"), unk.map((f) => h("div", { class: "unk" }, h("b", {}, f.name), h("span", {}, "is a"), h("select", { onchange: (e) => { f.type = e.target.value; if (f.type === "gyg" && !f.rows) f.rows = f.sheets ? f.sheets[0].rows : []; autoShoreline(); state.stale = true; renderClose(); } }, Object.entries(TYPES).filter(([k]) => k !== "empty").map(([k, v]) => h("option", { value: k, selected: k === f.type }, v))), h("button", { class: "btn small", onclick: () => { state.files = state.files.filter((x) => x.id !== f.id); renderClose(); } }, "Remove")))));
    m.append(h("section", { class: "card" }, stepHead("3", "Process", "Gets live exchange rates, picks the classes, builds every journal and runs the SOP checks."), h("div", { class: "processbar" }, h("button", { id: "processBtn", class: "btn primary big", disabled: state.busy, onclick: processAll }, state.busy ? "Processing…" : state.processed ? (state.stale ? "Inputs changed. Process again" : "Process again") : "Process month-end"),
      h("span", { class: "hint", style: "margin:0" }, n ? "" : "Add files to begin.")), h("div", { id: "progress", class: "progress" })));
    renderProgress();
    if (state.processed) m.append(renderResults());
    renderDock();
  }
  
  function renderResults() {
    const box = h("div", { id: "results" }); const js = allJournals();
    if (!js.length) { box.append(h("section", { class: "card" }, h("p", { class: "hint" }, "Nothing could be built yet. Add the inputs shown as waiting above."))); return box; }
    const nb = js.filter((j) => j.status === "blocked").length, nr = js.filter((j) => j.status === "review").length;
    box.append(h("div", { class: "kv" }, h("div", {}, h("small", {}, "Journals"), h("span", {}, js.length)), h("div", {}, h("small", {}, "Ready"), h("span", { style: "color:var(--ok)" }, js.length - nb - nr)), h("div", {}, h("small", {}, "Need review"), h("span", { style: "color:var(--warn)" }, nr)), h("div", {}, h("small", {}, "Blocked"), h("span", { style: "color:var(--bad)" }, nb))));
    if (filesOf("gyg").length) box.append(fxCard());
    const skipped = ORDER.filter((id) => !(state.results[id] || []).length);
    for (const id of ORDER) for (const j of state.results[id] || []) {
      const extra = EXTRA[ENTRY_OF[id]] ? EXTRA[ENTRY_OF[id]]() : null;
      const d = h("details", { class: "jc", open: j.status !== "ok" || undefined }, h("summary", {}, h("span", { class: "nm" }, j.title), h("span", { class: "no" }, `${j.journalNo} · ${j.date}`), h("span", { class: `tag ${j.status}` }, TAG[j.status]), h("span", { class: "amt" }, fmt(j.debits))), journalBody(j));
      if (extra) d.querySelector(".body").prepend(extra); box.append(d);
    }
    if (skipped.length) box.append(h("p", { class: "hint" }, "Not built (waiting for inputs): " + skipped.map((id) => ENTRIES.find((e) => e.id === id).title).join(", ") + "."));
    box.append(h("p", { class: "hint" }, "Entries are dated the last day of the month; reversals the 1st of next month. Import each journal into QuickBooks by hand after review (SOP: never post directly)."));
    return box;
  }
  function fxCard() {
    const f = state.fx; if (!f) return document.createComment("");
    const set = (cur) => (e) => { state.fx = { ...state.fx, failed: false, live: false, source: "typed by you", [cur]: parseFloat(e.target.value) || undefined, note: "" }; rebuild(); };
    return h("section", { class: "card" }, h("h2", {}, `Exchange rates for ${U.monthLabel(state.month)} (USD per 1 unit, month average)`),
      h("div", { class: "fxbar" }, f.failed ? h("span", { class: "live off" }, "No live rates") : f.live ? h("span", { class: "live" }, "Live") : h("span", { class: "live off" }, f.source === "typed by you" ? "Manual" : "Cached"),
        field("EUR", h("input", { type: "number", step: "0.0001", value: f.EUR || "", onchange: set("EUR"), style: "width:110px" })), field("GBP", h("input", { type: "number", step: "0.0001", value: f.GBP || "", onchange: set("GBP"), style: "width:110px" })),
        h("span", { class: "hint", style: "margin:0" }, f.failed ? "" : `${f.source}${f.fetchedAt ? ` · fetched ${f.fetchedAt.slice(0, 16).replace("T", " ")} UTC` : ""}${f.daysEUR ? ` · ${f.daysEUR} rate days` : ""}`)),
      f.note ? h("p", { class: "hint" }, f.note) : null, h("p", { class: "hint" }, "Fetched fresh on every Process, never stored as a fixed value. USD invoices need no rate. You can overwrite a rate here if Dhwani uses a different source."));
  }
  function renderDock() {
    const old = document.querySelector(".dock"); if (old) old.remove(); if (!state.processed || state.page !== "close") return;
    const ok = readyJournals(), all = allJournals();
    document.body.append(h("div", { class: "dock" }, h("button", { class: "btn primary", disabled: !ok.length, onclick: downloadAll }, "Download everything (.zip)"),
      h("button", { class: "btn", disabled: !ok.length, onclick: () => save(new Blob([ME.toQboCsv(ok, true)], { type: "text/csv" }), `Empire_${state.month}_QBO-import.csv`) }, "QBO import (.csv)"),
      h("button", { class: "btn", disabled: !all.length, onclick: () => save(reportBlob(), `Close_report_${state.month}.xlsx`) }, "Close report (.xlsx)"),
      h("button", { class: "btn", onclick: () => { const t = JSON.parse(JSON.stringify(settings.history)); all.forEach((j) => { if (j.status !== "blocked" && !/REV|ACT/.test(j.journalNo)) { t[j.key] = t[j.key] || {}; t[j.key][state.month] = j.debits; } }); settings.history = t; saveSettings(); toast("Saved this month's totals for next month's 30% check."); } }, "Save totals for next month's check"),
      h("span", { class: "sp" }, `${ok.length} of ${all.length} journals can be downloaded`)));
  }

  /* ----- checklist page ----- */
  const CHECKS = ["QBO P&L for the close month vs the previous period (by Classes, then Total Only).", "Balance Sheet at month end vs prior month end.", "Drill into 21090 (Shoreline) and into 20000 A/P for CHICAGO FROM THE LAKE, LTD_CFL to confirm both accruals posted.", "Clearing sub-accounts: Xola (10031) should be near nil. Do not test any portal against one month's invoice.", "21085 VAT Payable is flat at 63,220.62 until it clears in September: expected, do not flag.", "21090 carries an unexplained residual of 786.00: known, still unidentified.", "Every new vendor is logged in the New Vendor List and sent to Jonathan weekly; no transaction posts without a vendor.", "Slack reminder on the 4th covers both accruals (CFL and Shoreline).", "Working file attached to each posted journal."];
  const OPEN = [["FX basis for GYG GBP/EUR invoices", "The tool uses the live monthly average of ECB rates. August EUR matches the posted journal exactly; GBP can differ by 0.0001. Confirm with Dhwani."], ["23014 interest account and accrual convention", "open"], ["Source of the 80000 Amortization entry (1,925.00 a month)", "open"], ["Charters in the second half of the month are missing from the Xola export", "Ask Aanand or Louise for a count at close if the amounts are material."], ["CFL: the posted September journal (gross 306,387.43) matches neither the new SOP example (gross 281,521.24, base 365,612.00) nor the 181,467 estimate in its tracking table", "Confirm which figure was actually posted for September."]];
  function renderChecklist() {
    const m = document.getElementById("main"); m.textContent = ""; m.append(h("h1", {}, "Review before sending to Jonathan"), h("p", { class: "sub" }, "SOP section 5, plus the open items from section 6."));
    const key = "med-checks-" + state.month; let done = {}; try { done = JSON.parse(LS.get(key) || "{}"); } catch (e) { /* ignore */ }
    m.append(h("section", { class: "card" }, h("h2", {}, `Checklist for ${U.monthLabel(state.month)}`), CHECKS.map((t, i) => h("label", { class: "check" }, h("input", { type: "checkbox", checked: !!done[i], onchange: (e) => { done[i] = e.target.checked; LS.set(key, JSON.stringify(done)); } }), h("span", {}, t)))));
    m.append(h("section", { class: "card" }, h("h2", {}, "Open items before sign-off"), h("table", {}, h("tbody", {}, OPEN.map(([a, b]) => h("tr", {}, h("td", {}, a), h("td", {}, b === "open" ? h("span", { class: "tag review" }, "Open") : b)))))));
  }

  /* ----- SOP page: the month-end SOP, section by section, as the tool applies it ----- */
  function renderSop() {
    const m = document.getElementById("main"); m.textContent = "";
    m.append(h("h1", {}, "Month-End Entries SOP"), h("p", { class: "sub" }, "The SOP as this tool applies it. Entries are dated the last day of the month; reversals the 1st of next month. Journals are imported into QBO by hand, never posted directly."));
    const box = h("section", { class: "card sopdoc" });
    box.append(h("h2", {}, "How to run the month"), h("ol", {}, ["Pick the closing month and drop every report on the Close tab.", "Type the numbers only you have: Jonathan balance, SIA interest, CFL ad spend and Connor's figure, Shoreline revenue.", "Press Process. Live exchange rates, classes and all checks run for you.", "Review any journal marked Review or Blocked.", "Download, import into QBO, attach the working file, then go through the Checklist tab."].map((t) => h("li", {}, t))));
    for (const e of ENTRIES.filter((x) => x.sop !== "open")) box.append(h("h3", {}, `${e.sop}  ${e.title}`), h("p", {}, e.rule), h("p", { class: "hint" }, `You provide: ${e.hint}.`));
    box.append(h("h3", {}, "4  QBO import format"), h("p", {}, "The download includes a CSV with sequential journal numbers and the date on each journal's first line only. The same journals are also given as .xlsx in the posted layout."));
    box.append(h("h3", {}, "5  Review"), h("p", {}, "Use the Checklist tab: P&L and Balance Sheet against the prior month, drill into the 21090 and CFL payable accounts, clearing accounts, new vendors, and the working file attached to each journal."));
    box.append(h("h3", {}, "Checks the tool runs on every journal"), h("p", {}, "Debits equal credits, only allowed classes, and a 30% variance test against last month's saved total."));
    m.append(box);
  }

  /* ----- settings page ----- */
  const lines = (obj) => Object.entries(obj).map(([k, v]) => `${k} = ${v}`).join("\n");
  const unlines = (t) => Object.fromEntries(t.split(/\r?\n/).map((l) => l.split(/\s=\s/)).filter((p) => p.length >= 2 && p[0].trim()).map((p) => [p[0].trim(), p.slice(1).join(" = ").trim()]));
  const list = (t) => t.split(/\r?\n/).map((s) => s.trim()).filter(Boolean);
  function renderSettings() {
    const m = document.getElementById("main"); m.textContent = "";
    m.append(h("h1", {}, "Settings"), h("p", { class: "sub" }, "Account names, class rules and rates. Saved in this browser only. Classes are normally detected automatically; this is where to correct a rule. Exchange rates are never stored here: they are fetched live on every Process."));
    const txt = (label, get, set, rows) => h("label", { class: "field", style: "margin-bottom:10px" }, label, h("textarea", { rows: rows || 5, onchange: (e) => { set(e.target.value); saveSettings(); toast("Saved."); } }, get()));
    const acc = h("details", { class: "set", open: true }, h("summary", {}, "Accounts (re-confirm against the current chart of accounts before each run)"), h("div", { class: "scroll" }, h("table", {}, h("tbody", {}, Object.keys(settings.accounts).filter((k) => !/viator/i.test(k)).map((k) => h("tr", {}, h("td", { class: "mono" }, k), h("td", {}, h("input", { type: "text", value: settings.accounts[k], placeholder: "not set", style: "width:100%;min-width:380px", onchange: (e) => { settings.accounts[k] = e.target.value.trim(); saveSettings(); } }))))))));
    const nm = h("details", { class: "set" }, h("summary", {}, "Vendor names and classes"), h("div", { class: "row" }, ["gyg", "cfl", "shoreline"].map((k) => field(`Name: ${k}`, h("input", { type: "text", value: settings.names[k], style: "width:260px", onchange: (e) => { settings.names[k] = e.target.value; saveSettings(); } })))), h("div", { class: "row", style: "margin:10px 0" }, ["gygClearing", "boats", "admin"].map((k) => field(`Class: ${k}`, h("input", { type: "text", value: settings.classes[k], style: "width:290px", onchange: (e) => { settings.classes[k] = e.target.value; saveSettings(); } })))), txt("Allowed classes (one per line; anything else blocks the journal)", () => settings.classes.allowed.join("\n"), (v) => (settings.classes.allowed = list(v)), 9));
    const maps = h("details", { class: "set" }, h("summary", {}, "Class rules and remembered classes"),
      txt("Detection rules: regex = class (first match wins; used for GYG products, Groupon payables and Airbnb listings)", () => settings.classRules.map(([a, b]) => `${a} = ${b}`).join("\n"), (v) => (settings.classRules = Object.entries(unlines(v))), 9),
      txt("GYG account number = class (read from the PDF)", () => lines(settings.gygAccountToClass), (v) => (settings.gygAccountToClass = unlines(v)), 8), txt("Remembered GYG invoice = class (added when you pick one)", () => lines(settings.gygInvoiceToClass), (v) => (settings.gygInvoiceToClass = unlines(v)), 3),
      txt("Groupon Payable Name (lower case, no punctuation) = class", () => lines(settings.groupPayableToClass), (v) => (settings.groupPayableToClass = unlines(v)), 6), txt("Airbnb listing = class", () => lines(settings.airbnbListingToClass), (v) => (settings.airbnbListingToClass = unlines(v)), 10), txt("Depreciation asset = class", () => lines(settings.depAssetClass), (v) => (settings.depAssetClass = unlines(v)), 3));
    const rates = h("details", { class: "set" }, h("summary", {}, "CFL, Shoreline, interest, variance"), h("div", { class: "row" }, field("CFL fee %", numIn(() => settings.cfl.feePct, (v) => (settings.cfl.feePct = +v), "", 80)), field("CPP commission %", numIn(() => settings.cfl.cppPct, (v) => (settings.cfl.cppPct = +v), "", 80)), field("Shoreline share %", numIn(() => settings.shoreline.sharePct, (v) => (settings.shoreline.sharePct = +v), "", 80)), field("Jonathan rate %", numIn(() => settings.jonathan.ratePct, (v) => (settings.jonathan.ratePct = +v), "", 80)), field("Day basis", numIn(() => settings.jonathan.basis, (v) => (settings.jonathan.basis = +v), "", 80)), field("Variance limit %", numIn(() => settings.variancePct, (v) => (settings.variancePct = +v), "", 80)), h("button", { class: "btn", onclick: () => { saveSettings(); toast("Saved."); } }, "Apply")),
      txt("CFL products (one per line)", () => settings.cfl.products.join("\n"), (v) => (settings.cfl.products = list(v)), 3), txt("Not CFL (one per line)", () => settings.cfl.notCfl.join("\n"), (v) => (settings.cfl.notCfl = list(v)), 4), txt("Shoreline: leave out products matching (regex, one per line)", () => settings.shoreline.excludePatterns.join("\n"), (v) => (settings.shoreline.excludePatterns = list(v)), 2));
    const io = h("div", { class: "row" }, h("button", { class: "btn", onclick: () => { const c = JSON.parse(JSON.stringify(settings)); delete c.fx; save(new Blob([JSON.stringify(c, null, 2)], { type: "application/json" }), "month-end-settings.json"); } }, "Export settings"),
      h("label", { class: "btn" }, "Import settings", h("input", { type: "file", accept: ".json", hidden: true, onchange: async (e) => { try { settings = merge(JSON.parse(JSON.stringify(ME.DEFAULTS)), JSON.parse(await e.target.files[0].text())); settings.fx = {}; saveSettings(); renderSettings(); toast("Settings imported."); } catch (err) { toast("Not a valid settings file."); } } })),
      h("button", { class: "btn", onclick: () => { if (confirm("Reset all settings and remembered classes to the built-in defaults?")) { settings = JSON.parse(JSON.stringify(ME.DEFAULTS)); settings.fx = {}; saveSettings(); renderSettings(); } } }, "Reset to defaults"));
    m.append(h("section", { class: "card" }, acc, nm, maps, rates, io));
  }

  /* ----- shell ----- */
  function renderTabs() { const t = document.getElementById("tabs"); t.textContent = ""; [["close", "Close"], ["sop", "SOP"], ["check", "Checklist"], ["settings", "Settings"]].forEach(([id, l]) => t.append(h("button", { "aria-current": state.page === id ? "page" : null, onclick: () => go(id) }, l))); }
  function go(page) { state.page = page; renderTabs(); if (page === "close") renderClose(); else { const d = document.querySelector(".dock"); if (d) d.remove(); page === "check" ? renderChecklist() : page === "sop" ? renderSop() : renderSettings(); } window.scrollTo(0, 0); try { history.replaceState(null, "", "#" + page); } catch (e) { /* file:// */ } }
  const mi = document.getElementById("month"); mi.value = state.month;
  mi.addEventListener("change", () => { if (!mi.value) return; state.month = mi.value; LS.set("med-month", state.month); state.results = {}; state.processed = false; state.fx = null; state.overrides = {}; state.cflEst = null; state.cflScan = null; go(state.page); });
  window.MED = { state, settings: () => settings, ME, processAll };
  const start = location.hash.slice(1); renderTabs(); go(["close", "sop", "check", "settings"].includes(start) ? start : "close");
})();
