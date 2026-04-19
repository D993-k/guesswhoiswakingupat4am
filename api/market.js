const SYMBOL_MAP = {
  nifty: "^NSEI",
  sensex: "^BSESN",
  spx: "^GSPC",
  ndx: "^IXIC",
  ftse: "^FTSE",
  nikkei: "^N225",
  gold: "GC=F",
  silver: "SI=F",
  oil: "CL=F",
  bitcoin: "BTC-USD",
  usdInr: "USDINR=X",
  treasury10y: "^TNX",
};

const NSE_NIFTY_URL =
  "https://www.nseindia.com/static/products-services/indices-nifty50-index";
const OIL_DEMO_URL = "https://api.oilpriceapi.com/v1/demo/prices";

function buildChartUrl(symbol) {
  return `https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(
    symbol
  )}?interval=1d&range=1d`;
}

async function fetchChartQuote(symbol) {
  const response = await fetch(buildChartUrl(symbol), {
    headers: {
      "User-Agent": "the4am.finance market endpoint",
      Accept: "application/json",
    },
  });

  if (!response.ok) {
    throw new Error(`Quote fetch failed for ${symbol}`);
  }

  const data = await response.json();
  const result = data?.chart?.result?.[0];
  const meta = result?.meta;
  if (
    !meta ||
    typeof meta.regularMarketPrice !== "number" ||
    typeof meta.regularMarketChange !== "number" ||
    typeof meta.regularMarketChangePercent !== "number"
  ) {
    return null;
  }

  return {
    price: meta.regularMarketPrice,
    change: meta.regularMarketChange,
    changePct: meta.regularMarketChangePercent,
  };
}

function parseNumber(text) {
  if (!text) return null;
  const value = Number(String(text).replace(/,/g, "").trim());
  return Number.isFinite(value) ? value : null;
}

async function fetchNiftyFallback() {
  const response = await fetch(NSE_NIFTY_URL, {
    headers: {
      "User-Agent": "Mozilla/5.0",
      Accept: "text/html,application/xhtml+xml",
    },
  });
  if (!response.ok) return null;
  const html = await response.text();
  const priceMatch = html.match(/id="header-nifty-val">([^<]+)</);
  const changeMatch = html.match(/class="header-change">\s*([^<]+)</);
  const pctMatch = html.match(/class="header-perChange">\s*([^<]+)</);
  const up = /header-up-down[^>]*fa-caret-up/.test(html);
  const price = parseNumber(priceMatch?.[1]);
  const change = parseNumber(changeMatch?.[1]);
  const changePct = parseNumber(pctMatch?.[1]);
  if (price === null || change === null || changePct === null) return null;
  return {
    price,
    change: up ? change : -Math.abs(change),
    changePct: up ? changePct : -Math.abs(changePct),
  };
}

async function fetchOilFallback() {
  const response = await fetch(OIL_DEMO_URL, {
    headers: { Accept: "application/json" },
  });
  if (!response.ok) return null;
  const data = await response.json();
  const prices = data?.data?.prices || [];
  const wti = prices.find((item) => item.code === "WTI_USD");
  if (!wti || typeof wti.price !== "number") return null;
  const change = typeof wti.change_24h === "number" ? wti.change_24h : 0;
  const changePct = wti.price ? (change / wti.price) * 100 : 0;
  return {
    price: wti.price,
    change,
    changePct,
  };
}

export default async function handler(req, res) {
  if (req.method !== "GET") {
    res.setHeader("Allow", "GET");
    return res.status(405).json({ error: "Method not allowed" });
  }

  try {
    const entries = await Promise.all(
      Object.entries(SYMBOL_MAP).map(async ([key, symbol]) => {
        try {
          const quote = await fetchChartQuote(symbol);
          return [key, quote];
        } catch {
          return [key, null];
        }
      })
    );

    const quotes = Object.fromEntries(entries);
    if (!quotes.nifty) {
      try {
        quotes.nifty = await fetchNiftyFallback();
      } catch {}
    }
    if (!quotes.oil) {
      try {
        quotes.oil = await fetchOilFallback();
      } catch {}
    }
    const fxRate = quotes.usdInr?.price || null;

    const withInrPrice = (quote) =>
      quote && fxRate ? { ...quote, inrPrice: quote.price * fxRate } : null;

    const payload = {
      updatedAt: new Date().toISOString(),
      usdInr: quotes.usdInr,
      indices: {
        nifty: quotes.nifty,
        sensex: quotes.sensex,
        spx: quotes.spx,
        ndx: quotes.ndx,
        ftse: quotes.ftse,
        nikkei: quotes.nikkei,
      },
      commodities: {
        gold: withInrPrice(quotes.gold),
        silver: withInrPrice(quotes.silver),
        oil: withInrPrice(quotes.oil),
        bitcoin: withInrPrice(quotes.bitcoin),
      },
      treasury10y: quotes.treasury10y,
    };

    res.setHeader("Cache-Control", "s-maxage=60, stale-while-revalidate=300");
    return res.status(200).json(payload);
  } catch {
    return res.status(500).json({ error: "Market endpoint failed" });
  }
}
