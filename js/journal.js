(function (g) {
  const ME = (g.ME = g.ME || {}); const U = ME.U;

  class Journal {
    constructor(key, title, journalNo, date) {
      Object.assign(this, { key, title, journalNo, date, lines: [], notes: [], warnings: [], errors: [], meta: {} });
    }
    line(account, { debit = null, credit = null, description = "", name = "", cls = "" } = {}) {
      this.lines.push({ account, debit, credit, description, name, cls }); return this;
    }
    get debits() { return U.sum(this.lines.map((l) => l.debit || 0)); }
    get credits() { return U.sum(this.lines.map((l) => l.credit || 0)); }
    get status() { return this.errors.length ? "blocked" : this.warnings.length ? "review" : "ok"; }

    check(settings, month) {
      if (this.lines.length && this.debits !== this.credits) this.errors.push(`Debits ${U.fmt(this.debits)} do not equal credits ${U.fmt(this.credits)}.`);
      const allowed = new Set(settings.classes.allowed);
      for (const l of this.lines) {
        if (!l.account) this.errors.push("A line has no account. Fill it in under Settings > Accounts.");
        if (l.cls && !allowed.has(l.cls)) this.errors.push(`Class "${l.cls}" is not in the allowed class list. Escalate to the Controller.`);
      }
      this.errors = [...new Set(this.errors)];
      const prior = settings.history[this.key] && settings.history[this.key][U.prevMonth(month)];
      if (prior && this.key !== "jonathan") {
        const ch = (this.debits - prior) / prior;
        const msg = `Total ${U.fmt(this.debits)} is ${(ch * 100).toFixed(0)}% vs ${U.prevMonth(month)} (${U.fmt(prior)}).`;
        if (Math.abs(ch) * 100 > settings.variancePct) this.warnings.push(msg + ` SOP limit is about ${settings.variancePct}%.`);
        else this.notes.push(msg + " Within limit.");
      } else if (this.lines.length) this.notes.push("No prior-month baseline stored, so the 30% variance check was skipped.");
      return this;
    }
  }
  ME.Journal = Journal;

  /* ---- exports ---- */
  ME.POSTED_COLS = ["ACCOUNT", "DEBITS", "CREDITS", "DESCRIPTION", "NAME", "LOCATION", "CLASS"];
  ME.toPostedRows = (j) => [ME.POSTED_COLS].concat(j.lines.map((l) => [l.account, l.debit === null ? null : l.debit / 100, l.credit === null ? null : l.credit / 100, l.description || null, l.name || null, null, l.cls || null]));

  ME.QBO_COLS = ["*JournalNo", "*JournalDate", "*AccountName", "*Debits", "*Credits", "Description", "Name", "Currency", "Location", "Class"];
  /* SOP section 4: only the first line of each journal carries the date. sequential=true numbers journals 1..n across the file. */
  ME.toQboCsv = (journals, sequential) => {
    const out = [ME.QBO_COLS.join(",")]; let n = 0;
    for (const j of journals) {
      n++; const no = sequential ? n : j.journalNo;
      j.lines.forEach((l, i) => out.push([no, i === 0 ? j.date : "", l.account, l.debit === null ? "" : (l.debit / 100).toFixed(2), l.credit === null ? "" : (l.credit / 100).toFixed(2), l.description, l.name, "USD", "", l.cls].map(U.csvEscape).join(",")));
    }
    return out.join("\r\n") + "\r\n";
  };
})(typeof window !== "undefined" ? window : globalThis);
