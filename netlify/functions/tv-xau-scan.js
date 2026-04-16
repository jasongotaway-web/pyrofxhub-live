const TRADINGVIEW_SCANNER_URL = 'https://scanner.tradingview.com/cfd/scan';
const DEFAULT_TIMEFRAME = '15';

function jsonResponse(statusCode, body) {
  return {
    statusCode,
    headers: {
      'Content-Type': 'application/json',
      'Cache-Control': 'no-store',
    },
    body: JSON.stringify(body),
  };
}

function sanitizeTimeframe(value) {
  return String(value ?? DEFAULT_TIMEFRAME).replace(/[^0-9A-Z]/gi, '') || DEFAULT_TIMEFRAME;
}

function inferTimeframeFromPayload(payload) {
  const explicit = payload?.timeframe ?? payload?.resolution;
  if (explicit) return sanitizeTimeframe(explicit);

  const columns = Array.isArray(payload?.columns) ? payload.columns : [];
  const timedColumn = columns.find((column) => String(column).includes('|'));
  const [, timeframe] = String(timedColumn ?? '').split('|');
  return sanitizeTimeframe(timeframe);
}

function getResolutionSeconds(resolution) {
  const normalized = sanitizeTimeframe(resolution).toUpperCase();
  if (normalized === '1') return 60;
  if (normalized === '5') return 5 * 60;
  if (normalized === '15') return 15 * 60;
  if (normalized === '30') return 30 * 60;
  if (normalized === '60' || normalized === '1H') return 60 * 60;
  if (normalized === '240' || normalized === '4H') return 4 * 60 * 60;
  if (normalized === '1D' || normalized === 'D') return 24 * 60 * 60;
  return 15 * 60;
}

function roundPrice(value) {
  return Math.round(Number(value) * 100) / 100;
}

function isFinitePrice(value) {
  const number = Number(value);
  return Number.isFinite(number) && number > 1000 && number < 10000;
}

function buildXauScanPayload(timeframe) {
  const tf = sanitizeTimeframe(timeframe);

  return {
    symbols: { tickers: ['OANDA:XAUUSD'], query: { types: [] } },
    columns: [
      'close',
      `open|${tf}`,
      `high|${tf}`,
      `low|${tf}`,
      `close|${tf}`,
      `open[1]|${tf}`,
      `high[1]|${tf}`,
      `low[1]|${tf}`,
      `close[1]|${tf}`,
    ],
  };
}

function isXauSignalRequest(payload) {
  const tickers = payload?.symbols?.tickers;
  const columns = payload?.columns;
  return (
    Array.isArray(tickers) &&
    tickers.length === 1 &&
    tickers[0] === 'OANDA:XAUUSD' &&
    Array.isArray(columns) &&
    columns.some((column) => String(column).startsWith('open|')) &&
    columns.some((column) => String(column).startsWith('close[1]|'))
  );
}

function normalizeXauScannerBody(body, timeframe) {
  const values = body?.data?.[0]?.d;
  if (!Array.isArray(values)) return null;

  const [livePrice, open0, high0, low0, close0, open1, high1, low1, close1] = values.map((value) => Number(value));
  if (![livePrice, high0, low0, close0, high1, low1, close1].every(isFinitePrice)) {
    return null;
  }

  const now = Math.floor(Date.now() / 1000);
  const step = getResolutionSeconds(timeframe);
  const alignedNow = now - (now % step);
  const currentOpen = isFinitePrice(open0) ? open0 : close0;
  const previousOpen = isFinitePrice(open1) ? open1 : close1;

  return {
    ok: true,
    candles: [
      {
        time: alignedNow - step,
        open: roundPrice(previousOpen),
        high: roundPrice(high1),
        low: roundPrice(low1),
        close: roundPrice(close1),
      },
      {
        time: alignedNow,
        open: roundPrice(currentOpen),
        high: roundPrice(high0),
        low: roundPrice(low0),
        close: roundPrice(close0),
      },
    ],
    livePrice: roundPrice(livePrice),
    timeframe: sanitizeTimeframe(timeframe),
    source: 'netlify-tv-xau-scan',
    generatedAt: new Date().toISOString(),
  };
}

async function requestTradingViewScanner(payload) {
  const response = await fetch(TRADINGVIEW_SCANNER_URL, {
    method: 'POST',
    headers: {
      Accept: 'application/json',
      'Content-Type': 'application/json',
      Origin: 'https://www.tradingview.com',
      Referer: 'https://www.tradingview.com/',
      'User-Agent':
        'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36',
    },
    body: JSON.stringify(payload),
  });

  const text = await response.text();
  if (!response.ok) {
    return {
      ok: false,
      status: response.status,
      error: 'TradingView scanner unavailable',
    };
  }

  try {
    return {
      ok: true,
      status: response.status,
      body: JSON.parse(text),
    };
  } catch (_error) {
    return {
      ok: false,
      status: 502,
      error: 'Invalid TradingView scanner response',
    };
  }
}

export async function handler(event) {
  if (event.httpMethod !== 'POST') {
    return jsonResponse(405, { ok: false, error: 'Method not allowed' });
  }

  let incomingPayload = {};
  try {
    incomingPayload = event.body ? JSON.parse(event.body) : {};
  } catch (_error) {
    return jsonResponse(400, { ok: false, error: 'Invalid JSON request body' });
  }

  const timeframe = inferTimeframeFromPayload(incomingPayload);
  const signalRequest = isXauSignalRequest(incomingPayload);
  const scannerPayload = signalRequest ? buildXauScanPayload(timeframe) : incomingPayload;
  const scannerResult = await requestTradingViewScanner(scannerPayload);

  if (!scannerResult.ok) {
    return jsonResponse(scannerResult.status >= 400 ? scannerResult.status : 502, {
      ok: false,
      error: scannerResult.error,
      source: 'netlify-tv-xau-scan',
    });
  }

  if (!signalRequest) {
    return jsonResponse(200, {
      ok: true,
      source: 'netlify-tv-xau-scan',
      data: Array.isArray(scannerResult.body?.data) ? scannerResult.body.data : [],
      generatedAt: new Date().toISOString(),
    });
  }

  const normalized = normalizeXauScannerBody(scannerResult.body, timeframe);
  if (!normalized) {
    return jsonResponse(502, {
      ok: false,
      error: 'TradingView scanner payload missing valid XAUUSD data',
      source: 'netlify-tv-xau-scan',
    });
  }

  return jsonResponse(200, normalized);
}
