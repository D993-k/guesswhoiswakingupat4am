const SYMBOLS = [
  "^NSEI",
  "^BSESN",
  "^GSPC",
  "^IXIC",
  "^FTSE",
  "^N225",
  "GC=F",
  "SI=F",
  "CL=F",
  "BTC-USD",
  "USDINR=X",
  "^TNX",
];

const QUOTE_URL =
  "https://query1.finance.yahoo.com/v7/finance/quote?symbols=" +
  encodeURIComponent(SYMBOLS.join(","));

function pickQuote(resultMap, symbol) {
  const item = resultMap[symbol];
  if (!item) return null;
  const price = item.regularMarketPrice;
  const change = item.regularMarketChange;
  const changePct = item.regularMarketChangePercent;
  if (
    typeof price !== "number" ||
    typeof change !== "number" ||
    typeof changePct !== "number"
  ) {
    return null;
  }
  return { price, change, changePct };
}

export default async function handler(req, res) {
  if (req.method !== "GET") {
    res.setHeader("Allow", "GET");
    return res.status(405).json({ error: "Method not allowed" });
  }

  try {
    const response = await fetch(QUOTE_URL, {
      headers: {
        "User-Agent": "the4am.finance market endpoint",
        Accept: "application/json",
      },
    });

    if (!response.ok) {
      return res.status(502).json({ error: "Upstream quote fetch failed" });
    }

    const data = await response.json();
    const results = data?.quoteResponse?.result || [];
    const resultMap = Object.fromEntries(results.map((item) => [item.symbol, item]));
    const usdInr = pickQuote(resultMap, "USDINR=X");
    const fxRate = usdInr?.price || null;

    const payload = {
      updatedAt: new Date().toISOString(),
      usdInr,
      indices: {
        nifty: pickQuote(resultMap, "^NSEI"),
        sensex: pickQuote(resultMap, "^BSESN"),
        spx: pickQuote(resultMap, "^GSPC"),
        ndx: pickQuote(resultMap, "^IXIC"),
        ftse: pickQuote(resultMap, "^FTSE"),
        nikkei: pickQuote(resultMap, "^N225"),
      },
      commodities: {
        gold: fxRate && pickQuote(resultMap, "GC=F")
          ? { ...pickQuote(resultMap, "GC=F"), inrPrice: pickQuote(resultMap, "GC=F").price * fxRate }
          : null,
        silver: fxRate && pickQuote(resultMap, "SI=F")
          ? { ...pickQuote(resultMap, "SI=F"), inrPrice: pickQuote(resultMap, "SI=F").price * fxRate }
          : null,
        oil: fxRate && pickQuote(resultMap, "CL=F")
          ? { ...pickQuote(resultMap, "CL=F"), inrPrice: pickQuote(resultMap, "CL=F").price * fxRate }
          : null,
        bitcoin: fxRate && pickQuote(resultMap, "BTC-USD")
          ? { ...pickQuote(resultMap, "BTC-USD"), inrPrice: pickQuote(resultMap, "BTC-USD").price * fxRate }
          : null,
      },
      treasury10y: pickQuote(resultMap, "^TNX"),
    };

    res.setHeader("Cache-Control", "s-maxage=60, stale-while-revalidate=300");
    return res.status(200).json(payload);
  } catch (error) {
    return res.status(500).json({ error: "Market endpoint failed" });
  }
}
