/* Default settings. Everything here is editable in the Settings tab (kept in this browser only). */
(function (g) {
  const ME = (g.ME = g.ME || {});
  ME.DEFAULTS = {
    accounts: {
      gygFee: "40002.1 Sales Revenue - Xola:Processing Fees:Processing Fees - Getyourguide",
      gygClearing: "10032.3 Sales Clearing Account:GYG Sales",
      groupFee: "40002.4 Sales Revenue - Xola:Processing Fees:Processing Fees - Groupon",
      groupClearing: "10032.2 Sales Clearing Account:Groupon Sales",
      airbnbFee: "40002.5 Sales Revenue - Xola:Processing Fees:Processing Fees - Airbnb",
      airbnbClearing: "10032.1 Sales Clearing Account:Airbnb Sales",
      viatorFee: "",            // CONFIRM (SOP open item)
      viatorPriceDiff: "",      // CONFIRM - Xola base vs Viator gross (Walkway dynamic pricing), not commission
      viatorClearing: "10032 Sales Clearing Account:Viator Sales",
      depExpense: "81000 Depreciation expenses",
      depAccum: "15150 Accumulated depreciation",
      jonathanExpense: "60230 Interest paid",
      jonathanAccrued: "21091 Accrued Interest",
      siaExpense: "60230 Interest paid",             // CONFIRM: own sub-account or shared with 60260
      siaCredit: "21091 Accrued Interest",           // CONFIRM: accrual that reverses next month
      cflCogs: "50015 Cost of Goods Sold:Costs of Goods Sold - Boats",
      cflMarketing: "60017 Advertising & marketing:Marketing",
      accountsPayable: "20000 Accounts Payable (A/P)",
      shorelineCogs: "50015 Cost of Goods Sold:Costs of Goods Sold - Boats",
      shorelineAccrued: "21090 Accrued Expenses",
      amortExpense: "80000 Amortization expenses",
      amortCredit: ""                                // CONFIRM: accumulated amortization account
    },
    names: { gyg: "GetYourGuide Deutschland GmbH", cfl: "CHICAGO FROM THE LAKE, LTD_CFL", shoreline: "", viator: "" },
    classes: {
      allowed: [
        "Empire Tours:Administrative", "Empire Tours:Amsterdam", "Empire Tours:Charleston", "Empire Tours:Chicago",
        "Empire Tours:Chicago:Chicago G&G", "Empire Tours:Chicago:Chicago Boats", "Empire Tours:London", "Empire Tours:Paris",
        "Empire Tours:SIA", "Empire Tours:Washington DC", "NYC"
      ],
      gygClearing: "Empire Tours:Administrative",
      boats: "Empire Tours:Chicago:Chicago Boats",
      admin: "Empire Tours:Administrative"
    },
    gygAccountToClass: {
      "388995": "Empire Tours:Amsterdam", "320550": "Empire Tours:London", "523096": "Empire Tours:Washington DC",
      "61752": "Empire Tours:Chicago:Chicago G&G", "307462": "Empire Tours:Chicago", "264454": "Empire Tours:Charleston",
      "701238": "Empire Tours:Paris", "248305": "NYC"
    },
    gygInvoiceToClass: {   // invoices that cannot be classed from product names (Chicago has two accounts)
      "000100711640": "Empire Tours:Chicago", "000100715070": "Empire Tours:Chicago:Chicago G&G",
      "000100721721": "Empire Tours:Chicago", "000100764378": "Empire Tours:Chicago",
      "000100779771": "Empire Tours:Chicago:Chicago G&G", "000100792941": "Empire Tours:Chicago"
    },
    gygProductKeywords: [
      ["Amsterdam", "Empire Tours:Amsterdam"], ["Paris", "Empire Tours:Paris"], ["London", "Empire Tours:London"],
      ["Charleston", "Empire Tours:Charleston"], ["Washington", "Empire Tours:Washington DC"],
      ["Arlington", "Empire Tours:Washington DC"], ["Capitol Hill", "Empire Tours:Washington DC"],
      ["New York", "NYC"], ["NYC", "NYC"]
    ],
    groupPayableToClass: {
      "empire tours and productions": "Empire Tours:Chicago",
      "empire tours productions dba gangsters and ghosts": "Empire Tours:Chicago:Chicago G&G",
      "nyc gangsters and ghosts tour": "NYC",
      "washington dc tours": "Empire Tours:Washington DC",
      "charleston tour company": "Empire Tours:Charleston"
    },
    airbnbListingToClass: {
      "Arlington Cemetery & Changing of the Guard": "Empire Tours:Washington DC",
      "Capitol Hill Guided Tour with Entry Tickets": "Empire Tours:Washington DC",
      "Sunset walking tour of the National Mall's icons": "Empire Tours:Washington DC",
      "Charleston History and Architecture Walking Tour": "Empire Tours:Charleston",
      "Charleston's Historic Downtown Food Tour": "Empire Tours:Charleston",
      "Chicago Gangsters & Ghosts Official Guided Tour": "Empire Tours:Chicago:Chicago G&G",
      "Food Tour of Chinatown & Little Italy in New York City": "NYC",
      "NYC: Gangsters and Ghosts Walking Tour": "NYC",
      "Small Group Churchill War Room & Westminster Tour": "Empire Tours:London"
    },
    depAssetClass: { "ET-1": "Empire Tours:Administrative", "ET-2": "Empire Tours:SIA", "ET-3": "Empire Tours:SIA" },
    cfl: {
      products: ["90-Minute Original Chicago River Boat Architecture Cruise", "75-Minute River Boat Architecture Tour"],
      notCfl: ["Cocktail Cruise", "Guided Historic Small Boat", "45-Minute Skyline Lake Tour", "Navy Pier Fireworks"],
      feePct: 9, cppPct: 32
    },
    shoreline: { sharePct: 70, excludePatterns: ["90"], exclude75: false },
    jonathan: { ratePct: 15, basis: 365 },
    variancePct: 30,
    fx: { "2026-08": { EUR: 1.1593, GBP: 1.3541 }, "2026-09": { EUR: 1.1512, GBP: 1.3416 } },
    history: { gyg: { "2026-08": 4384605 } }   // baseline totals in cents for the 30% check
  };
})(typeof window !== "undefined" ? window : globalThis);
