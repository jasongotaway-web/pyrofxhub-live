const CONFIG = {
  symbol: 'XAUUSD',
  timeframe: '1m',
  pipSize: 0.1,
  defaultRR: 2.5,
  minSlPips: 20,
  maxSlPips: 80,
  atrPeriod: 14,
  fastEmaPeriod: 9,
  slowEmaPeriod: 21,
  structureLookback: 12,
  maxZoneDriftATR: 1.2,
  maxSetupAgeBuckets: 1,
  standbyProximityATR: 0.35,
  triggerProximityATR: 0.18,
  beTriggerR: 0.5,
  minInputPrice: 1000,
  maxInputPrice: 10000,
  minCandles: 40,
  maxCandleRange: 250,
  maxLiveCandleDrift: 75,
};

function round2(n) {
  const number = Number(n);
  return Number.isFinite(number) ? Number(number.toFixed(2)) : 0;
}

function clamp(n, min, max) {
  return Math.max(min, Math.min(max, n));
}

function toPips(distance) {
  return distance / CONFIG.pipSize;
}

function fromPips(pips) {
  return pips * CONFIG.pipSize;
}

function safeNumber(n, fallback = 0) {
  return Number.isFinite(Number(n)) ? Number(n) : fallback;
}

function isValidPrice(n) {
  const number = Number(n);
  return Number.isFinite(number) && number >= CONFIG.minInputPrice && number <= CONFIG.maxInputPrice;
}

function sanitizeCandles(candles) {
  if (!Array.isArray(candles)) return [];

  return candles
    .map((candle) => {
      const time = Number(candle?.time);
      const open = Number(candle?.open);
      const high = Number(candle?.high);
      const low = Number(candle?.low);
      const close = Number(candle?.close);

      if (![open, high, low, close].every(isValidPrice)) return null;
      if (high < Math.max(open, close) || low > Math.min(open, close)) return null;
      if (high - low <= 0 || high - low > CONFIG.maxCandleRange) return null;

      return {
        time: Number.isFinite(time) && time > 0 ? time : 0,
        open: round2(open),
        high: round2(high),
        low: round2(low),
        close: round2(close),
      };
    })
    .filter(Boolean)
    .sort((a, b) => a.time - b.time)
    .slice(-80);
}

function buildStandbySignal({
  timeframe,
  bucketId,
  livePrice,
  status = 'No Valid Setup',
  explanation,
  gateReason = 'invalid_setup',
  meta = {},
}) {
  const displayPrice = isValidPrice(livePrice) ? round2(livePrice) : null;

  return {
    symbol: CONFIG.symbol,
    timeframe,
    title: `WAIT ${CONFIG.symbol}`,
    side: 'WAIT',
    confidence: 50,
    entry: displayPrice,
    stop: null,
    target: null,
    bePrice: null,
    livePrice: displayPrice,
    validity: 'STANDBY',
    status,
    progressPercent: 0,
    explanation: explanation || 'Waiting for valid chart-aligned market data before generating a setup.',
    stopPips: null,
    rr: null,
    generatedAt: new Date().toISOString(),
    bucketId,
    meta: {
      ...meta,
      inputReady: false,
      gateReason,
    },
  };
}

function ema(values, period) {
  if (!values.length) return [];
  const k = 2 / (period + 1);
  const out = [values[0]];
  for (let i = 1; i < values.length; i += 1) {
    out.push(values[i] * k + out[i - 1] * (1 - k));
  }
  return out;
}

function calculateATR(candles, period = CONFIG.atrPeriod) {
  if (!candles || candles.length < 2) return 0;
  const trs = [];
  for (let i = 1; i < candles.length; i += 1) {
    const cur = candles[i];
    const prev = candles[i - 1];
    const tr = Math.max(
      cur.high - cur.low,
      Math.abs(cur.high - prev.close),
      Math.abs(cur.low - prev.close)
    );
    trs.push(tr);
  }
  const recent = trs.slice(-period);
  if (!recent.length) return 0;
  return recent.reduce((a, b) => a + b, 0) / recent.length;
}

