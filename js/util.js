(function (g) {
  const ME = (g.ME = g.ME || {});
  const U = (ME.U = {});

  U.MONTHS = ["January","February","March","April","May","June","July","August","September","October","November","December"];
  U.monthLabel = (m) => { const [y, mo] = m.split("-").map(Number); return `${U.MONTHS[mo - 1]} ${y}`; };
  U.lastDay = (m) => { const [y, mo] = m.split("-").map(Number); return new Date(Date.UTC(y, mo, 0)).getUTCDate(); };
  U.lastDate = (m) => `${m}-${String(U.lastDay(m)).padStart(2, "0")}`;
  U.nextMonthFirst = (m) => { let [y, mo] = m.split("-").map(Number); mo++; if (mo > 12) { mo = 1; y++; } return `${y}-${String(mo).padStart(2, "0")}-01`; };
  U.prevMonth = (m) => { let [y, mo] = m.split("-").map(Number); mo--; if (mo < 1) { mo = 12; y--; } return `${y}-${String(mo).padStart(2, "0")}`; };

  /* money: integer cents everywhere */
  U.cents = (x) => { if (x === null || x === undefined || x === "") return 0; const n = typeof x === "number" ? x : parseFloat(String(x).replace(/[$,\s]/g, "")); if (!isFinite(n)) return 0; return Math.round(n * 100 + (n >= 0 ? 1e-7 : -1e-7)); };
  U.fmt = (c) => (c === null || c === undefined) ? "" : (c < 0 ? "-" : "") + (Math.abs(c) / 100).toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  U.dollars = (c) => c / 100;
  U.mulRound = (c, rate) => Math.round(c * rate + (c >= 0 ? 1e-7 : -1e-7));
  U.sum = (a) => a.reduce((s, x) => s + x, 0);

  /* dates: Excel serial -> UTC parts (no timezone surprises) */
  U.serialToDate = (s) => new Date(Math.round((s - 25569) * 86400000));
  U.toDate = (v) => {                       // returns a Date whose UTC fields hold the wall-clock value
    if (v === null || v === undefined || v === "") return null;
    if (v instanceof Date) return v;
    if (typeof v === "number") return U.serialToDate(v);
    const s = String(v).trim(); let m;
    if ((m = s.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})/))) return new Date(Date.UTC(+m[3], +m[1] - 1, +m[2]));
    if ((m = s.match(/^(\d{4})-(\d{2})-(\d{2})(?:[T ](\d{2}):(\d{2}))?/))) return new Date(Date.UTC(+m[1], +m[2] - 1, +m[3], +(m[4] || 0), +(m[5] || 0)));
    const d = new Date(s); return isNaN(d) ? null : d;
  };
  U.ymd = (d) => d.toISOString().slice(0, 10);
  U.ym = (d) => d.toISOString().slice(0, 7);

  /* headers: normalise so layout changes (column order, line breaks) do not matter */
  U.norm = (h) => String(h === null || h === undefined ? "" : h).replace(/\s+/g, " ").trim().toLowerCase();
  U.indexHeaders = (row) => { const ix = {}; row.forEach((h, i) => { const k = U.norm(h); if (k && !(k in ix)) ix[k] = i; }); return ix; };
  U.findCol = (ix, ...pats) => { for (const p of pats) { for (const k of Object.keys(ix)) { if (p instanceof RegExp ? p.test(k) : k === U.norm(p)) return ix[k]; } } return -1; };

  /* class from wording; rules = [[regex, class], ...] */
  U.inferClass = (text, rules) => { const t = String(text || ""); for (const [re, cls] of rules) { try { if (new RegExp(re, "i").test(t)) return cls; } catch (e) { /* bad regex in settings */ } } return null; };

  U.hash = (u8) => { let h1 = 0xdeadbeef, h2 = 0x41c6ce57; for (let i = 0; i < u8.length; i++) { const c = u8[i]; h1 = Math.imul(h1 ^ c, 2654435761); h2 = Math.imul(h2 ^ c, 1597334677); } h1 = Math.imul(h1 ^ (h1 >>> 16), 2246822507) ^ Math.imul(h2 ^ (h2 >>> 13), 3266489909); h2 = Math.imul(h2 ^ (h2 >>> 16), 2246822507) ^ Math.imul(h1 ^ (h1 >>> 13), 3266489909); return (4294967296 * (2097151 & h2) + (h1 >>> 0)).toString(16) + ":" + u8.length; };

  U.classSort = (a, b) => (a === "NYC") - (b === "NYC") || (a < b ? -1 : a > b ? 1 : 0);   // posted journals list NYC last

  /* RFC4180-ish CSV parser (Airbnb export has quoted commas) */
  U.parseCSV = (text) => {
    const rows = []; let row = [], f = "", q = false; text = text.replace(/^﻿/, "");
    for (let i = 0; i < text.length; i++) {
      const c = text[i];
      if (q) { if (c === '"') { if (text[i + 1] === '"') { f += '"'; i++; } else q = false; } else f += c; }
      else if (c === '"') q = true;
      else if (c === ",") { row.push(f); f = ""; }
      else if (c === "\n") { row.push(f); rows.push(row); row = []; f = ""; }
      else if (c !== "\r") f += c;
    }
    if (f.length || row.length) { row.push(f); rows.push(row); }
    return rows.filter((r) => r.some((x) => x !== ""));
  };
  U.csvEscape = (v) => { const s = v === null || v === undefined ? "" : String(v); return /[",\n\r]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s; };
})(typeof window !== "undefined" ? window : globalThis);
