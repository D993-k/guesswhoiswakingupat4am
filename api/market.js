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