function getStructure(candles, lookback = CONFIG.structureLookback) {
  const slice = candles.slice(-(lookback + 1), -1);
  if (!slice.length) {
    return {
      recentHigh: null,
      recentLow: null,
      midpoint: null,
    };
  }

  const highs = slice.map((c) => c.high);
  const lows = slice.map((c) => c.low);
  const recentHigh = Math.max(...highs);
  const recentLow = Math.min(...lows);
  const midpoint = (recentHigh + recentLow) / 2;

  return { recentHigh, recentLow, midpoint };
}

function getTrend(candles) {
  const closes = candles.map((c) => c.close);
  const fast = ema(closes, CONFIG.fastEmaPeriod);
  const slow = ema(closes, CONFIG.slowEmaPeriod);

  const fastNow = fast[fast.length - 1] ?? closes[closes.length - 1];
  const fastPrev = fast[fast.length - 2] ?? fastNow;
  const slowNow = slow[slow.length - 1] ?? closes[closes.length - 1];
  const slowPrev = slow[slow.length - 2] ?? slowNow;

  const fastSlope = fastNow - fastPrev;
  const slowSlope = slowNow - slowPrev;

  return {
    fastNow,
    slowNow,
    fastSlope,
    slowSlope,
    bullishBias: fastNow > slowNow && fastSlope >= 0,
    bearishBias: fastNow < slowNow && fastSlope <= 0,
  };
}

function getMomentum(candles, span = 5) {
  if (candles.length < span + 1) return 0;
  const now = candles[candles.length - 1].close;
  const prev = candles[candles.length - 1 - span].close;
  return now - prev;
}

function getVolRegime(candles) {
  const shortAtr = calculateATR(candles, 14);
  const longAtr = calculateATR(candles, 40) || shortAtr;
  const ratio = longAtr === 0 ? 1 : shortAtr / longAtr;

  if (ratio < 0.85) return 'LOW';
  if (ratio > 1.2) return 'HIGH';
  return 'NORMAL';
}

function detectStrictDirectionalBias({ livePrice, structure, trend, momentum }) {
  const { recentHigh, recentLow, midpoint } = structure;
  if (recentHigh == null || recentLow == null || midpoint == null) {
    return { side: 'WAIT', reason: 'No structure' };
  }

  if (livePrice > recentHigh && trend.bullishBias && momentum > 0) {
    return { side: 'BUY', reason: 'Bullish breakout with trend support' };
  }

  if (livePrice < recentLow && trend.bearishBias && momentum < 0) {
    return { side: 'SELL', reason: 'Bearish breakdown with trend support' };
  }

  if (trend.bullishBias && livePrice >= midpoint && momentum >= 0) {
    return { side: 'BUY', reason: 'Bullish internal bias' };
  }

  if (trend.bearishBias && livePrice <= midpoint && momentum <= 0) {
    return { side: 'SELL', reason: 'Bearish internal bias' };
  }

  return { side: 'WAIT', reason: 'No clean directional edge' };
}

