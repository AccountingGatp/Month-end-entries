(function () {
  "use strict";
  const ME = window.ME, U = ME.U;

  /* ---------- tiny DOM helper (text is always set as text, never as HTML) ---------- */
  const PROPS = new Set(["value", "checked", "disabled", "selected", "textContent"]);
  function h(tag, attrs, ...kids) {
    const e = document.createElement(tag);
    for (const [k, v] of Object.entries(attrs || {})) {
      if (v === null || v === undefined || v === false) continue;
      if (k === "class") e.className = v;
      else if (k.startsWith("on")) e.addEventListener(k.slice(2), v);
      else if (PROPS.has(k)) e[k] = v;
      else e.setAttribute(k, v === true ? "" : v);
    }
    for (const kid of kids.flat(3)) { if (kid === null || kid === undefined || kid === false) continue; e.append(kid.nodeType ? kid : document.createTextNode(String(kid))); }
    return e;
  }
  const toastEl = document.getElementById("toast"); let tt;
  const toast = (m) => { toastEl.textContent = m; toastEl.classList.add("show"); clearTimeout(tt); tt = setTimeout(() => toastEl.classList.remove("show"), 2600); };
  const save = (blob, name) => { const a = h("a", { href: URL.createObjectURL(blob), download: name }); document.body.append(a); a.click(); a.remove(); setTimeout(() => URL.revokeObjectURL(a.href), 3000); };
  const fmt = U.fmt, cents = U.cents;

  /* ---------- settings (kept in this browser only) ---------- */
  const LS = { get(k) { try { return localStorage.getItem(k); } catch (e) { return null; } }, set(k, v) { try { localStorage.setItem(k, v); } catch (e) { /* private mode */ } } };
  const merge = (a, b) => { for (const k of Object.keys(b || {})) { if (b[k] && typeof b[k] === "object" && !Array.isArray(b[k])) a[k] = merge(a[k] && typeof a[k] === "object" ? a[k] : {}, b[k]); else a[k] = b[k]; } return a; };
  let settings = merge(JSON.parse(JSON.stringify(ME.DEFAULTS)), (() => { try { return JSON.parse(LS.get("med-settings") || "{}"); } catch (e) { return {}; } })());
  const saveSettings = () => LS.set("med-settings", JSON.stringify(settings));

  const now = new Date(); const prev = U.prevMonth(`${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}`);
  const state = {
    month: LS.get("med-month") || prev, active: "dashboard", results: {}, overrides: {},
    gyg: { invoices: [], pdfs: {}, names: [] }, groupon: [], airbnb: null, dep: null,
    jon: { opening: "", moves: [{ date: "", amt: "" }] },
    sia: { method: "balance", balance: "", rate: 5.5, direct: "", wb: null },
    cfl: { mode: "estimate", xola: null, xolaName: "", ad: "", cppFirst: "", baseFirst: "", manualBase: "", total: "", adActual: "", priorGross: "", priorAd: "", date: "" },
    shr: { sheet: null, name: "", hdr: 0, prod: -1, amt: -1, manual: "" },
    via: { rows: [{ cls: "", gross: "", net: "", diff: "" }], balance: "", sales: "" },
    amort: { amount: "" }
  };
  let outEl = null;

  /* ---------- file helpers ---------- */
  async function readFiles(list) {
    const out = [];
    for (const f of list) {
      if (/\.zip$/i.test(f.name)) {
        const z = await JSZip.loadAsync(await f.arrayBuffer());
        for (const [p, en] of Object.entries(z.files)) if (!en.dir && !/__MACOSX|\/\./.test(p)) out.push({ name: p.split("/").pop(), buf: await en.async("arraybuffer") });
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
  function dropzone(label, accept, multiple, onFiles) {
    const inp = h("input", { type: "file", accept, multiple, hidden: true, onchange: () => { if (inp.files.length) onFiles([...inp.files]); inp.value = ""; } });
    const z = h("div", { class: "drop", tabindex: "0", role: "button", onclick: () => inp.click(), onkeydown: (e) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); inp.click(); } },
      ondragover: (e) => { e.preventDefault(); z.classList.add("over"); }, ondragleave: () => z.classList.remove("over"),
      ondrop: (e) => { e.preventDefault(); z.classList.remove("over"); if (e.dataTransfer.files.length) onFiles([...e.dataTransfer.files]); } },
      h("b", {}, label), h("div", {}, "Drop here or click to choose"), inp);
    return z;
  }
  const chips = (names) => names.length ? h("div", { class: "chips" }, names.slice(0, 40).map((n) => h("span", { class: "chip", title: n }, n)), names.length > 40 ? h("span", { class: "chip" }, `+${names.length - 40} more`) : null) : null;

  /* ---------- result rendering ---------- */
  const TAG = { ok: "OK", review: "Review", blocked: "Blocked" };
  function msgs(j) {
    const items = [...j.errors.map((m) => ["e", "Blocked", m]), ...j.warnings.map((m) => ["w", "Review", m]), ...j.notes.map((m) => ["n", "Note", m])];
    return items.length ? h("ul", { class: "msgs" }, items.map(([c, t, m]) => h("li", { class: c }, h("b", {}, t), m))) : null;
  }
  function journalCard(j) {
    const blocked = j.status === "blocked";
    const body = j.lines.length ? h("div", { class: "scroll" }, h("table", {},
      h("thead", {}, h("tr", {}, ["Account", "Debit", "Credit", "Description", "Name", "Class"].map((c, i) => h("th", { class: i === 1 || i === 2 ? "n" : "" }, c)))),
      h("tbody", {}, j.lines.map((l) => h("tr", {}, h("td", { class: "acct" }, l.account || "(not set)"), h("td", { class: "n" }, l.debit === null ? "" : fmt(l.debit)), h("td", { class: "n" }, l.credit === null ? "" : fmt(l.credit)), h("td", {}, l.description), h("td", {}, l.name), h("td", {}, l.cls)))),
      h("tfoot", {}, h("tr", {}, h("td", {}, "Total"), h("td", { class: "n" }, fmt(j.debits)), h("td", { class: "n" }, fmt(j.credits)), h("td", { colspan: 3 }, "")))))
      : h("p", { class: "hint" }, "No lines yet.");
    return h("section", { class: "card" },
      h("div", { class: "row", style: "justify-content:space-between;align-items:center;margin-bottom:10px" },
        h("div", {}, h("h2", { style: "margin:0" }, j.title), h("div", { class: "mono", style: "color:var(--muted)" }, `${j.journalNo} · dated ${j.date}`)),
        h("span", { class: `tag ${j.status}` }, TAG[j.status])),
      body, msgs(j) ? h("div", { style: "margin-top:12px" }, msgs(j)) : null,
      h("div", { class: "actions" },
        h("button", { class: "btn primary", disabled: blocked || !j.lines.length, onclick: () => downloadXlsx(j) }, "Download .xlsx (posted layout)"),
        h("button", { class: "btn", disabled: blocked || !j.lines.length, onclick: () => save(new Blob([ME.toQboCsv([j], false)], { type: "text/csv" }), `${j.journalNo}_QBO-import.csv`) }, "QBO import .csv"),
        h("button", { class: "btn", disabled: !j.lines.length, onclick: () => { navigator.clipboard && navigator.clipboard.writeText(ME.toPostedRows(j).map((r) => r.map((x) => x === null ? "" : x).join("\t")).join("\n")).then(() => toast("Copied. Paste into Excel."), () => toast("Copy blocked by the browser.")); } }, "Copy")));
  }
  function xlsxBlob(j) {
    const wb = XLSX.utils.book_new(); const ws = XLSX.utils.aoa_to_sheet(ME.toPostedRows(j));
    ws["!cols"] = [{ wch: 70 }, { wch: 12 }, { wch: 12 }, { wch: 70 }, { wch: 32 }, { wch: 10 }, { wch: 34 }];
    XLSX.utils.book_append_sheet(wb, ws, "File");
    return new Blob([XLSX.write(wb, { bookType: "xlsx", type: "array" })], { type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" });
  }
  const downloadXlsx = (j) => save(xlsxBlob(j), `${j.journalNo}.xlsx`);

  /* ---------- run engines ---------- */
  const ORDER = ["gyg", "groupon", "airbnb", "viator", "jonathan", "sia", "depreciation", "cfl", "shoreline", "amort"];
  const dollars = (s) => (s === "" || s === null ? 0 : cents(s));

  const RUN = {
    gyg() { return state.gyg.invoices.length ? [ME.buildGyg(state.month, state.gyg.invoices, state.gyg.pdfs, settings, state.overrides)] : []; },
    groupon() { return state.groupon.length ? [ME.buildGroupon(state.month, state.groupon, settings)] : []; },
    airbnb() { return state.airbnb ? [ME.buildAirbnb(state.month, state.airbnb, settings)] : []; },
    depreciation() { return state.dep ? [ME.buildDepreciation(state.month, state.dep, settings)] : []; },
    jonathan() {
      const s = state.jon; if (s.opening === "" && !s.moves.some((m) => m.date && m.amt !== "")) return [];
      return [ME.buildJonathan(state.month, dollars(s.opening), s.moves.filter((m) => m.date && m.amt !== "").map((m) => ({ date: m.date, delta: cents(m.amt) })), settings)];
    },
    sia() {
      const s = state.sia; let ic = 0, src = "";
      if (s.method === "balance" && s.balance !== "") { ic = ME.sia.fromBalance(cents(s.balance), +s.rate); }
      else if (s.method === "direct" && s.direct !== "") ic = cents(s.direct);
      else if (s.method === "workbook" && s.wb) { const r = ME.sia.fromWorkbook(s.wb, state.month); if (r) ic = r.cents; else { const j = new ME.Journal("sia", "23014 Note Payable - SIA interest (accrual)", "SIA", U.lastDate(state.month)); j.errors.push("No row dated in the closing month with an Interest column was found in the workbook."); return [j]; } }
      return ic ? ME.buildSia(state.month, ic, settings) : [];
    },
    amort() { return state.amort.amount !== "" ? [ME.buildAmort(state.month, dollars(state.amort.amount), settings)] : []; },
    viator() {
      const rows = state.via.rows.filter((r) => r.cls && (r.gross !== "" || r.net !== "")).map((r) => ({ cls: r.cls, gross: dollars(r.gross), net: dollars(r.net), diff: dollars(r.diff) }));
      return rows.length ? [ME.buildViator(state.month, rows, settings)] : [];
    },
    shoreline() {
      const s = state.shr; let rev = 0;
      if (s.sheet && s.prod >= 0 && s.amt >= 0) rev = ME.shoreline.sumRevenue(s.sheet, s.hdr, s.prod, s.amt, settings.shoreline).total;
      else if (s.manual !== "") rev = cents(s.manual);
      return rev ? [ME.buildShoreline(state.month, rev, settings)] : [];
    },
    cfl() {
      const c = state.cfl;
      if (c.mode === "actual") {
        const est = (state.cflEst && state.cflEst.meta) || {};
        const p = { total: dollars(c.total), ad: dollars(c.adActual), priorGross: c.priorGross !== "" ? dollars(c.priorGross) : (est.gross || 0), priorAd: c.priorAd !== "" ? dollars(c.priorAd) : (est.ad || 0), date: c.date || null };
        return c.total === "" ? [] : [ME.buildCflActual(state.month, p, settings)];
      }
      let base = 0, validation = null, scanInfo = null;
      const m = state.month, last = U.lastDate(m);
      if (c.xola) {
        const second = ME.cfl.scan(c.xola, `${m}-16`, last, settings.cfl);
        const first = ME.cfl.scan(c.xola, `${m}-01`, `${m}-15`, settings.cfl);
        state.cflScan = { second, first };
        if (second.error) { const j = new ME.Journal("cfl", "CFL accrual (16th to month end)", `CFL-${m.replace("-", "")}`, last); j.errors.push(second.error); return [j]; }
        base = second.base;
        let cb = c.baseFirst !== "" ? dollars(c.baseFirst) : c.cppFirst !== "" ? Math.round(dollars(c.cppFirst) / (settings.cfl.cppPct / 100)) : 0;
        validation = ME.cfl.validate(first.base, cb); if (validation.level === "missing") validation = { level: "missing" };
        scanInfo = second;
      } else if (c.manualBase !== "") base = dollars(c.manualBase);
      if (!base && !c.xola) return [];
      const j = ME.buildCflEstimate(m, { base, ad: dollars(c.ad), validation }, settings);
      if (scanInfo) {
        if (scanInfo.maxArrival && scanInfo.maxArrival > last) j.warnings.push(`The export runs to ${scanInfo.maxArrival}, beyond month end. Rows outside ${m}-16 to ${last} are excluded, but check the pull covered the right period.`);
        const unk = Object.keys(scanInfo.unknown); if (unk.length) j.warnings.push(`${unk.length} product(s) in the export are not on the CFL or non-CFL list: ${unk.join("; ")}. Classify them below. This list has changed before.`);
      }
      if (!c.xola) j.warnings.push("The base was typed in, not calculated from the Xola Events Export, so the product filters and the 1st-15th validation did not run.");
      state.cflEst = { meta: j.meta };
      return [j];
    }
  };
  function run(id) {
    let js = []; try { js = RUN[id](); } catch (e) { console.error(e); const j = new ME.Journal(id, "Error", id, U.lastDate(state.month)); j.errors.push("Unexpected error: " + e.message); js = [j]; }
    js.forEach((j) => j.check(settings, state.month));
    state.results[id] = js; chrome(); if (state.active === id) drawOut();
  }
  const runAll = () => ORDER.forEach(run);

  /* ---------- sidebar ---------- */
  const NAV = [
    ["Overview", [["dashboard", "Dashboard"], ["review", "Review & open items"]]],
    ["3.1 Commissions", [["gyg", "GetYourGuide"], ["groupon", "Groupon"], ["airbnb", "Airbnb"], ["viator", "Viator"]]],
    ["3.2 – 3.4 Books", [["jonathan", "Jonathan loan interest"], ["sia", "SIA note interest"], ["depreciation", "Depreciation"], ["amort", "Amortization"]]],
    ["3.5 Accruals", [["cfl", "CFL accrual"], ["shoreline", "Shoreline accrual"]]],
    ["Setup", [["settings", "Settings"]]]
  ];
  function chrome() {
    const nav = document.getElementById("nav"); nav.textContent = "";
    for (const [g, items] of NAV) {
      nav.append(h("div", { class: "grp" }, g));
      for (const [id, label] of items) {
        const js = state.results[id] || []; const st = !js.length ? "" : js.some((j) => j.status === "blocked") ? "blocked" : js.some((j) => j.status === "review") ? "review" : "ok";
        const amt = js.length && ORDER.includes(id) ? fmt(js[0].debits) : "";
        nav.append(h("button", { "aria-current": state.active === id ? "page" : null, onclick: () => show(id) }, h("span", { class: "dot " + st, title: st || "not started" }), label, amt ? h("span", { class: "amt" }, amt) : null));
      }
    }
  }

  /* ---------- panels ---------- */
  const PANELS = {};
  const head = (t, sub) => [h("h1", {}, t), h("p", { class: "sub" }, sub)];
  const field = (label, input) => h("label", { class: "field" }, label, input);
  const numIn = (get, set, ph, w) => h("input", { type: "number", step: "0.01", value: get(), placeholder: ph || "", style: `width:${w || 140}px`, oninput: (e) => { set(e.target.value); } });
  const out = () => (outEl = h("div", { id: "out" }));
  function drawOut() {
    if (!outEl || !outEl.isConnected) return; const id = state.active; outEl.textContent = "";
    const extra = EXTRA[id] ? EXTRA[id]() : null; if (extra) outEl.append(extra);
    (state.results[id] || []).forEach((j) => outEl.append(journalCard(j)));
    if (!(state.results[id] || []).length && id in RUN) outEl.append(h("p", { class: "hint" }, "Add the inputs above and the journal appears here."));
  }
  const EXTRA = {};

  /* ----- GYG ----- */
  PANELS.gyg = (root) => {
    root.append(...head("GetYourGuide commission", "One journal for the month: Dr 40002.1 by class, Cr 10032.3 GYG Sales (never the parent 10029). Add every GIS-*.xlsx invoice, plus the matching PDFs if you have them. Duplicate downloads, such as '(1)' copies, and invoices from other months are skipped automatically."));
    root.append(h("section", { class: "card" }, dropzone("GYG invoices (.xlsx), PDFs (.pdf) or a .zip of both", ".xlsx,.xls,.pdf,.zip", true, async (files) => {
      const items = await readFiles(files); let nx = 0, np = 0;
      for (const it of items) {
        try {
          if (/\.xlsx?$/i.test(it.name)) { state.gyg.invoices.push({ name: it.name, hash: ME.io.hashOf(it.buf), rows: ME.io.readWorkbook(it.buf)[0].rows }); nx++; }
          else if (/\.pdf$/i.test(it.name)) { const p = ME.io.parsePdfText(await pdfText(it.buf)); const k = p.invoice || (it.name.match(/GIS-(\d+)/) || [])[1]; if (k) { state.gyg.pdfs[k] = p; np++; } }
          else if (/\.rar$/i.test(it.name)) toast("RAR can't be opened in a browser. Extract it first or re-zip it.");
        } catch (e) { toast(`Could not read ${it.name}: ${e.message}`); }
      }
      state.gyg.names = [...state.gyg.names, ...items.map((i) => i.name)]; toast(`Added ${nx} invoice file(s) and ${np} PDF(s).`); run("gyg"); PANELS.__redraw();
    }), chips(state.gyg.names), state.gyg.names.length ? h("div", { class: "actions" }, h("button", { class: "btn", onclick: () => { state.gyg = { invoices: [], pdfs: {}, names: [] }; state.overrides = {}; run("gyg"); PANELS.__redraw(); } }, "Clear files")) : null));
    root.append(out());
  };
  EXTRA.gyg = () => {
    const box = h("div", {});
    const rates = settings.fx[state.month] || {};
    const setRate = (cur) => (e) => { settings.fx[state.month] = settings.fx[state.month] || {}; settings.fx[state.month][cur] = parseFloat(e.target.value) || undefined; saveSettings(); run("gyg"); };
    box.append(h("section", { class: "card" }, h("h2", {}, `FX for ${U.monthLabel(state.month)} (USD per 1 unit, month average)`),
      h("div", { class: "row" }, field("EUR", h("input", { type: "number", step: "0.0001", value: rates.EUR || "", onchange: setRate("EUR"), style: "width:120px" })), field("GBP", h("input", { type: "number", step: "0.0001", value: rates.GBP || "", onchange: setRate("GBP"), style: "width:120px" })),
        h("button", { class: "btn", onclick: async (e) => { e.target.disabled = true; try { await fetchFx(state.month); toast("Rates loaded from ECB via Frankfurter."); run("gyg"); } catch (err) { toast("Could not reach Frankfurter. Type the rates in."); } e.target.disabled = false; } }, "Fetch ECB monthly average")),
      h("p", { class: "hint" }, "The posted August journal reproduces with EUR 1.1593 and GBP 1.3541. Frankfurter's August average gives 1.1593 and 1.3542, so GBP can differ by 0.0001 (about $1 on London). Edit here if your rate differs. USD invoices need no rate.")));
    const t = ((state.results.gyg || [])[0] || { meta: {} }).meta.table;
    if (t && t.length) box.append(h("section", { class: "card" }, h("h2", {}, "Invoices"), h("div", { class: "scroll" }, h("table", {},
      h("thead", {}, h("tr", {}, ["Invoice", "Service month", "Cur", "Rows", "Commission", "USD", "Class", "Basis", "PDF"].map((c, i) => h("th", { class: i >= 3 && i <= 5 ? "n" : "" }, c)))),
      h("tbody", {}, t.map((e) => h("tr", { style: e.skip ? "opacity:.55" : "" }, h("td", { class: "mono" }, "GIS-" + e.inv), h("td", {}, e.skip ? `${U.monthLabel(e.svc)} (skipped)` : U.monthLabel(e.svc)), h("td", {}, e.currency), h("td", { class: "n" }, e.rows), h("td", { class: "n" }, fmt(e.comm)), h("td", { class: "n" }, e.usd !== undefined ? fmt(e.usd) : ""),
        h("td", {}, e.skip ? "" : h("select", { onchange: (ev) => { state.overrides[e.inv] = ev.target.value; run("gyg"); } }, h("option", { value: "" }, "(choose)"), settings.classes.allowed.map((c) => h("option", { value: c, selected: c === e.cls }, c)))),
        h("td", {}, e.classSource || ""), h("td", {}, e.skip ? "" : e.tied ? "✓ tied" : e.pdf ? "mismatch" : "none"))))))));
    return box;
  };

  /* ----- Groupon ----- */
  PANELS.groupon = (root) => {
    root.append(...head("Groupon commission", "Source: Merchant Center > Finance > Statements > PAYMENT_DETAILS. Add every export for the period; rows that appear in more than one file count once. Month comes from Date Processed. Commission = Sell price (pre-tax) minus Payment, Processed and Voided rows both included. One debit per class to 40002.4."));
    root.append(h("section", { class: "card" }, dropzone("Groupon PAYMENT_DETAILS exports (.xlsx)", ".xlsx,.xls,.zip", true, async (files) => {
      const items = await readFiles(files);
      for (const it of items) if (/\.xlsx?$/i.test(it.name)) { try { state.groupon.push({ name: it.name, rows: ME.io.readWorkbook(it.buf)[0].rows }); } catch (e) { toast(`Could not read ${it.name}`); } }
      run("groupon"); PANELS.__redraw();
    }), chips(state.groupon.map((f) => f.name)), state.groupon.length ? h("div", { class: "actions" }, h("button", { class: "btn", onclick: () => { state.groupon = []; run("groupon"); PANELS.__redraw(); } }, "Clear files")) : null));
    root.append(out());
  };

  /* ----- Airbnb ----- */
  PANELS.airbnb = (root) => {
    root.append(...head("Airbnb Experiences commission", "Source: Airbnb Host Dashboard > Transaction History > CSV for the month. Only Experience rows are used (Reservations are Steven Garcia's STR properties; Co-Host and Resolution rows are excluded). Commission is the Service fee column, and Payout + Fee must equal Gross earnings on every row."));
    root.append(h("section", { class: "card" }, dropzone("Airbnb transaction history (.csv)", ".csv,.txt", false, async (files) => { state.airbnb = await files[0].text(); state.airbnbName = files[0].name; run("airbnb"); PANELS.__redraw(); }), state.airbnb ? chips([state.airbnbName]) : null));
    root.append(out());
  };

  /* ----- Depreciation ----- */
  PANELS.depreciation = (root) => {
    root.append(...head("Depreciation", "Source: Garcia_Empire_Depreciation_Tracker, the 'Empire <year>' sheet only. The TOTAL DEP figure for the month is booked as one debit/credit pair per asset (ET-1, ET-2, ET-3) to 81000 / 15150."));
    root.append(h("section", { class: "card" }, dropzone("Depreciation tracker (.xlsx)", ".xlsx,.xls", false, async (files) => { const [it] = await readFiles(files); state.dep = ME.io.readWorkbook(it.buf); state.depName = it.name; run("depreciation"); PANELS.__redraw(); }), state.dep ? chips([state.depName]) : null));
    root.append(out());
  };

  /* ----- Jonathan ----- */
  PANELS.jonathan = (root) => {
    root.append(...head("Jonathan loan interest (23021)", "15% p.a. simple, actual/365, on the daily balance of 23021 Notes Payable – Jonathan. Enter the balance on the 1st and any advance (+) or repayment (−) with its date. Dr 60230 Interest paid / Cr 21091 Accrued Interest."));
    const s = state.jon; const moves = h("div", {});
    const drawMoves = () => { moves.textContent = ""; s.moves.forEach((m, i) => moves.append(h("div", { class: "row", style: "margin-bottom:6px" },
      field(i ? "" : "Date", h("input", { type: "date", value: m.date, min: state.month + "-01", max: U.lastDate(state.month), onchange: (e) => { m.date = e.target.value; run("jonathan"); } })),
      field(i ? "" : "Advance (+) / repayment (−), USD", numIn(() => m.amt, (v) => { m.amt = v; run("jonathan"); }, "-50000.00", 180)),
      h("button", { class: "btn", "aria-label": "Remove row", onclick: () => { s.moves.splice(i, 1); if (!s.moves.length) s.moves.push({ date: "", amt: "" }); drawMoves(); run("jonathan"); } }, "Remove")))); };
    drawMoves();
    root.append(h("section", { class: "card" }, h("div", { class: "row" }, field("Balance on the 1st (USD, from QBO 23021)", numIn(() => s.opening, (v) => { s.opening = v; run("jonathan"); }, "100000.00", 200))), h("h2", { style: "margin-top:16px" }, "Movements during the month"), moves,
      h("div", { class: "actions" }, h("button", { class: "btn", onclick: () => { s.moves.push({ date: "", amt: "" }); drawMoves(); } }, "Add movement")),
      h("p", { class: "hint" }, "Jonathan's workbook ends May 2026 at $200,000. Take the balance and movements from the QBO 23021 account for the month. The posted August journal used $100,000 for 31 days = 1,273.97.")));
    root.append(out());
  };
  EXTRA.jonathan = () => {
    const j = (state.results.jonathan || [])[0]; if (!j || !j.meta || !j.meta.segs) return null;
    return h("section", { class: "card" }, h("h2", {}, "Interest by period"), h("table", {}, h("thead", {}, h("tr", {}, ["From", "To", "Days", "Balance", "Interest"].map((c, i) => h("th", { class: i > 1 ? "n" : "" }, c)))),
      h("tbody", {}, j.meta.segs.map((g) => h("tr", {}, h("td", {}, `${state.month}-${String(g.from).padStart(2, "0")}`), h("td", {}, `${state.month}-${String(g.to).padStart(2, "0")}`), h("td", { class: "n" }, g.days), h("td", { class: "n" }, fmt(g.balance)), h("td", { class: "n" }, (g.interest / 100).toFixed(4))))),
      h("tfoot", {}, h("tr", {}, h("td", { colspan: 4 }, `Rounded interest · closing balance ${fmt(j.meta.closing)}`), h("td", { class: "n" }, fmt(j.meta.interest))))));
  };

  /* ----- SIA ----- */
  PANELS.sia = (root) => {
    root.append(...head("23014 Note Payable – SIA interest", "Personal note, about 5.5% p.a., level monthly payment. The workbook marks each month 'Monthly Accrude' with a 'Monthly JE reverse' the next month, so this makes two journals: the accrual at month-end and its reversal on the 1st of next month."));
    const s = state.sia; const body = h("div", {});
    const draw = () => {
      body.textContent = "";
      body.append(h("div", { class: "seg", role: "group", "aria-label": "How to get the interest" }, [["balance", "From the loan balance"], ["workbook", "From the amortization workbook"], ["direct", "Type the amount"]].map(([k, l]) => h("button", { "aria-pressed": s.method === k, onclick: () => { s.method = k; draw(); run("sia"); } }, l))));
      if (s.method === "balance") body.append(h("div", { class: "row" }, field("Principal at the start of the month (USD)", numIn(() => s.balance, (v) => { s.balance = v; run("sia"); }, "50000.00", 200)), field("Annual rate %", numIn(() => s.rate, (v) => { s.rate = v; run("sia"); }, "5.5", 90)), h("p", { class: "hint" }, "Interest = principal × rate ÷ 12, which is what a level-payment schedule charges each month on the outstanding principal.")));
      if (s.method === "direct") body.append(field("Interest for the month (USD)", numIn(() => s.direct, (v) => { s.direct = v; run("sia"); }, "229.17", 200)));
      if (s.method === "workbook") body.append(dropzone("'23014 Note Payable Account Amortization Personal.xlsx'", ".xlsx,.xls", false, async (files) => { const [it] = await readFiles(files); s.wb = ME.io.readWorkbook(it.buf); const r = ME.sia.fromWorkbook(s.wb, state.month); toast(r ? `Found ${fmt(r.cents)} on ${r.date} (${r.sheet}).` : "No row for this month found."); run("sia"); }), h("p", { class: "hint" }, "Finds the row whose date falls in the closing month and takes its Interest column. If your workbook labels differ, use the other two options."));
    };
    draw(); root.append(h("section", { class: "card" }, body)); root.append(out());
  };

  /* ----- Amortization ----- */
  PANELS.amort = (root) => {
    root.append(...head("Amortization (80000)", "QBO shows 80000 Amortization expenses of 1,925.00 in both Aug and Sep 2026, but the workings are not in the notes. This is an open item: use this only once the source is confirmed (for example intangibles from the See It All acquisition), and set the accumulated amortization account in Settings."));
    root.append(h("section", { class: "card" }, field("Monthly amortization (USD)", numIn(() => state.amort.amount, (v) => { state.amort.amount = v; run("amort"); }, "1925.00", 200))));
    root.append(out());
  };

  /* ----- Viator ----- */
  PANELS.viator = (root) => {
    root.append(...head("Viator commission", "Commission = Viator gross less net received (an older higher rate counts as commission). The Xola base vs Viator gross price difference (Walkway dynamic pricing) is its own line. The commission account, class and report source are still open items, so the journal stays blocked until the accounts are set in Settings."));
    const tbody = h("tbody", {});
    const draw = () => { tbody.textContent = ""; state.via.rows.forEach((r, i) => tbody.append(h("tr", {},
      h("td", {}, h("select", { onchange: (e) => { r.cls = e.target.value; run("viator"); } }, h("option", { value: "" }, "(class)"), settings.classes.allowed.map((c) => h("option", { value: c, selected: c === r.cls }, c)))),
      h("td", {}, numIn(() => r.gross, (v) => { r.gross = v; run("viator"); }, "0.00", 120)), h("td", {}, numIn(() => r.net, (v) => { r.net = v; run("viator"); }, "0.00", 120)), h("td", {}, numIn(() => r.diff, (v) => { r.diff = v; run("viator"); }, "0.00", 110)),
      h("td", {}, h("button", { class: "btn", "aria-label": "Remove row", onclick: () => { state.via.rows.splice(i, 1); if (!state.via.rows.length) state.via.rows.push({ cls: "", gross: "", net: "", diff: "" }); draw(); run("viator"); } }, "×"))))); };
    draw();
    const paste = h("textarea", { rows: 3, placeholder: "Paste from Excel: class [tab] gross [tab] net [tab] price difference" });
    root.append(h("section", { class: "card" }, h("table", {}, h("thead", {}, h("tr", {}, ["Class", "Viator gross", "Net received", "Price difference (not commission)", ""].map((c, i) => h("th", { class: i > 0 && i < 4 ? "n" : "" }, c)))), tbody),
      h("div", { class: "actions" }, h("button", { class: "btn", onclick: () => { state.via.rows.push({ cls: "", gross: "", net: "", diff: "" }); draw(); } }, "Add row")), h("details", { style: "margin-top:12px" }, h("summary", {}, "Paste rows"), paste, h("div", { class: "actions" }, h("button", { class: "btn", onclick: () => { const rows = paste.value.split(/\r?\n/).map((l) => l.split("\t")).filter((c) => c.length >= 3).map((c) => ({ cls: c[0].trim(), gross: c[1].replace(/[$,]/g, ""), net: c[2].replace(/[$,]/g, ""), diff: (c[3] || "").replace(/[$,]/g, "") })); if (rows.length) { state.via.rows = rows; draw(); run("viator"); toast(`${rows.length} rows loaded.`); } } }, "Load pasted rows")))));
    root.append(out());
  };

  /* ----- CFL ----- */
  PANELS.cfl = (root) => {
    root.append(...head("CFL accrual (16th to month end)", "Chicago From the Lake is paid twice a month; the 1st–15th is settled before close, so only the 16th to month end is accrued, and only if Connor's reconciliation has not arrived. Cr goes to A/P, not 21090, so the estimate must be reversed in full when the actual arrives."));
    const c = state.cfl; const body = h("div", {});
    const draw = () => {
      body.textContent = "";
      body.append(h("div", { class: "seg", role: "group", "aria-label": "Mode" }, [["estimate", "Estimate (accrue)"], ["actual", "Actual arrived (reverse and rebook)"]].map(([k, l]) => h("button", { "aria-pressed": c.mode === k, onclick: () => { c.mode = k; draw(); run("cfl"); } }, l))));
      if (c.mode === "estimate") {
        body.append(dropzone("Xola Events Export (.xlsx) — Reports > Analytics > Export Events", ".xlsx,.xls", false, async (files) => { const [it] = await readFiles(files); try { c.xola = ME.io.readWorkbook(it.buf); c.xolaName = it.name; run("cfl"); PANELS.__redraw(); } catch (e) { toast("Could not read the export: " + e.message); } }), c.xola ? chips([c.xolaName]) : null);
        body.append(h("div", { class: "row", style: "margin-top:14px" },
          field("CFL share of ad spend (USD, from Aanand's email)", numIn(() => c.ad, (v) => { c.ad = v; run("cfl"); }, "39988.53", 220)),
          field("Connor 1st–15th: CPP commission (USD)", numIn(() => c.cppFirst, (v) => { c.cppFirst = v; run("cfl"); }, "", 200)),
          field("…or his base (USD)", numIn(() => c.baseFirst, (v) => { c.baseFirst = v; run("cfl"); }, "", 150)),
          !c.xola ? field("No export? Base for 16th–end (USD)", numIn(() => c.manualBase, (v) => { c.manualBase = v; run("cfl"); }, "341250.00", 200)) : null));
        body.append(h("p", { class: "hint" }, "Filters (SOP): arrival date 16th to month end; Purchase Type not Waitlist; Type Order; Status Confirmed; Source not Get Your Guide; CFL products only. Validation reruns the 1st–15th and compares with Connor's base (his CPP commission ÷ 32%): under 0.5% post, 0.5–5% note and post, over 5% stop."));
      } else {
        const est = state.cflEst && state.cflEst.meta;
        body.append(h("div", { class: "row" },
          field("Connor's total payable to CFL (USD)", numIn(() => c.total, (v) => { c.total = v; run("cfl"); }, "273244.00", 200)), field("CFL share of ad spend (USD)", numIn(() => c.adActual, (v) => { c.adActual = v; run("cfl"); }, "39988.53", 190)),
          field("Journal date", h("input", { type: "date", value: c.date, onchange: (e) => { c.date = e.target.value; run("cfl"); } }))));
        body.append(h("div", { class: "row", style: "margin-top:12px" },
          field("Estimate to reverse: gross to CFL (USD)", numIn(() => c.priorGross, (v) => { c.priorGross = v; run("cfl"); }, est ? (est.gross / 100).toFixed(2) : "247175.00", 220)), field("Estimate's ad-spend credit (USD)", numIn(() => c.priorAd, (v) => { c.priorAd = v; run("cfl"); }, est ? (est.ad / 100).toFixed(2) : "0.00", 200))));
        body.append(h("p", { class: "hint" }, "Reverses the estimate in full, then books the actual: Dr 50015 at his total plus ad spend, Cr 60017 for the ad spend, Cr 20000 for his total. Leave the estimate boxes empty to use the estimate calculated in this session."));
      }
    };
    draw(); root.append(h("section", { class: "card" }, body)); root.append(out());
  };
  EXTRA.cfl = () => {
    if (state.cfl.mode !== "estimate" || !state.cfl.xola || !state.cflScan) return null;
    const { second, first } = state.cflScan; if (second.error) return null;
    const box = h("section", { class: "card" }, h("h2", {}, "What the export contained"));
    box.append(h("div", { class: "kv" }, h("div", {}, h("small", {}, "Base 16th–end"), h("span", {}, fmt(second.base))), h("div", {}, h("small", {}, "Qualifying rows"), h("span", {}, second.rows)), h("div", {}, h("small", {}, "Base 1st–15th (validation)"), h("span", {}, fmt(first.base))),
      h("div", {}, h("small", {}, "Arrival dates in file"), h("span", { style: "font-size:13px" }, `${second.minArrival || "-"} → ${second.maxArrival || "-"}`))));
    const ex = second.excluded; box.append(h("p", { class: "hint" }, `Excluded in the 16th–end window: ${ex.waitlist} waitlist, ${ex.type} non-order, ${ex.status} not confirmed, ${ex.source} from Get Your Guide, ${ex.notCfl} non-CFL products. ${ex.outOfRange} rows were outside the date window.`));
    const prods = Object.entries(second.byProduct); if (prods.length) box.append(h("table", {}, h("thead", {}, h("tr", {}, h("th", {}, "CFL product counted"), h("th", { class: "n" }, "Base"))), h("tbody", {}, prods.map(([p, b]) => h("tr", {}, h("td", {}, p), h("td", { class: "n" }, fmt(b)))))));
    const unk = Object.entries(second.unknown); if (unk.length) box.append(h("div", { style: "margin-top:12px" }, h("h2", {}, "Products not on any list — decide before posting"), h("table", {}, h("tbody", {}, unk.map(([p, b]) => h("tr", {}, h("td", {}, p), h("td", { class: "n" }, fmt(b)),
      h("td", {}, h("button", { class: "btn", onclick: () => { settings.cfl.products.push(p); saveSettings(); run("cfl"); } }, "It's CFL"), " ", h("button", { class: "btn", onclick: () => { settings.cfl.notCfl.push(p); saveSettings(); run("cfl"); } }, "Not CFL"))))))));
    return box;
  };

  /* ----- Shoreline ----- */
  PANELS.shoreline = (root) => {
    root.append(...head("Shoreline accrual", "Shoreline is the Chicago boat operator, a separate arrangement from CFL. Accrual = 70% of non-90-minute cruise revenue. Dr 50015 Costs of Goods Sold – Boats / Cr 21090 Accrued Expenses. Use the Ventrata detail report from Wendy Shear, or type the revenue."));
    const s = state.shr; const body = h("div", {});
    const draw = () => {
      body.textContent = "";
      body.append(dropzone("Ventrata detail report (.xlsx or .csv)", ".xlsx,.xls,.csv", false, async (files) => {
        const [it] = await readFiles(files); const sh = ME.io.readWorkbook(it.buf)[0];
        const hdr = sh.rows.findIndex((r) => r.filter((x) => typeof x === "string" && x.trim()).length >= 3); s.sheet = sh; s.name = it.name; s.hdr = Math.max(0, hdr);
        const ix = U.indexHeaders(sh.rows[s.hdr]); s.prod = U.findCol(ix, /product|tour|experience|item/); s.amt = U.findCol(ix, /^(total|amount|revenue|sales|gross)|price/); draw(); run("shoreline");
      }), s.sheet ? chips([s.name]) : null);
      if (s.sheet) {
        const hdrRow = s.sheet.rows[s.hdr] || [];
        const sel = (key, label) => field(label, h("select", { onchange: (e) => { s[key] = +e.target.value; run("shoreline"); } }, h("option", { value: -1 }, "(choose)"), hdrRow.map((x, i) => x !== null ? h("option", { value: i, selected: i === s[key] }, String(x)) : null)));
        body.append(h("div", { class: "row", style: "margin-top:12px" }, sel("prod", "Product column"), sel("amt", "Revenue column"), field("Header row", numIn(() => s.hdr + 1, (v) => { s.hdr = Math.max(0, (+v || 1) - 1); run("shoreline"); }, "", 70))));
        const t = ME.shoreline.sumRevenue(s.sheet, s.hdr, Math.max(0, s.prod), Math.max(0, s.amt), settings.shoreline);
        if (s.prod >= 0 && s.amt >= 0) body.append(h("p", { class: "hint" }, `Counted ${fmt(t.total)} across ${t.n} rows. Excluded (90-minute${settings.shoreline.exclude75 ? " and 75-minute" : ""}): ${fmt(t.excluded)}.`));
      }
      body.append(h("div", { class: "row", style: "margin-top:12px" }, field("…or type non-90-minute cruise revenue (USD)", numIn(() => s.manual, (v) => { s.manual = v; run("shoreline"); }, "100000.00", 240)),
        h("label", { class: "check", style: "border:0" }, h("input", { type: "checkbox", checked: settings.shoreline.exclude75, onchange: (e) => { settings.shoreline.exclude75 = e.target.checked; saveSettings(); draw(); run("shoreline"); } }), h("span", {}, "Also leave out the 75-minute tour (it sits in Connor's CFL report; avoids a double count)"))));
    };
    draw(); root.append(h("section", { class: "card" }, body)); root.append(out());
  };

  /* ----- Dashboard ----- */
  PANELS.dashboard = (root) => {
    root.append(...head(`Close pack — ${U.monthLabel(state.month)}`, "Everything prepared for this month. Nothing is posted: import each journal into QuickBooks by hand after review. Entries are dated the last day of the month (reversals the 1st of next month)."));
    const all = []; ORDER.forEach((id) => (state.results[id] || []).forEach((j) => all.push([id, j])));
    const ready = all.filter(([, j]) => j.status !== "blocked" && j.lines.length);
    root.append(h("section", { class: "card" }, all.length ? h("div", { class: "scroll" }, h("table", {},
      h("thead", {}, h("tr", {}, ["Entry", "Journal", "Date", "Total", "Status", "Open"].map((c, i) => h("th", { class: i === 3 ? "n" : "" }, c)))),
      h("tbody", {}, all.map(([id, j]) => h("tr", {}, h("td", {}, j.title), h("td", { class: "mono" }, j.journalNo), h("td", { class: "mono" }, j.date), h("td", { class: "n" }, fmt(j.debits)), h("td", {}, h("span", { class: `tag ${j.status}` }, TAG[j.status])), h("td", {}, h("button", { class: "btn", onclick: () => show(id) }, "Open")))))))
      : h("p", { class: "hint" }, "No entries yet. Open one from the left and add its files."),
      all.length ? h("div", { class: "actions" },
        h("button", { class: "btn primary", disabled: !ready.length, onclick: () => save(new Blob([ME.toQboCsv(ready.map(([, j]) => j), true)], { type: "text/csv" }), `Empire_${state.month}_QBO-journal-import.csv`) }, "Download QBO import (all ready journals, one CSV)"),
        h("button", { class: "btn", disabled: !ready.length, onclick: async () => { const z = new JSZip(); ready.forEach(([, j]) => z.file(`${j.journalNo}.xlsx`, xlsxBlob(j))); save(await z.generateAsync({ type: "blob" }), `Empire_${state.month}_journals.zip`); } }, "Download posted-layout files (.zip)"),
        h("button", { class: "btn", onclick: () => { const t = {}; all.forEach(([id, j]) => { if (j.status !== "blocked" && !/REV|ACT/.test(j.journalNo)) { settings.history[id] = settings.history[id] || {}; settings.history[id][state.month] = j.debits; } }); saveSettings(); toast(`Saved ${U.monthLabel(state.month)} totals as the baseline for next month's 30% check.`); } }, "Save totals as next month's baseline"),
        h("button", { class: "btn", onclick: () => window.print() }, "Print")) : null,
      all.length ? h("p", { class: "hint" }, "The combined CSV follows SOP section 4: sequential JournalNo across the file and the date on the first line of each journal. Blocked journals are left out.") : null));
    const blocked = all.filter(([, j]) => j.status === "blocked").length, review = all.filter(([, j]) => j.status === "review").length;
    if (all.length) root.append(h("div", { class: "kv" }, h("div", {}, h("small", {}, "Ready"), h("span", {}, all.length - blocked - review)), h("div", {}, h("small", {}, "Need review"), h("span", {}, review)), h("div", {}, h("small", {}, "Blocked"), h("span", {}, blocked))));
  };

  /* ----- Review ----- */
  const CHECKS = [
    "QBO P&L for the close month vs the previous period (by Classes, then Total Only).",
    "Balance Sheet at month end vs prior month end.",
    "Drill into 21090 (Shoreline) and into 20000 A/P for CHICAGO FROM THE LAKE, LTD_CFL to confirm both accruals posted.",
    "Clearing sub-accounts: Xola (10031) near nil; Viator about one month. Do not test any portal against one month's invoice.",
    "21085 VAT Payable flat at 63,220.62 until it clears in September: expected, do not flag.",
    "21090 carries an unexplained residual of 786.00: known, still unidentified.",
    "Every new vendor is logged in the New Vendor List and sent to Jonathan weekly; no transaction posts without a vendor.",
    "Slack reminder on the 4th covers both accruals (CFL and Shoreline).",
    "Working file attached to each posted journal."
  ];
  const OPEN = [
    ["Viator report source, commission expense account and class", "open"],
    ["FX basis for GYG GBP/EUR invoices", "The posted August journal reproduces with the monthly average of ECB rates (EUR exactly; GBP within 0.0001). Confirm with Dhwani."],
    ["23014 interest account and accrual convention", "open"],
    ["Source of the 80000 Amortization entry (1,925.00 a month)", "open"],
    ["75-minute tour: Connor's CFL report vs Shoreline double count", "open"],
    ["Charters in the second half of the month missing from the Xola export", "Ask Aanand or Louise for a count at close if the amounts are material."],
    ["CFL: posted journal (gross 306,387.43, implied base ≈ 397,906) vs SOP worked example (base 341,250.00)", "Same ad spend 39,988.53 in both. Rerun the Xola export to see which is right. The SOP notes the Sep pull ran into November."]
  ];
  PANELS.review = (root) => {
    root.append(...head("Review before sending to Jonathan", "SOP section 5, plus the open items from section 6."));
    const key = "med-checks-" + state.month; let done = {}; try { done = JSON.parse(LS.get(key) || "{}"); } catch (e) { /* ignore */ }
    root.append(h("section", { class: "card" }, h("h2", {}, `Checklist for ${U.monthLabel(state.month)}`), CHECKS.map((t, i) => h("label", { class: "check" }, h("input", { type: "checkbox", checked: !!done[i], onchange: (e) => { done[i] = e.target.checked; LS.set(key, JSON.stringify(done)); } }), h("span", {}, t)))));
    const vb = state.via; const res = h("p", { class: "hint" });
    const upd = () => { if (vb.balance === "") { res.textContent = ""; return; } const r = ME.viatorBalanceCheck(cents(vb.balance), cents(vb.sales)); res.textContent = r.text; res.style.color = r.level === "stop" ? "var(--bad)" : "var(--ok)"; }; upd();
    root.append(h("section", { class: "card" }, h("h2", {}, "Viator clearing (10032) balance test"), h("div", { class: "row" }, field("10032 balance at month end (USD)", numIn(() => vb.balance, (v) => { vb.balance = v; upd(); }, "", 200)), field("Viator sales for the month (USD)", numIn(() => vb.sales, (v) => { vb.sales = v; upd(); }, "", 200))), res,
      h("p", { class: "hint" }, "Nil means all settled. About one month is expected (Viator pays a month in arrears). Two months or more means a missing advice or a late payment. Negative means cash coded with no sale behind it.")));
    root.append(h("section", { class: "card" }, h("h2", {}, "Open items before sign-off"), h("table", {}, h("tbody", {}, OPEN.map(([a, b]) => h("tr", {}, h("td", {}, a), h("td", {}, b === "open" ? h("span", { class: "tag review" }, "Open") : b)))))));
  };

  /* ----- Settings ----- */
  const lines = (obj) => Object.entries(obj).map(([k, v]) => `${k} = ${v}`).join("\n");
  const unlines = (t) => Object.fromEntries(t.split(/\r?\n/).map((l) => l.split(/\s=\s/)).filter((p) => p.length >= 2 && p[0].trim()).map((p) => [p[0].trim(), p.slice(1).join(" = ").trim()]));
  PANELS.settings = (root) => {
    root.append(...head("Settings", "Account names, class maps and rates. Saved in this browser only. Re-confirm account names against the current chart of accounts before each run (sub-accounts must read '<child number> <parent name>:<child name>')."));
    const save2 = () => { saveSettings(); runAll(); };
    const txt = (label, get, set, rows) => h("label", { class: "field", style: "margin-bottom:10px" }, label, h("textarea", { rows: rows || 5, onchange: (e) => { set(e.target.value); save2(); } }, get()));
    const acc = h("details", { open: true }, h("summary", {}, "Accounts"), h("div", { class: "scroll" }, h("table", {}, h("tbody", {}, Object.keys(settings.accounts).map((k) => h("tr", {}, h("td", { class: "mono" }, k), h("td", {}, h("input", { type: "text", value: settings.accounts[k], placeholder: "not set", style: "width:100%;min-width:380px", onchange: (e) => { settings.accounts[k] = e.target.value.trim(); save2(); } }))))))));
    const nm = h("details", {}, h("summary", {}, "Vendor names and classes"), h("div", { class: "row" }, ["gyg", "cfl", "shoreline", "viator"].map((k) => field(`Name: ${k}`, h("input", { type: "text", value: settings.names[k], style: "width:260px", onchange: (e) => { settings.names[k] = e.target.value; save2(); } })))),
      h("div", { class: "row", style: "margin-top:10px" }, ["gygClearing", "boats", "admin"].map((k) => field(`Class: ${k}`, h("input", { type: "text", value: settings.classes[k], style: "width:290px", onchange: (e) => { settings.classes[k] = e.target.value; save2(); } })))),
      txt("Allowed classes (one per line; a class not on this list blocks the journal)", () => settings.classes.allowed.join("\n"), (v) => (settings.classes.allowed = v.split(/\r?\n/).map((s) => s.trim()).filter(Boolean)), 9));
    const maps = h("details", {}, h("summary", {}, "Class maps (key = class)"),
      txt("GYG account number = class", () => lines(settings.gygAccountToClass), (v) => (settings.gygAccountToClass = unlines(v)), 8), txt("GYG invoice number = class (only where product names can't tell, e.g. Chicago)", () => lines(settings.gygInvoiceToClass), (v) => (settings.gygInvoiceToClass = unlines(v)), 7),
      txt("GYG product keyword = class", () => settings.gygProductKeywords.map(([a, b]) => `${a} = ${b}`).join("\n"), (v) => (settings.gygProductKeywords = Object.entries(unlines(v))), 9), txt("Groupon Payable Name (lower case, punctuation removed) = class", () => lines(settings.groupPayableToClass), (v) => (settings.groupPayableToClass = unlines(v)), 6),
      txt("Airbnb listing = class", () => lines(settings.airbnbListingToClass), (v) => (settings.airbnbListingToClass = unlines(v)), 10), txt("Depreciation asset = class", () => lines(settings.depAssetClass), (v) => (settings.depAssetClass = unlines(v)), 3));
    const rates = h("details", {}, h("summary", {}, "CFL, Shoreline, interest, variance"),
      h("div", { class: "row" }, field("CFL fee %", numIn(() => settings.cfl.feePct, (v) => (settings.cfl.feePct = +v), "", 80)), field("CPP commission %", numIn(() => settings.cfl.cppPct, (v) => (settings.cfl.cppPct = +v), "", 80)), field("Shoreline share %", numIn(() => settings.shoreline.sharePct, (v) => (settings.shoreline.sharePct = +v), "", 80)), field("Jonathan rate %", numIn(() => settings.jonathan.ratePct, (v) => (settings.jonathan.ratePct = +v), "", 80)), field("Day basis", numIn(() => settings.jonathan.basis, (v) => (settings.jonathan.basis = +v), "", 80)), field("Variance limit %", numIn(() => settings.variancePct, (v) => (settings.variancePct = +v), "", 80)), h("button", { class: "btn", onclick: save2 }, "Apply")),
      txt("CFL products (one per line)", () => settings.cfl.products.join("\n"), (v) => (settings.cfl.products = v.split(/\r?\n/).map((s) => s.trim()).filter(Boolean)), 3), txt("Not CFL (one per line)", () => settings.cfl.notCfl.join("\n"), (v) => (settings.cfl.notCfl = v.split(/\r?\n/).map((s) => s.trim()).filter(Boolean)), 4),
      txt("Shoreline: leave out products matching (regex, one per line)", () => settings.shoreline.excludePatterns.join("\n"), (v) => (settings.shoreline.excludePatterns = v.split(/\r?\n/).map((s) => s.trim()).filter(Boolean)), 2));
    const fxs = h("details", {}, h("summary", {}, "FX rates by month"), txt("month = EUR, GBP  (USD per 1 unit)", () => Object.entries(settings.fx).map(([m, r]) => `${m} = ${r.EUR || ""}, ${r.GBP || ""}`).join("\n"), (v) => { const o = unlines(v); settings.fx = Object.fromEntries(Object.entries(o).map(([m, s]) => { const [e, g2] = s.split(",").map((x) => parseFloat(x)); return [m, { EUR: e, GBP: g2 }]; })); }, 4));
    const io = h("div", { class: "actions" }, h("button", { class: "btn", onclick: () => save(new Blob([JSON.stringify(settings, null, 2)], { type: "application/json" }), "month-end-settings.json") }, "Export settings"),
      h("label", { class: "btn" }, "Import settings", h("input", { type: "file", accept: ".json", hidden: true, onchange: async (e) => { try { settings = merge(JSON.parse(JSON.stringify(ME.DEFAULTS)), JSON.parse(await e.target.files[0].text())); saveSettings(); runAll(); PANELS.__redraw(); toast("Settings imported."); } catch (err) { toast("Not a valid settings file."); } } })),
      h("button", { class: "btn", onclick: () => { if (confirm("Reset all settings to the built-in defaults?")) { settings = JSON.parse(JSON.stringify(ME.DEFAULTS)); saveSettings(); runAll(); PANELS.__redraw(); } } }, "Reset to defaults"));
    root.append(h("section", { class: "card" }, acc, nm, maps, rates, fxs, io));
  };

  /* ---------- FX fetch ---------- */
  async function fetchFx(month) {
    const last = U.lastDate(month), url = `https://api.frankfurter.dev/v1/${month}-01..${last}?base=USD&symbols=EUR,GBP`;
    const d = await (await fetch(url)).json(); const r = {};
    for (const cur of ["EUR", "GBP"]) { const v = Object.entries(d.rates).filter(([k]) => k.startsWith(month)).map(([, x]) => x[cur]); if (v.length) r[cur] = Math.round(v.length / v.reduce((a, b) => a + b, 0) * 1e4) / 1e4; }
    settings.fx[month] = r; saveSettings();
  }

  /* ---------- router ---------- */
  function show(id) {
    state.active = id; const main = document.getElementById("main"); main.textContent = ""; outEl = null;
    PANELS[id](main); drawOut(); chrome(); window.scrollTo(0, 0);
    try { history.replaceState(null, "", "#" + id); } catch (e) { /* file:// */ }
  }
  PANELS.__redraw = () => show(state.active);

  const monthInput = document.getElementById("month"); monthInput.value = state.month;
  monthInput.addEventListener("change", () => { if (!monthInput.value) return; state.month = monthInput.value; LS.set("med-month", state.month); state.cflEst = null; state.overrides = {}; runAll(); show(state.active); });
  window.addEventListener("hashchange", () => { const id = location.hash.slice(1); if (PANELS[id] && id !== state.active) show(id); });
  window.MED = { state, settings: () => settings, run, runAll, show, ME };      // handy for debugging in the console
  const start = location.hash.slice(1); chrome(); show(PANELS[start] ? start : "dashboard");
})();
