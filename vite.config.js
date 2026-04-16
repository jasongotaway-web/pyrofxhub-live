import fs from 'node:fs';
import path from 'node:path';
import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

const FF_CALENDAR_URL = 'https://nfs.faireconomy.media/ff_calendar_thisweek.xml';
const FF_CACHE_FILE = path.resolve(process.cwd(), '.ff-calendar-cache.xml');
const FF_CACHE_MAX_AGE_MS = 15 * 60 * 1000;
const TV_SCANNER_URL = 'https://scanner.tradingview.com/cfd/scan';

function readFreshWeeklyCache() {
  try {
    if (!fs.existsSync(FF_CACHE_FILE)) return '';
    const stats = fs.statSync(FF_CACHE_FILE);
    const cacheAgeMs = Date.now() - stats.mtimeMs;
    if (cacheAgeMs > FF_CACHE_MAX_AGE_MS) return '';
    const xmlText = fs.readFileSync(FF_CACHE_FILE, 'utf8');
    return xmlText.includes('<weeklyevents>') ? xmlText : '';
  } catch {
    return '';
  }
}

function createForexFactoryCalendarPlugin() {
  let memoryCache = readFreshWeeklyCache();

  return {
    name: 'forexfactory-calendar-proxy',
    configureServer(server) {
      server.middlewares.use('/api/ff-calendar', async (_req, res) => {
        if (memoryCache.includes('<weeklyevents>')) {
          res.setHeader('Content-Type', 'text/xml; charset=utf-8');
          res.end(memoryCache);
          return;
        }

        try {
          const response = await fetch(FF_CALENDAR_URL, {
            headers: {
              'User-Agent':
                'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/135.0.0.0 Safari/537.36',
              Accept: 'application/xml,text/xml,*/*',
              'Accept-Language': 'en-US,en;q=0.9',
              'Cache-Control': 'no-cache',
            },
          });

          const xmlText = await response.text();
          if (response.ok && xmlText.includes('<weeklyevents>')) {
            memoryCache = xmlText;
            fs.writeFileSync(FF_CACHE_FILE, xmlText, 'utf8');
            res.setHeader('Content-Type', 'text/xml; charset=utf-8');
            res.end(xmlText);
            return;
          }
        } catch {
          // Fall through to cache if live fetch fails.
        }

        memoryCache = readFreshWeeklyCache();
        if (memoryCache.includes('<weeklyevents>')) {
          res.setHeader('Content-Type', 'text/xml; charset=utf-8');
          res.end(memoryCache);
          return;
        }

        res.statusCode = 503;
        res.setHeader('Content-Type', 'text/plain; charset=utf-8');
        res.end('ForexFactory calendar temporarily unavailable');
      });
    },
  };
}

function readRequestBody(req) {
  return new Promise((resolve, reject) => {
    let body = '';
    req.setEncoding('utf8');
    req.on('data', (chunk) => {
      body += chunk;
    });
    req.on('end', () => resolve(body));
    req.on('error', reject);
  });
}

function createTradingViewScannerProxyPlugin() {
  return {
    name: 'tradingview-xau-scanner-proxy',
    configureServer(server) {
      server.middlewares.use('/api/tv-xau-scan', async (req, res) => {
        if (req.method !== 'POST') {
          res.statusCode = 405;
          res.setHeader('Content-Type', 'text/plain; charset=utf-8');
          res.end('Method not allowed');
          return;
        }

        try {
          const requestBody = await readRequestBody(req);
          const response = await fetch(TV_SCANNER_URL, {
            method: 'POST',
            headers: {
              'Content-Type': 'application/json',
              Accept: 'application/json',
              Origin: 'https://www.tradingview.com',
              Referer: 'https://www.tradingview.com/',
              'User-Agent':
                'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/135.0.0.0 Safari/537.36',
            },
            body: requestBody,
          });

          const responseText = await response.text();
          res.statusCode = response.status;
          res.setHeader('Content-Type', response.headers.get('content-type') || 'application/json; charset=utf-8');
          res.end(responseText);
        } catch {
          res.statusCode = 503;
          res.setHeader('Content-Type', 'application/json; charset=utf-8');
          res.end(JSON.stringify({ error: 'TradingView scanner temporarily unavailable' }));
        }
      });
    },
  };
}

export default defineConfig({
  plugins: [react(), createForexFactoryCalendarPlugin(), createTradingViewScannerProxyPlugin()],
});