function detectDirectionalBias({ livePrice, structure, trend, momentum, atrValue }) {
  const strictBias = detectStrictDirectionalBias({ livePrice, structure, trend, momentum });
  if (strictBias.side !== 'WAIT') {
    return {
      ...strictBias,
      legacyBlockingCondition: '',
      actionableCondition: 'strict_directional_edge',
      directionScore: strictBias.side === 'BUY' ? 4 : -4,
    };
  }

  const { recentHigh, recentLow, midpoint } = structure;
  if (recentHigh == null || recentLow == null || midpoint == null) {
    return {
      side: 'WAIT',
      reason: strictBias.reason,
      legacyBlockingCondition: strictBias.reason,
      actionableCondition: 'none',
      directionScore: 0,
    };
  }

  const range = Math.max(recentHigh - recentLow, atrValue || 0, fromPips(CONFIG.minSlPips));
  const momentumUnit = Math.max(atrValue || 0, fromPips(8));
  const normalizedMomentum = momentum / momentumUnit;
  const upperReactionZone = recentHigh - range * 0.28;
  const lowerReactionZone = recentLow + range * 0.28;
  let buyScore = 0;
  let sellScore = 0;

  if (trend.bullishBias) buyScore += 1.7;
  if (trend.bearishBias) sellScore += 1.7;

  if (trend.fastNow > trend.slowNow) buyScore += 0.9;
  if (trend.fastNow < trend.slowNow) sellScore += 0.9;
  if (trend.fastSlope > 0) buyScore += 0.65;
  if (trend.fastSlope < 0) sellScore += 0.65;
  if (trend.slowSlope > 0) buyScore += 0.35;
  if (trend.slowSlope < 0) sellScore += 0.35;

  if (normalizedMomentum > 0.18) buyScore += 0.95;
  if (normalizedMomentum < -0.18) sellScore += 0.95;
  if (normalizedMomentum > 0.65) buyScore += 0.45;
  if (normalizedMomentum < -0.65) sellScore += 0.45;

  if (livePrice >= midpoint) buyScore += 0.45;
  if (livePrice <= midpoint) sellScore += 0.45;
  if (livePrice >= upperReactionZone && normalizedMomentum < -0.1) sellScore += 0.7;
  if (livePrice <= lowerReactionZone && normalizedMomentum > 0.1) buyScore += 0.7;

  const topSide = buyScore >= sellScore ? 'BUY' : 'SELL';
  const topScore = Math.max(buyScore, sellScore);
  const scoreMargin = Math.abs(buyScore - sellScore);
  const hasModerateDirectionalEdge = topScore >= 2.35 && scoreMargin >= 0.55;

  if (!hasModerateDirectionalEdge) {
    return {
      side: 'WAIT',
      reason: 'No clean directional edge',
      legacyBlockingCondition: strictBias.reason,
      actionableCondition: 'moderate_edge_score_failed',
      directionScore: round2(buyScore - sellScore),
    };
  }

  return {
    side: topSide,
    reason: topSide === 'BUY'
      ? 'Moderate bullish edge from trend, structure, and momentum'
      : 'Moderate bearish edge from trend, structure, and momentum',
    legacyBlockingCondition: strictBias.reason,
    actionableCondition: 'moderate_directional_edge',
    directionScore: round2(buyScore - sellScore),
  };
}

function buildCandidateSetup({ side, livePrice, structure, atrValue }) {
  if (side !== 'BUY' && side !== 'SELL') return null;
  const { recentHigh, recentLow } = structure;
  if (recentHigh == null || recentLow == null) return null;

  const minStopDist = fromPips(CONFIG.minSlPips);
  const maxStopDist = fromPips(CONFIG.maxSlPips);
  const atrGuard = Math.max(atrValue, minStopDist);

  if (side === 'BUY') {
    const entry = livePrice;
    let stop = Math.min(recentLow, entry - atrGuard * 0.75);
    let stopDistance = entry - stop;

    if (stopDistance < minStopDist) {
      stopDistance = minStopDist;
      stop = entry - stopDistance;
    }
    if (stopDistance > maxStopDist) return null;

    const target = entry + stopDistance * CONFIG.defaultRR;
    const bePrice = entry + stopDistance * CONFIG.beTriggerR;

    return {
      side,
      entry: round2(entry),
      stop: round2(stop),
      target: round2(target),
      bePrice: round2(bePrice),
      stopDistance: round2(stopDistance),
      stopPips: Math.round(toPips(stopDistance)),
    };
  }

  const entry = livePrice;
  let stop = Math.max(recentHigh, entry + atrGuard * 0.75);
  let stopDistance = stop - entry;

  if (stopDistance < minStopDist) {
    stopDistance = minStopDist;
    stop = entry + stopDistance;
  }
  if (stopDistance > maxStopDist) return null;

  const target = entry - stopDistance * CONFIG.defaultRR;
  const bePrice = entry - stopDistance * CONFIG.beTriggerR;

  return {
    side,
    entry: round2(entry),
    stop: round2(stop),
    target: round2(target),
    bePrice: round2(bePrice),
    stopDistance: round2(stopDistance),
    stopPips: Math.round(toPips(stopDistance)),
  };
}

function isSetupInCurrentMarketZone(setup, livePrice, atrValue) {
  if (!setup) return false;
  const maxDrift = Math.max(atrValue * CONFIG.maxZoneDriftATR, fromPips(CONFIG.minSlPips));
  const drift = Math.abs(livePrice - setup.entry);
  return drift <= maxDrift;
}

