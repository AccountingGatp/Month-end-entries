(function (g) {
  const ME = (g.ME = g.ME || {}); const U = ME.U;
  const XL = () => (typeof XLSX !== "undefined" ? XLSX : g.XLSX);
  ME.io = {
    /* -> [{name, rows}] ; rows = array of arrays, dates stay as Excel serial numbers */
    readWorkbook(buf) {
      const wb = XL().read(buf, { type: buf instanceof ArrayBuffer || ArrayBuffer.isView(buf) ? "array" : "buffer", cellDates: false });
      return wb.SheetNames.map((name) => ({ name, rows: XL().utils.sheet_to_json(wb.Sheets[name], { header: 1, raw: true, defval: null, blankrows: false }) }));
    },
    hashOf(buf) { return U.hash(buf instanceof Uint8Array ? buf : new Uint8Array(buf)); },
    parsePdfText(text) {
      const t = String(text).replace(/\s+/g, " ");
      const m = (re) => (t.match(re) || [])[1];
      const num = (s) => (s ? U.cents(s) : null);
      return {
        invoice: ((m(/Invoice number\s*(GIS-\d+)/i) || "").replace("GIS-", "")) || null,
        account: m(/Account number\s*(\d+)/i) || null,
        currency: m(/Amount \(([A-Z]{3})\)/) || null,
        bookings: num(m(/Total bookings\s*(-?[\d,]+\.\d\d)/i)),
        commission: num(m(/Our commission\s*(-?[\d,]+\.\d\d)/i)),
        period: m(/Invoice for services delivered:\s*([A-Za-z]+ \d+ - \d+, \d{4})/i) || null
      };
    }
  };
})(typeof window !== "undefined" ? window : globalThis);