function isValidSetup(setup) {
  if (!setup || (setup.side !== 'BUY' && setup.side !== 'SELL')) return false;
  const entry = Number(setup.entry);
  const stop = Number(setup.stop);
  const target = Number(setup.target);
  const bePrice = Number(setup.bePrice);
  if (![entry, stop, target].every(isValidPrice)) return false;
  if (Number.isFinite(bePrice) && !isValidPrice(bePrice)) return false;

  const stopDistance = Math.abs(entry - stop);
  const targetDistance = Math.abs(target - entry);
  const stopPips = toPips(stopDistance);
  if (stopPips < CONFIG.minSlPips || stopPips > CONFIG.maxSlPips) return false;
  if (targetDistance <= 0 || targetDistance > stopDistance * 4) return false;

  if (setup.side === 'BUY') return stop < entry && target > entry;
  return stop > entry && target < entry;
}

function getSetupValidationFailure(setup) {
  if (!setup || (setup.side !== 'BUY' && setup.side !== 'SELL')) return 'invalid_setup';
  const entry = Number(setup.entry);
  const stop = Number(setup.stop);
  const target = Number(setup.target);
  const bePrice = Number(setup.bePrice);
  if (![entry, stop, target].every(isValidPrice)) return 'invalid_setup';
  if (Number.isFinite(bePrice) && !isValidPrice(bePrice)) return 'invalid_setup';

  const stopDistance = Math.abs(entry - stop);
  const targetDistance = Math.abs(target - entry);
  const stopPips = toPips(stopDistance);
  if (stopPips < CONFIG.minSlPips || stopPips > CONFIG.maxSlPips) return 'invalid_setup';
  if (targetDistance <= 0 || targetDistance > stopDistance * 4) return 'invalid_rr';

  if (setup.side === 'BUY' && !(stop < entry && target > entry)) return 'invalid_setup';
  if (setup.side === 'SELL' && !(stop > entry && target < entry)) return 'invalid_setup';
  return '';
}

function calcProgressPercent(setup, livePrice) {
  if (!setup) return 0;
  if (setup.side === 'BUY') {
    return clamp(((livePrice - setup.entry) / (setup.target - setup.entry)) * 100, 0, 100);
  }
  if (setup.side === 'SELL') {
    return clamp(((setup.entry - livePrice) / (setup.entry - setup.target)) * 100, 0, 100);
  }
  return 0;
}

function calcTriggerState(setup, livePrice, atrValue) {
  if (!setup) {
    return {
      title: `WAIT ${CONFIG.symbol}`,
      validity: 'STANDBY',
      status: 'No Valid Setup',
      progressPercent: 0,
      explanation: 'No clean setup is available in the current chart-aligned market zone.',
    };
  }

  const proximity = Math.abs(livePrice - setup.entry);
  const triggerBand = Math.max(atrValue * CONFIG.triggerProximityATR, fromPips(5));
  const standbyBand = Math.max(atrValue * CONFIG.standbyProximityATR, fromPips(8));

  if (setup.side === 'BUY') {
    if (livePrice <= setup.stop) {
      return {
        title: `BUY ${CONFIG.symbol}`,
        validity: 'INVALIDATED',
        status: 'SL',
        progressPercent: 0,
        explanation: 'Stop loss was hit. This result remains locked until the next refresh cycle.',
      };
    }

    if (livePrice >= setup.target) {
      return {
        title: `BUY ${CONFIG.symbol}`,
        validity: 'COMPLETED',
        status: 'PROFIT SECURE',
        progressPercent: 100,
        explanation: 'Target was reached. This setup is complete and the next refresh will generate a fresh signal.',
      };
    }

    if (livePrice < setup.entry && proximity > standbyBand) {
      return {
        title: `WAIT ${CONFIG.symbol}`,
        validity: 'STANDBY',
        status: 'Standby',
        progressPercent: 0,
        explanation: `Wait for cleaner confirmation closer to ${setup.entry} before assigning directional risk.`,
      };
    }

    return {
      title: `BUY ${CONFIG.symbol}`,
      validity: 'VALID',
      status: proximity <= triggerBand ? 'Trigger Ready' : 'Signal Active',
      progressPercent: round2(calcProgressPercent(setup, livePrice)),
      explanation: `BUY thesis remains valid while price respects ${setup.stop}.`,
    };
  }

  if (livePrice >= setup.stop) {
    return {
      title: `SELL ${CONFIG.symbol}`,
      validity: 'INVALIDATED',
      status: 'SL',
      progressPercent: 0,
      explanation: 'Stop loss was hit. This result remains locked until the next refresh cycle.',
    };
  }

  if (livePrice <= setup.target) {
    return {
      title: `SELL ${CONFIG.symbol}`,
      validity: 'COMPLETED',
      status: 'PROFIT SECURE',
      progressPercent: 100,
      explanation: 'Target was reached. This setup is complete and the next refresh will generate a fresh signal.',
    };
  }

  if (livePrice > setup.entry && proximity > standbyBand) {
    return {
      title: `WAIT ${CONFIG.symbol}`,
      validity: 'STANDBY',
      status: 'Standby',
      progressPercent: 0,
      explanation: `Wait for cleaner confirmation closer to ${setup.entry} before assigning directional risk.`,
    };
  }

  return {
    title: `SELL ${CONFIG.symbol}`,
    validity: 'VALID',
    status: proximity <= triggerBand ? 'Trigger Ready' : 'Signal Active',
    progressPercent: round2(calcProgressPercent(setup, livePrice)),
    explanation: `SELL thesis remains valid while price stays below ${setup.stop}.`,
  };
}

function scoreConfidence({ side, trend, volRegime, momentum, zoneAligned }) {
  let score = 68;

  if (side === 'BUY' && trend.bullishBias) score += 10;
  if (side === 'SELL' && trend.bearishBias) score += 10;

  if (side === 'BUY' && momentum > 0) score += 6;
  if (side === 'SELL' && momentum < 0) score += 6;

  if (volRegime === 'NORMAL') score += 5;
  if (volRegime === 'HIGH') score += 2;

  if (zoneAligned) score += 5;
  if (side === 'WAIT') score -= 8;

  return clamp(round2(score), 52, 98);
}

export function buildPyroSignalV2({
  candles,
  livePrice,
  timeframe = CONFIG.timeframe,
  bucketId = null,
  previousSignal = null,
  inputReady = true,
  invalidReason = '',
  inputGateReason = '',
  source = 'unknown',
}) {
  const normalizedTimeframe = String(timeframe || CONFIG.timeframe);
  const safeCandles = sanitizeCandles(candles);
  const fallbackLivePrice = safeCandles[safeCandles.length - 1]?.close;
  const currentPriceCandidate = isValidPrice(livePrice) ? Number(livePrice) : fallbackLivePrice;

  if (!inputReady) {
    const liveFeedUnavailable = inputGateReason === 'invalid_source' && source === 'scanner-unavailable';
    return buildStandbySignal({
      timeframe: normalizedTimeframe,
      bucketId,
      livePrice: currentPriceCandidate,
      explanation: invalidReason || 'Waiting for verified live signal inputs.',
      status: liveFeedUnavailable ? 'SIGNAL PAUSED' : 'No Valid Setup',
      gateReason: inputGateReason || 'invalid_candles',
      meta: { source },
    });
  }

  if (safeCandles.length < CONFIG.minCandles || !isValidPrice(currentPriceCandidate)) {
    return buildStandbySignal({
      timeframe: normalizedTimeframe,
      bucketId,
      livePrice: currentPriceCandidate,
      explanation: 'Not enough valid chart-aligned candle data to generate a setup.',
      gateReason: safeCandles.length < CONFIG.minCandles ? 'insufficient_candles' : 'invalid_live_price',
      meta: { source, candleCount: safeCandles.length },
    });
  }

  const latestClose = safeCandles[safeCandles.length - 1].close;
  if (Math.abs(currentPriceCandidate - latestClose) > CONFIG.maxLiveCandleDrift) {
    return buildStandbySignal({
      timeframe: normalizedTimeframe,
      bucketId,
      livePrice: currentPriceCandidate,
      explanation: 'Live price and candle feed are not aligned enough to generate a setup.',
      gateReason: 'live_price_mismatch',
      meta: { source, latestClose: round2(latestClose) },
    });
  }

  const currentPrice = round2(currentPriceCandidate);
  const structure = getStructure(safeCandles);
  const trend = getTrend(safeCandles);
  const atrValue = calculateATR(safeCandles, CONFIG.atrPeriod);
  const momentum = getMomentum(safeCandles);
  const volRegime = getVolRegime(safeCandles);

  const bias = detectDirectionalBias({
    livePrice: currentPrice,
    structure,
    trend,
    momentum,
    atrValue,
  });

  let candidateSetup = buildCandidateSetup({
    side: bias.side,
    livePrice: currentPrice,
    structure,
    atrValue,
  });

  let setupGateReason = bias.side === 'WAIT' ? 'no_actionable_thesis' : getSetupValidationFailure(candidateSetup);

  if (setupGateReason) {
    candidateSetup = null;
  }

  const zoneAligned = isSetupInCurrentMarketZone(candidateSetup, currentPrice, atrValue);

  if (!zoneAligned) {
    if (!setupGateReason && bias.side !== 'WAIT') setupGateReason = 'invalid_setup';
    candidateSetup = null;
  }

  const previousSetup = previousSignal
    ? {
        side: previousSignal.side,
        entry: previousSignal.entry,
        stop: previousSignal.stop,
        target: previousSignal.target,
        bePrice: previousSignal.bePrice,
      }
    : null;
  const prevSameBucket = previousSignal && previousSignal.bucketId === bucketId;
  const prevSetupStillUsable =
    prevSameBucket &&
    isValidSetup(previousSetup) &&
    Math.abs(currentPrice - previousSignal.entry) <= Math.max(atrValue, fromPips(CONFIG.minSlPips));

  let activeSetup = candidateSetup;

  if (!activeSetup && prevSetupStillUsable) {
    activeSetup = {
      side: previousSetup.side,
      entry: round2(previousSetup.entry),
      stop: round2(previousSetup.stop),
      target: round2(previousSetup.target),
      bePrice: round2(previousSetup.bePrice),
      stopDistance: round2(Math.abs(previousSetup.entry - previousSetup.stop)),
      stopPips: Math.round(toPips(Math.abs(previousSetup.entry - previousSetup.stop))),
    };
    setupGateReason = '';
  }

  const state = calcTriggerState(activeSetup, currentPrice, atrValue);
  const hasActionableSetup = isValidSetup(activeSetup) && state.validity === 'VALID';
  const gateReason = hasActionableSetup
    ? 'actionable'
    : activeSetup && state.validity === 'STANDBY'
      ? 'waiting_for_trigger'
      : setupGateReason || getSetupValidationFailure(activeSetup) || 'invalid_setup';
  const confidence = hasActionableSetup
    ? scoreConfidence({
        side: state.title.startsWith('BUY') ? 'BUY' : state.title.startsWith('SELL') ? 'SELL' : 'WAIT',
        trend,
        volRegime,
        momentum,
        zoneAligned: true,
      })
    : 50;

  return {
    symbol: CONFIG.symbol,
    timeframe: normalizedTimeframe,
    title: state.title,
    side: state.title.startsWith('BUY')
      ? 'BUY'
      : state.title.startsWith('SELL')
        ? 'SELL'
        : 'WAIT',
    confidence,
    entry: activeSetup?.entry ?? round2(currentPrice),
    stop: activeSetup?.stop ?? null,
    target: activeSetup?.target ?? null,
    bePrice: activeSetup?.bePrice ?? null,
    livePrice: round2(currentPrice),
    validity: state.validity,
    status: state.status,
    progressPercent: state.progressPercent,
    explanation: state.explanation,
    stopPips: activeSetup?.stopPips ?? null,
    rr: activeSetup ? CONFIG.defaultRR : null,
    generatedAt: new Date().toISOString(),
    bucketId,
    meta: {
      inputReady: true,
      source,
      gateReason,
      setupThesisActionable: hasActionableSetup,
      setupValidationPassed: isValidSetup(activeSetup),
      biasReason: bias.reason,
      legacyBlockingCondition: bias.legacyBlockingCondition || '',
      actionableCondition: bias.actionableCondition || '',
      directionScore: Number.isFinite(bias.directionScore) ? round2(bias.directionScore) : 0,
      volRegime,
      momentum: round2(momentum),
      atr: round2(atrValue),
      recentHigh: structure.recentHigh ? round2(structure.recentHigh) : null,
      recentLow: structure.recentLow ? round2(structure.recentLow) : null,
      zoneAligned: !!activeSetup,
    },
  };
}
