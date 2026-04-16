import React, { useState, useEffect, useMemo, useRef } from 'react';
import { buildPyroSignalV2 } from './lib/pyroSignalEngineV2.js';
import { 
  Flame,      
  Waves,
  Crosshair,
  Wand2,
  X,
  BookOpen,
  ArrowUpRight,
  ArrowDownRight,
  Crown,
  MessageCircle, 
  Send,
  Activity,
} from 'lucide-react';

/**
 * PYROFXHUB V2.5.0 - PRODUCTION READY
 * --------------------------------------------------
 * 1. 价格对标：使用 TradingView Ticker 解决物理同步问题
 * 2. 指标解锁：开放 Toolbar 以支持所有内置 Indicator
 * 3. 视觉还原：高度适配用户提供的截图细节
 */

const SIGNAL_REFRESH_MS = 10 * 60 * 1000;
const SIGNAL_CARD_REFRESH_MS = 10 * 60 * 1000;
const SHOW_SIGNAL_DEBUG = import.meta.env.VITE_SHOW_SIGNAL_DEBUG === 'true';
const APP_TIME_ZONE = 'Asia/Singapore';
const APP_GMT8_OFFSET_MS = 8 * 60 * 60 * 1000;
const WEB3FORMS_ACCESS_KEY = '3a2768c0-52df-46c3-a74e-fdbf1ffec7b6';
const WEB3FORMS_ENDPOINT = 'https://api.web3forms.com/submit';

function getSignalRefreshBucket(now = Date.now()) {
  return Math.floor(now / SIGNAL_REFRESH_MS);
}

function getSignalCardRefreshBucket(now = Date.now()) {
  return Math.floor(now / SIGNAL_CARD_REFRESH_MS);
}

function getSignalCardCountdownMs(now = Date.now()) {
  const remainder = now % SIGNAL_CARD_REFRESH_MS;
  return remainder === 0 ? SIGNAL_CARD_REFRESH_MS : SIGNAL_CARD_REFRESH_MS - remainder;
}

function formatSignalCountdown(ms) {
  const totalSeconds = Math.max(0, Math.floor(ms / 1000));
  const minutes = String(Math.floor(totalSeconds / 60)).padStart(2, '0');
  const seconds = String(totalSeconds % 60).padStart(2, '0');
  return `${minutes}:${seconds}`;
}

function formatSignalPrice(value, emptyLabel = 'Pending') {
  return Number.isFinite(value) && value > 0 ? value.toFixed(2) : emptyLabel;
}

function isValidWaitlistEmail(email) {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(String(email).trim());
}

function isValidWaitlistPhone(phone) {
  const normalized = String(phone).replace(/[\s().-]/g, '');
  return /^\+?\d{7,15}$/.test(normalized);
}

async function submitWeb3Form(fields) {
  const response = await fetch(WEB3FORMS_ENDPOINT, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Accept: 'application/json',
    },
    body: JSON.stringify({
      access_key: WEB3FORMS_ACCESS_KEY,
      from_name: 'PYROFXHUB Website',
      ...fields,
    }),
  });
  const result = await response.json().catch(() => ({}));

  if (!response.ok || result.success === false) {
    throw new Error('Web3Forms submission failed');
  }

  return result;
}

function buildSignalCardDisplay(signal) {
  const hasStop = Number.isFinite(signal.stop) && signal.stop > 0;
  const hasTarget = Number.isFinite(signal.target) && signal.target > 0;
  const hasTradableLevels = hasStop && hasTarget;
  const validity = signal.validity;
  const rawStatus = signal.status;
  const side = signal.side === 'BUY' || signal.side === 'SELL' ? signal.side : 'WAIT';

  if (!hasTradableLevels || side === 'WAIT' || validity === 'STANDBY') {
    return {
      readiness: 'WAITING',
      statusLabel: 'STANDBY',
      valid: false,
      actionText: 'No active setup is available yet.',
      explanation: '',
      invalidationText: 'Target and stop will appear after a valid setup is confirmed.',
    };
  }

  if (validity === 'INVALIDATED' || rawStatus === 'SL') {
    return {
      readiness: 'INVALIDATED',
      statusLabel: 'STOP LOSS HIT',
      valid: false,
      actionText: 'Stop loss was hit. Wait for the next clean refresh.',
      explanation: '',
      invalidationText: '',
    };
  }

  if (validity === 'COMPLETED' || rawStatus === 'PROFIT SECURE') {
    return {
      readiness: 'TARGET_HIT',
      statusLabel: 'TARGET HIT',
      valid: false,
      actionText: 'Target was reached. Do not chase extension.',
      explanation: '',
      invalidationText: '',
    };
  }

  return {
    readiness: rawStatus === 'Trigger Ready' ? 'READY' : 'IN_TRADE',
    statusLabel: rawStatus === 'Trigger Ready' ? 'TRIGGER READY' : 'SIGNAL ACTIVE',
    valid: validity === 'VALID',
    actionText: signal.explanation || `${side} setup is active.`,
    explanation: '',
    invalidationText:
      side === 'BUY'
        ? `Invalidation below ${signal.stop.toFixed(2)}.`
        : `Invalidation above ${signal.stop.toFixed(2)}.`,
  };
}

function getGmt8Parts(date = new Date()) {
  const gmt8Date = new Date(date.getTime() + APP_GMT8_OFFSET_MS);
  return {
    year: gmt8Date.getUTCFullYear(),
    month: gmt8Date.getUTCMonth() + 1,
    day: gmt8Date.getUTCDate(),
    weekday: gmt8Date.getUTCDay(),
    hour: gmt8Date.getUTCHours(),
    minute: gmt8Date.getUTCMinutes(),
  };
}

function createGmt8Date(year, month, day, hour = 0, minute = 0, second = 0) {
  return new Date(Date.UTC(year, month - 1, day, hour, minute, second, 0) - APP_GMT8_OFFSET_MS);
}

function formatGmt8Time(date, options = {}) {
  if (!(date instanceof Date) || Number.isNaN(date.getTime())) return '--';
  return date.toLocaleTimeString('en-US', {
    timeZone: APP_TIME_ZONE,
    hour: 'numeric',
    minute: '2-digit',
    hour12: true,
    ...options,
  });
}

function formatGmt8DateTime(date, locale = 'en-GB') {
  if (!(date instanceof Date) || Number.isNaN(date.getTime())) return '--';
  return date.toLocaleString(locale, { timeZone: APP_TIME_ZONE });
}

function getManualAlertConfig(inputs) {
  const entry = Number(inputs.entry);
  const stop = Number(inputs.stop);
  const target = Number(inputs.target);
  const hasAllValues = [inputs.entry, inputs.stop, inputs.target].every((value) => String(value).trim() !== '');
  const validNumbers = [entry, stop, target].every((value) => Number.isFinite(value));

  if (!hasAllValues || !validNumbers) {
    return { valid: false, entry, stop, target, direction: null, reason: 'Fill all levels' };
  }

  if (target === entry || stop === entry || stop === target) {
    return { valid: false, entry, stop, target, direction: null, reason: 'Levels must be distinct' };
  }

  const direction = target > entry ? 'target-above' : 'target-below';
  const stopOnCorrectSide = direction === 'target-above' ? stop < entry : stop > entry;
  if (!stopOnCorrectSide) {
    return { valid: false, entry, stop, target, direction, reason: 'Stop must sit opposite target' };
  }

  return { valid: true, entry, stop, target, direction, reason: '' };
}

function playManualAlertSound(audioContextRef, type) {
  try {
    const AudioCtx = window.AudioContext || window.webkitAudioContext;
    if (!AudioCtx) return;
    if (!audioContextRef.current) audioContextRef.current = new AudioCtx();

    const ctx = audioContextRef.current;
    if (ctx.state === 'suspended') ctx.resume();

    const now = ctx.currentTime;
    const gain = ctx.createGain();
    gain.gain.setValueAtTime(0.0001, now);
    gain.gain.exponentialRampToValueAtTime(type === 'profit' ? 0.16 : 0.2, now + 0.02);
    gain.gain.exponentialRampToValueAtTime(0.0001, now + (type === 'profit' ? 0.62 : 0.42));
    gain.connect(ctx.destination);

    const frequencies = type === 'profit' ? [660, 880, 1174] : [392, 294];
    frequencies.forEach((frequency, index) => {
      const oscillator = ctx.createOscillator();
      oscillator.type = type === 'profit' ? 'triangle' : 'sine';
      oscillator.frequency.setValueAtTime(frequency, now + index * 0.12);
      oscillator.connect(gain);
      oscillator.start(now + index * 0.12);
      oscillator.stop(now + index * 0.12 + (type === 'profit' ? 0.16 : 0.28));
    });
  } catch (_error) {
    // Keep the visual alert even if browser audio is blocked.
  }
}

const ARCHIVE_OUTCOMES = {
  WIN: 'WIN',
  LOSS: 'LOSS',
  OPEN: 'OPEN',
  NOT_TRIGGERED: 'NOT_TRIGGERED',
  INVALIDATED_BEFORE_ENTRY: 'INVALIDATED_BEFORE_ENTRY',
};

const ARCHIVE_REVIEW_STATUS = {
  QUALIFIED: 'QUALIFIED',
  WATCHED: 'WATCHED',
  FILTERED: 'FILTERED',
  MISSED: 'MISSED',
  PENDING: 'PENDING',
};

const ARCHIVE_MIN_SL_PIPS = 20;
const ARCHIVE_MAX_SL_PIPS = 80;
const ARCHIVE_DEFAULT_RR = 2.5;

function deriveArchiveRecord(record) {
  const hasValidDirection = record.direction === 'BUY' || record.direction === 'SELL';
  const hasValidEntry = Number.isFinite(record.entry) && record.entry > 0;
  const slWithinBand =
    Number.isFinite(record.slPips) &&
    record.slPips >= ARCHIVE_MIN_SL_PIPS &&
    record.slPips <= ARCHIVE_MAX_SL_PIPS;
  const rrValid = Number(record.rr) === ARCHIVE_DEFAULT_RR;

  const allowedOutcomeValues = Object.values(ARCHIVE_OUTCOMES);
  const allowedReviewValues = Object.values(ARCHIVE_REVIEW_STATUS);
  const requestedOutcome = allowedOutcomeValues.includes(record.outcome) ? record.outcome : ARCHIVE_OUTCOMES.OPEN;
  const requestedReviewStatus = allowedReviewValues.includes(record.reviewStatus)
    ? record.reviewStatus
    : ARCHIVE_REVIEW_STATUS.PENDING;
  const qualified = hasValidDirection && hasValidEntry && slWithinBand && rrValid;
  const normalizedReviewStatus = requestedReviewStatus === ARCHIVE_REVIEW_STATUS.QUALIFIED
    ? (qualified ? ARCHIVE_REVIEW_STATUS.QUALIFIED : ARCHIVE_REVIEW_STATUS.FILTERED)
    : requestedReviewStatus;
  const normalizedOutcome =
    normalizedReviewStatus === ARCHIVE_REVIEW_STATUS.QUALIFIED
      ? [ARCHIVE_OUTCOMES.WIN, ARCHIVE_OUTCOMES.LOSS, ARCHIVE_OUTCOMES.OPEN].includes(requestedOutcome)
        ? requestedOutcome
        : ARCHIVE_OUTCOMES.OPEN
      : normalizedReviewStatus === ARCHIVE_REVIEW_STATUS.FILTERED
        ? ARCHIVE_OUTCOMES.INVALIDATED_BEFORE_ENTRY
        : normalizedReviewStatus === ARCHIVE_REVIEW_STATUS.WATCHED || normalizedReviewStatus === ARCHIVE_REVIEW_STATUS.MISSED
          ? ARCHIVE_OUTCOMES.NOT_TRIGGERED
          : ARCHIVE_OUTCOMES.OPEN;
  const closed = normalizedOutcome === ARCHIVE_OUTCOMES.WIN || normalizedOutcome === ARCHIVE_OUTCOMES.LOSS;
  const countedInWinRate = qualified && normalizedReviewStatus === ARCHIVE_REVIEW_STATUS.QUALIFIED && closed;
  const normalizedTpResultPips =
    normalizedReviewStatus === ARCHIVE_REVIEW_STATUS.QUALIFIED && normalizedOutcome === ARCHIVE_OUTCOMES.WIN
      ? Math.round(record.slPips * ARCHIVE_DEFAULT_RR)
      : 0;
  const normalizedSlResultPips =
    normalizedReviewStatus === ARCHIVE_REVIEW_STATUS.QUALIFIED && normalizedOutcome === ARCHIVE_OUTCOMES.LOSS
      ? record.slPips
      : 0;

  return {
    ...record,
    outcome: normalizedOutcome,
    reviewStatus: normalizedReviewStatus,
    tpResultPips: normalizedTpResultPips,
    slResultPips: normalizedSlResultPips,
    qualified,
    closed,
    countedInWinRate,
  };
}

function roundPrice(value) {
  return Number(value.toFixed(2));
}

function pseudoNoise(seed) {
  const x = Math.sin(seed * 12.9898) * 43758.5453;
  return x - Math.floor(x);
}

function buildSignalMarketState({ bucket, latestPrice, previousState }) {
  const hasLivePrice = Number.isFinite(latestPrice);
  const derivedFallbackPrice = 4800 + ((bucket % 7) - 3) * 0.45;
  const canHoldCurrentBucketPrice = previousState?.bucket === bucket && Number.isFinite(previousState?.livePrice);
  const livePrice = roundPrice(
    hasLivePrice
      ? latestPrice
      : canHoldCurrentBucketPrice
        ? previousState.livePrice
        : derivedFallbackPrice
  );
  const candleCount = 64;
  const trendMode = bucket % 4;
  const seedBase = bucket * 97;
  const trendTarget =
    trendMode === 0 ? livePrice + 3.8 :
    trendMode === 1 ? livePrice - 3.6 :
    trendMode === 2 ? livePrice + 1.2 :
    livePrice - 1.1;

  let close = roundPrice(trendTarget);
  const candles = [];

  for (let i = 0; i < candleCount; i += 1) {
    const stepsLeft = candleCount - i;
    const driftToLive = (livePrice - close) / Math.max(1, stepsLeft);
    const directionalBias =
      trendMode === 0 ? 0.05 :
      trendMode === 1 ? -0.05 :
      trendMode === 2 ? 0.02 :
      -0.02;
    const wave = Math.sin((bucket + i) / 5) * 0.18;
    const noise = (pseudoNoise(seedBase + i) - 0.5) * 0.42;
    const nextClose = i === candleCount - 1
      ? livePrice
      : roundPrice(close + driftToLive + directionalBias + wave + noise);
    const open = roundPrice(close);
    const high = roundPrice(Math.max(open, nextClose) + 0.18 + pseudoNoise(seedBase + i + 200) * 0.42);
    const low = roundPrice(Math.min(open, nextClose) - 0.18 - pseudoNoise(seedBase + i + 400) * 0.42);
    candles.push({ open, high, low, close: nextClose });
    close = nextClose;
  }

  return {
    bucket,
    livePrice,
    candles,
    feedMode: hasLivePrice ? 'LIVE' : canHoldCurrentBucketPrice ? 'HELD' : 'STALE',
    generatedAt: new Date().toISOString(),
  };
}

function analyzeMarketState(signalMarketState) {
  const emaSeries = (values, period) => {
    const k = 2 / (period + 1);
    return values.reduce((acc, val, i) => {
      if (i === 0) return [val];
      acc.push(val * k + acc[i - 1] * (1 - k));
      return acc;
    }, []);
  };

  const rsiSeries = (values, period = 14) => {
    if (values.length <= period) return 50;
    let gains = 0;
    let losses = 0;
    for (let i = values.length - period; i < values.length; i += 1) {
      const delta = values[i] - values[i - 1];
      if (delta >= 0) gains += delta;
      else losses += Math.abs(delta);
    }
    if (losses === 0) return 100;
    const rs = gains / losses;
    return 100 - 100 / (1 + rs);
  };

  const getSwings = (candlesInput, lookback = 2) => {
    const highs = [];
    const lows = [];
    for (let i = lookback; i < candlesInput.length - lookback; i += 1) {
      const isHigh = Array.from({ length: lookback }, (_, j) => j + 1).every(
        (step) => candlesInput[i].high > candlesInput[i - step].high && candlesInput[i].high > candlesInput[i + step].high
      );
      const isLow = Array.from({ length: lookback }, (_, j) => j + 1).every(
        (step) => candlesInput[i].low < candlesInput[i - step].low && candlesInput[i].low < candlesInput[i + step].low
      );
      if (isHigh) highs.push({ index: i, price: candlesInput[i].high });
      if (isLow) lows.push({ index: i, price: candlesInput[i].low });
    }
    return { highs, lows };
  };

  const candles = signalMarketState.candles;
  const livePrice = signalMarketState.livePrice;

  const prev = candles[candles.length - 2];
  const latest = candles[candles.length - 1];
  const structureWindow = candles.slice(-26, -1);
  const prevWindow = candles.slice(-27, -2);
  const swings = getSwings(candles, 2);
  const recentSwingHigh = swings.highs[swings.highs.length - 1]?.price ?? Math.max(...structureWindow.map((c) => c.high));
  const recentSwingLow = swings.lows[swings.lows.length - 1]?.price ?? Math.min(...structureWindow.map((c) => c.low));
  const prevSwingHigh = swings.highs[swings.highs.length - 2]?.price ?? Math.max(...prevWindow.map((c) => c.high));
  const prevSwingLow = swings.lows[swings.lows.length - 2]?.price ?? Math.min(...prevWindow.map((c) => c.low));
  const recentHigh = recentSwingHigh;
  const recentLow = recentSwingLow;
  const prevHigh = prevSwingHigh;
  const prevLow = prevSwingLow;

  const bos = latest.close > recentHigh ? 'BULLISH' : latest.close < recentLow ? 'BEARISH' : 'NONE';
  const prevBreak = prev.close > prevHigh ? 'BULLISH' : prev.close < prevLow ? 'BEARISH' : 'NONE';
  const choch = bos !== 'NONE' && prevBreak !== 'NONE' && bos !== prevBreak ? `${bos} CHOCH` : 'NONE';

  let sweep = 'NONE';
  if (latest.high > recentHigh && latest.close < recentHigh) sweep = 'BUY-SIDE';
  if (latest.low < recentLow && latest.close > recentLow) sweep = sweep === 'NONE' ? 'SELL-SIDE' : 'BOTH';

  const midpoint = (recentHigh + recentLow) / 2;
  const eqBand = Math.max(0.08, (recentHigh - recentLow) * 0.08);
  const pdZone = livePrice > midpoint + eqBand ? 'PREMIUM' : livePrice < midpoint - eqBand ? 'DISCOUNT' : 'EQ';

  const tr = candles.slice(1).map((c, i) => {
    const pClose = candles[i].close;
    return Math.max(c.high - c.low, Math.abs(c.high - pClose), Math.abs(c.low - pClose));
  });
  const atr = tr.slice(-14).reduce((a, b) => a + b, 0) / 14;
  const atrLong = tr.slice(-30).reduce((a, b) => a + b, 0) / 30;

  const closes = candles.map((c) => c.close);
  const ema9 = emaSeries(closes, 9);
  const ema21 = emaSeries(closes, 21);
  const emaSlope = (ema9[ema9.length - 1] ?? 0) - (ema9[ema9.length - 2] ?? 0);
  const momentumRaw = (closes[closes.length - 1] - closes[closes.length - 6]) / Math.max(0.01, atr);
  const momentum = Math.max(-9.99, Math.min(9.99, momentumRaw));
  const volRegime = atr > atrLong * 1.15 ? 'HIGH' : atr < atrLong * 0.9 ? 'LOW' : 'NORMAL';
  const rsi = rsiSeries(closes, 14);
  const rangeExpansion = atr > atrLong * 1.06;

  const spread = 0.12;
  const spreadThreshold = 0.2;
  const spreadFilter = spread <= spreadThreshold ? 'PASS' : 'BLOCK';

  const bodies = candles.map((c) => Math.abs(c.close - c.open));
  const avgBody = bodies.slice(-20).reduce((a, b) => a + b, 0) / 20;
  const displacementIdx = [...candles.keys()].reverse().find((i) => i > 5 && bodies[i] > avgBody * 1.35);
  const obCandle = typeof displacementIdx === 'number' ? candles[displacementIdx] : candles[candles.length - 6];
  const orderBlockType = obCandle.close >= obCandle.open ? 'BULL' : 'BEAR';
  const orderBlock = `${orderBlockType} ${Math.min(obCandle.open, obCandle.close).toFixed(2)}-${Math.max(obCandle.open, obCandle.close).toFixed(2)}`;
  const fvg =
    candles[candles.length - 3].high < latest.low
      ? { type: 'BULL', low: candles[candles.length - 3].high, high: latest.low }
      : candles[candles.length - 3].low > latest.high
        ? { type: 'BEAR', low: latest.high, high: candles[candles.length - 3].low }
        : null;

  return {
    livePrice,
    bos,
    choch,
    sweep,
    pdZone,
    atr,
    emaSlope,
    momentum,
    volRegime,
    spreadFilter,
    spread,
    recentHigh,
    recentLow,
    midpoint,
    liquidityPools: { buySide: recentHigh, sellSide: recentLow },
    orderBlock,
    orderBlockType,
    rsi,
    ema21Last: ema21[ema21.length - 1] ?? closes[closes.length - 1],
    rangeExpansion,
    fvg,
    swings,
  };
}

function buildExecutionSignal(analysis, feedMode) {
  const directionScore =
    (analysis.bos === 'BULLISH' ? 2 : analysis.bos === 'BEARISH' ? -2 : 0) +
    (analysis.choch.includes('BULLISH') ? 1 : analysis.choch.includes('BEARISH') ? -1 : 0) +
    (analysis.emaSlope > 0.02 ? 1 : analysis.emaSlope < -0.02 ? -1 : 0) +
    (analysis.momentum > 0.35 ? 1 : analysis.momentum < -0.35 ? -1 : 0) +
    (analysis.pdZone === 'DISCOUNT' ? 0.5 : analysis.pdZone === 'PREMIUM' ? -0.5 : 0) +
    (analysis.sweep === 'SELL-SIDE' ? 1 : analysis.sweep === 'BUY-SIDE' ? -1 : 0) +
    (analysis.rsi > 54 ? 1 : analysis.rsi < 46 ? -1 : 0) +
    (analysis.orderBlockType === 'BULL' ? 0.5 : -0.5) +
    (analysis.rangeExpansion ? 0.5 : 0) +
    (analysis.fvg?.type === 'BULL' ? 0.5 : analysis.fvg?.type === 'BEAR' ? -0.5 : 0);

  const bias = directionScore >= 2 ? 'BUY' : directionScore <= -2 ? 'SELL' : 'WAIT';
  const tacticalSide = bias === 'WAIT' ? (directionScore >= 0 ? 'BUY' : 'SELL') : bias;
  const atr = Math.max(0.2, analysis.atr);
  const live = analysis.livePrice;
  const marketStateFresh = feedMode === 'LIVE';
  const latestContextDrift = Math.max(0, Math.abs(live - analysis.midpoint));

  let entry;
  let stop;
  let target;

  if (tacticalSide === 'BUY') {
    entry = Number((bias === 'WAIT' ? analysis.recentHigh + atr * 0.08 : Math.min(Math.max(live, analysis.midpoint), analysis.recentHigh)).toFixed(2));
    stop = Number((analysis.recentLow - atr * 0.18).toFixed(2));
    target = Number((entry + Math.max(atr * 2.1, (entry - stop) * 1.7)).toFixed(2));
  } else {
    entry = Number((bias === 'WAIT' ? analysis.recentLow - atr * 0.08 : Math.max(Math.min(live, analysis.midpoint), analysis.recentLow)).toFixed(2));
    stop = Number((analysis.recentHigh + atr * 0.18).toFixed(2));
    target = Number((entry - Math.max(atr * 2.1, (stop - entry) * 1.7)).toFixed(2));
  }

  const blocked = analysis.spreadFilter === 'BLOCK';
  const nearEntry = Math.abs(live - entry) <= Math.max(0.12, atr * 0.12);
  const setupDislocated = Math.abs(live - entry) > Math.max(1.1, atr * 1.25);
  const staleContext = !marketStateFresh && latestContextDrift > Math.max(1.4, atr * 1.15);
  const noValidSetup = staleContext || (bias !== 'WAIT' && setupDislocated);

  let readiness = 'WAITING';
  if (noValidSetup) readiness = 'WAITING';
  else if (blocked) readiness = 'BLOCKED';
  else if (bias === 'WAIT') readiness = 'WAITING';
  else if (tacticalSide === 'BUY' && live <= stop) readiness = 'INVALIDATED';
  else if (tacticalSide === 'SELL' && live >= stop) readiness = 'INVALIDATED';
  else if (tacticalSide === 'BUY' && live >= target) readiness = 'TARGET_HIT';
  else if (tacticalSide === 'SELL' && live <= target) readiness = 'TARGET_HIT';
  else if (nearEntry) readiness = 'READY';
  else if (tacticalSide === 'BUY' && live > entry) readiness = 'IN_TRADE';
  else if (tacticalSide === 'SELL' && live < entry) readiness = 'IN_TRADE';

  const confidence = Math.max(
    18,
    Math.min(
      98,
      46 +
        Math.abs(directionScore) * 11 +
        (analysis.volRegime === 'NORMAL' ? 6 : analysis.volRegime === 'HIGH' ? 3 : 0) +
        (analysis.spreadFilter === 'PASS' ? 8 : -10) +
        (analysis.rsi > 50 && tacticalSide === 'BUY' ? 5 : 0) +
        (analysis.rsi < 50 && tacticalSide === 'SELL' ? 5 : 0)
    )
  );

  const statusLabel =
    noValidSetup
      ? 'No Valid Setup'
      : readiness === 'BLOCKED'
        ? 'Spread Blocked'
        : readiness === 'INVALIDATED'
          ? 'Structure Failed'
          : readiness === 'TARGET_HIT'
            ? 'Target Reached'
            : readiness === 'IN_TRADE'
              ? 'Signal Active'
              : readiness === 'READY'
                ? 'Trigger Ready'
                : bias === 'WAIT'
                  ? 'Standby'
                  : 'Waiting For Trigger';

  const totalMove = tacticalSide === 'BUY' ? target - entry : entry - target;
  const completedMove = tacticalSide === 'BUY' ? live - entry : entry - live;
  const progress = totalMove > 0 ? Math.max(0, Math.min(100, (completedMove / totalMove) * 100)) : 0;
  const bePrice = tacticalSide === 'BUY'
    ? Number((entry + Math.abs(entry - stop) * 0.65).toFixed(2))
    : Number((entry - Math.abs(stop - entry) * 0.65).toFixed(2));
  const valid = readiness !== 'INVALIDATED' && readiness !== 'BLOCKED' && bias !== 'WAIT';
  const displayValid = !noValidSetup && valid;

  const actionText =
    noValidSetup
      ? 'Latest market movement has displaced the prior trigger zone. Wait for a fresh setup.'
      : readiness === 'BLOCKED'
        ? 'Hold execution. Spread conditions are not acceptable.'
        : bias === 'WAIT'
          ? `Wait for cleaner confirmation near ${entry.toFixed(2)} before assigning directional risk.`
          : readiness === 'READY'
            ? `${tacticalSide} setup is primed. User can monitor trigger quality at ${entry.toFixed(2)}.`
            : readiness === 'IN_TRADE'
              ? `${tacticalSide} thesis remains valid while price respects ${stop.toFixed(2)}.`
              : readiness === 'TARGET_HIT'
                ? 'Signal objective is complete. Do not chase extension.'
                : readiness === 'INVALIDATED'
                  ? 'Setup is invalidated. Wait for market structure to reset.'
                  : `Wait for price to align with the ${tacticalSide} trigger level.`;

  const explanation =
    noValidSetup
      ? 'The current 15-minute context no longer supports the previous trigger area, so the card stays on standby until a new setup is confirmed.'
      : readiness === 'BLOCKED'
        ? 'The setup is paused because current dealing conditions are not clean enough.'
        : bias === 'WAIT'
          ? 'The market has not confirmed a clean directional edge yet, so the signal remains on standby.'
          : tacticalSide === 'BUY'
            ? 'The signal stays valid because buyers are still defending structure and the current push remains constructive.'
            : 'The signal stays valid because sellers are still controlling structure and price has not repaired the breakdown.';

  const invalidationText =
    tacticalSide === 'BUY'
      ? `Invalidation below ${stop.toFixed(2)} with failed bullish structure.`
      : `Invalidation above ${stop.toFixed(2)} with failed bearish structure.`;

  return {
    side: noValidSetup ? 'WAIT' : bias,
    tacticalSide,
    readiness,
    statusLabel,
    confidence,
    livePrice: live,
    entry,
    stop,
    target,
    bePrice,
    valid: displayValid,
    progress,
    actionText,
    explanation,
    invalidationText,
  };
}

function clampValue(value, min, max) {
  return Math.max(min, Math.min(max, value));
}

function averageNumbers(values) {
  const valid = values.filter((value) => Number.isFinite(value));
  if (!valid.length) return 0;
  return valid.reduce((total, value) => total + value, 0) / valid.length;
}

function safeNumber(value, fallback = 0) {
  const number = Number(value);
  return Number.isFinite(number) ? number : fallback;
}

function formatLiquidityPrice(value) {
  return Number.isFinite(value) ? value.toFixed(2) : '--';
}

function formatLiquidityDistance(value) {
  return Number.isFinite(value) ? `${value.toFixed(2)}` : '--';
}

function getLiquiditySwings(candlesInput, lookback = 2) {
  const highs = [];
  const lows = [];

  for (let index = lookback; index < candlesInput.length - lookback; index += 1) {
    const candle = candlesInput[index];
    const isHigh = Array.from({ length: lookback }, (_, step) => step + 1).every(
      (step) => candle.high > candlesInput[index - step].high && candle.high > candlesInput[index + step].high
    );
    const isLow = Array.from({ length: lookback }, (_, step) => step + 1).every(
      (step) => candle.low < candlesInput[index - step].low && candle.low < candlesInput[index + step].low
    );

    if (isHigh) highs.push({ index, price: candle.high, time: candle.time });
    if (isLow) lows.push({ index, price: candle.low, time: candle.time });
  }

  return { highs, lows };
}

function groupLiquidityLevels(points, tolerance) {
  const sortedPoints = [...points].sort((a, b) => a.price - b.price);
  const groups = [];

  for (const point of sortedPoints) {
    const currentGroup = groups[groups.length - 1];
    if (!currentGroup || Math.abs(currentGroup.averagePrice - point.price) > tolerance) {
      groups.push({
        points: [point],
        averagePrice: point.price,
        latestIndex: point.index,
      });
      continue;
    }

    currentGroup.points.push(point);
    currentGroup.averagePrice = averageNumbers(currentGroup.points.map((entry) => entry.price));
    currentGroup.latestIndex = Math.max(currentGroup.latestIndex, point.index);
  }

  return groups.map((group) => ({
    price: roundPrice(group.averagePrice),
    count: group.points.length,
    latestIndex: group.latestIndex,
  }));
}

function getLocalDayKey(date) {
  const { year, month, day } = getGmt8Parts(date);
  return `${year}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
}

function getLocalWeekKey(date) {
  const parts = getGmt8Parts(date);
  const gmt8MidnightUtcMs = Date.UTC(parts.year, parts.month - 1, parts.day) - APP_GMT8_OFFSET_MS;
  return getLocalDayKey(new Date(gmt8MidnightUtcMs - parts.weekday * 24 * 60 * 60 * 1000));
}

function getSessionContext(now = new Date()) {
  const { hour } = getGmt8Parts(now);
  if (hour < 8) return 'Asia';
  if (hour < 13) return 'London';
  if (hour < 18) return 'New York';
  return 'Off-session';
}

function getLiquidityBaseWeight(type) {
  if (type === 'previousWeekHigh' || type === 'previousWeekLow') return 28;
  if (type === 'previousDayHigh' || type === 'previousDayLow') return 24;
  if (type === 'asiaHigh' || type === 'asiaLow') return 21;
  if (type === 'equalHighs' || type === 'equalLows') return 20;
  if (type === 'nearestAbove' || type === 'nearestBelow') return 18;
  if (type === 'intradaySwingHigh' || type === 'intradaySwingLow') return 16;
  if (type === 'clusteredHighs' || type === 'clusteredLows') return 15;
  return 12;
}

function classifyLiquiditySweepStatus(pool, candles, livePrice, tolerance) {
  if (!pool) return 'Not swept';

  const recentCandles = candles.slice(-8);
  const latest = recentCandles[recentCandles.length - 1] ?? candles[candles.length - 1];
  const threshold = tolerance * 0.1;

  if (pool.side === 'BUY') {
    const broken = recentCandles.some((candle) => candle.high >= pool.price);
    if (latest.high >= pool.price && latest.close < pool.price - threshold) return 'Swept + rejected';
    if (latest.close > pool.price + threshold || livePrice > pool.price + threshold) return 'Swept + accepted';
    if (broken) return 'Swept';
    if (livePrice < pool.price && Math.abs(pool.price - livePrice) <= tolerance * 1.25) return 'Sweep in progress';
    return 'Not swept';
  }

  const broken = recentCandles.some((candle) => candle.low <= pool.price);
  if (latest.low <= pool.price && latest.close > pool.price + threshold) return 'Swept + rejected';
  if (latest.close < pool.price - threshold || livePrice < pool.price - threshold) return 'Swept + accepted';
  if (broken) return 'Swept';
  if (livePrice > pool.price && Math.abs(livePrice - pool.price) <= tolerance * 1.25) return 'Sweep in progress';
  return 'Not swept';
}

function getLiquidityDisplayStatus(sweepStatus) {
  if (sweepStatus === 'Swept + accepted') return 'Accepted';
  if (sweepStatus === 'Swept + rejected') return 'Rejected';
  if (sweepStatus === 'Swept') return 'Swept';
  return 'Untouched';
}

function buildLiquidityDecision({ candles, livePrice, newsLockState, now = new Date() }) {
  const normalizedCandles = [...(Array.isArray(candles) ? candles : [])]
    .filter((candle) =>
      candle &&
      [candle.open, candle.high, candle.low, candle.close].every((value) => Number.isFinite(value))
    )
    .sort((a, b) => safeNumber(a.time, 0) - safeNumber(b.time, 0));

  const defaultDecision = {
    summaryBias: 'Neutral',
    primaryTargetDisplay: 'No clean pool • --',
    sweepProbability: 50,
    sweepProbabilityLabel: 'Two-sided first',
    executionState: 'No trade',
    currentDraw: 'Neutral',
    primaryDraw: 'No clean pool',
    primaryPool: null,
    secondaryPool: null,
    sweepStatus: 'Not swept',
    postSweepRead: 'No confirmation',
    actionNow: newsLockState === 'LOCKED' ? 'No entry' : 'Wait for sweep',
    invalidation: 'No clean invalidation until a primary pool forms.',
    confirmation: {
      displacement: 'None',
      structureShift: 'None',
      rejectionQuality: 'None',
      volatilityExpansion: 'Compressed',
      sessionContext: getSessionContext(now),
      newsLock: newsLockState,
    },
    mapRows: [
      { label: 'Nearest Liquidity', above: null, below: null },
      { label: 'Equal Highs / Lows', above: null, below: null },
      { label: 'Previous Day', above: null, below: null },
      { label: 'Previous Week', above: null, below: null },
      { label: 'Asia Session', above: null, below: null },
      { label: 'Intraday Swings', above: null, below: null },
      { label: 'Local Clusters', above: null, below: null },
    ],
    currentPrice: Number.isFinite(livePrice) ? livePrice : null,
    currentRead: 'Liquidity map is waiting for more live structure.',
    bestCase: 'Wait for a clean sweep and reaction before framing execution.',
    doNothingIf: 'There is no confirmed liquidity interaction yet.',
    dataCoverage: {
      hasPreviousDay: false,
      hasPreviousWeek: false,
      hasAsiaRange: false,
    },
  };

  if (!Number.isFinite(livePrice) || normalizedCandles.length < 12) {
    return defaultDecision;
  }

  const tr = normalizedCandles.slice(1).map((candle, index) => {
    const previousClose = normalizedCandles[index].close;
    return Math.max(
      candle.high - candle.low,
      Math.abs(candle.high - previousClose),
      Math.abs(candle.low - previousClose)
    );
  });
  const atr = Math.max(0.12, averageNumbers(tr.slice(-14)) || averageNumbers(tr) || 0.12);
  const atrLong = Math.max(atr, averageNumbers(tr.slice(-30)) || atr);
  const tolerance = Math.max(0.08, atr * 0.18);
  const latest = normalizedCandles[normalizedCandles.length - 1];
  const closes = normalizedCandles.map((candle) => candle.close);
  const recentWindow = normalizedCandles.slice(-20);
  const recentHigh = Math.max(...recentWindow.map((candle) => candle.high));
  const recentLow = Math.min(...recentWindow.map((candle) => candle.low));
  const rangePosition = clampValue((livePrice - recentLow) / Math.max(recentHigh - recentLow, 0.01), 0, 1);
  const swings = getLiquiditySwings(normalizedCandles, 2);
  const recentHighGroups = groupLiquidityLevels(swings.highs, tolerance).filter((group) => group.count >= 2);
  const recentLowGroups = groupLiquidityLevels(swings.lows, tolerance).filter((group) => group.count >= 2);
  const recentSlice = normalizedCandles.slice(-16);
  const clusteredHighs = groupLiquidityLevels(
    recentSlice.map((candle, index) => ({ price: candle.high, index: normalizedCandles.length - recentSlice.length + index })),
    tolerance * 0.85
  ).filter((group) => group.count >= 3);
  const clusteredLows = groupLiquidityLevels(
    recentSlice.map((candle, index) => ({ price: candle.low, index: normalizedCandles.length - recentSlice.length + index })),
    tolerance * 0.85
  ).filter((group) => group.count >= 3);

  const candlesByDay = new Map();
  const candlesByWeek = new Map();
  for (const candle of normalizedCandles) {
    const date = new Date(safeNumber(candle.time, 0) * 1000);
    const dayKey = getLocalDayKey(date);
    const weekKey = getLocalWeekKey(date);
    if (!candlesByDay.has(dayKey)) candlesByDay.set(dayKey, []);
    if (!candlesByWeek.has(weekKey)) candlesByWeek.set(weekKey, []);
    candlesByDay.get(dayKey).push(candle);
    candlesByWeek.get(weekKey).push(candle);
  }

  const orderedDayKeys = Array.from(candlesByDay.keys()).sort();
  const orderedWeekKeys = Array.from(candlesByWeek.keys()).sort();
  const currentDayKey = orderedDayKeys[orderedDayKeys.length - 1];
  const previousDayKey = orderedDayKeys.length > 1 ? orderedDayKeys[orderedDayKeys.length - 2] : null;
  const previousWeekKey = orderedWeekKeys.length > 1 ? orderedWeekKeys[orderedWeekKeys.length - 2] : null;
  const currentDayCandles = candlesByDay.get(currentDayKey) ?? normalizedCandles;
  const previousDayCandles = previousDayKey ? candlesByDay.get(previousDayKey) ?? [] : [];
  const previousWeekCandles = previousWeekKey ? candlesByWeek.get(previousWeekKey) ?? [] : [];
  const asiaCandles = currentDayCandles.filter((candle) => {
    const date = new Date(safeNumber(candle.time, 0) * 1000);
    return getGmt8Parts(date).hour < 8;
  });
  const intradaySwings = getLiquiditySwings(currentDayCandles, 1);

  const createPool = ({ label, price, side, type, count = 1, latestIndex = normalizedCandles.length - 1 }) => {
    if (!Number.isFinite(price)) return null;
    const distance = Math.abs(price - livePrice);
    const recencyScore = clampValue(8 - (normalizedCandles.length - latestIndex) / 4, 0, 8);
    return {
      label,
      price: roundPrice(price),
      side,
      type,
      count,
      latestIndex,
      distance,
      distanceText: formatLiquidityDistance(distance),
      baseWeight: getLiquidityBaseWeight(type),
      recencyScore,
    };
  };

  const equalHighPool = recentHighGroups.length
    ? createPool({
        label: 'Equal Highs',
        price: recentHighGroups[recentHighGroups.length - 1].price,
        side: 'BUY',
        type: 'equalHighs',
        count: recentHighGroups[recentHighGroups.length - 1].count,
        latestIndex: recentHighGroups[recentHighGroups.length - 1].latestIndex,
      })
    : null;
  const equalLowPool = recentLowGroups.length
    ? createPool({
        label: 'Equal Lows',
        price: recentLowGroups[0].price,
        side: 'SELL',
        type: 'equalLows',
        count: recentLowGroups[0].count,
        latestIndex: recentLowGroups[0].latestIndex,
      })
    : null;
  const previousDayHighPool = previousDayCandles.length
    ? createPool({
        label: 'Previous Day High',
        price: Math.max(...previousDayCandles.map((candle) => candle.high)),
        side: 'BUY',
        type: 'previousDayHigh',
      })
    : null;
  const previousDayLowPool = previousDayCandles.length
    ? createPool({
        label: 'Previous Day Low',
        price: Math.min(...previousDayCandles.map((candle) => candle.low)),
        side: 'SELL',
        type: 'previousDayLow',
      })
    : null;
  const previousWeekHighPool = previousWeekCandles.length
    ? createPool({
        label: 'Previous Week High',
        price: Math.max(...previousWeekCandles.map((candle) => candle.high)),
        side: 'BUY',
        type: 'previousWeekHigh',
      })
    : null;
  const previousWeekLowPool = previousWeekCandles.length
    ? createPool({
        label: 'Previous Week Low',
        price: Math.min(...previousWeekCandles.map((candle) => candle.low)),
        side: 'SELL',
        type: 'previousWeekLow',
      })
    : null;
  const asiaHighPool = asiaCandles.length
    ? createPool({
        label: 'Asia High',
        price: Math.max(...asiaCandles.map((candle) => candle.high)),
        side: 'BUY',
        type: 'asiaHigh',
      })
    : null;
  const asiaLowPool = asiaCandles.length
    ? createPool({
        label: 'Asia Low',
        price: Math.min(...asiaCandles.map((candle) => candle.low)),
        side: 'SELL',
        type: 'asiaLow',
      })
    : null;
  const intradaySwingHighPool = intradaySwings.highs.length
    ? createPool({
        label: 'Intraday Swing High',
        price: intradaySwings.highs[intradaySwings.highs.length - 1].price,
        side: 'BUY',
        type: 'intradaySwingHigh',
        latestIndex: intradaySwings.highs[intradaySwings.highs.length - 1].index,
      })
    : null;
  const intradaySwingLowPool = intradaySwings.lows.length
    ? createPool({
        label: 'Intraday Swing Low',
        price: intradaySwings.lows[intradaySwings.lows.length - 1].price,
        side: 'SELL',
        type: 'intradaySwingLow',
        latestIndex: intradaySwings.lows[intradaySwings.lows.length - 1].index,
      })
    : null;
  const clusteredHighPool = clusteredHighs.length
    ? createPool({
        label: 'Clustered Highs',
        price: clusteredHighs[clusteredHighs.length - 1].price,
        side: 'BUY',
        type: 'clusteredHighs',
        count: clusteredHighs[clusteredHighs.length - 1].count,
        latestIndex: clusteredHighs[clusteredHighs.length - 1].latestIndex,
      })
    : null;
  const clusteredLowPool = clusteredLows.length
    ? createPool({
        label: 'Clustered Lows',
        price: clusteredLows[0].price,
        side: 'SELL',
        type: 'clusteredLows',
        count: clusteredLows[0].count,
        latestIndex: clusteredLows[0].latestIndex,
      })
    : null;

  const rawPools = [
    equalHighPool,
    equalLowPool,
    previousDayHighPool,
    previousDayLowPool,
    previousWeekHighPool,
    previousWeekLowPool,
    asiaHighPool,
    asiaLowPool,
    intradaySwingHighPool,
    intradaySwingLowPool,
    clusteredHighPool,
    clusteredLowPool,
  ].filter(Boolean);

  const uniquePools = Array.from(
    rawPools.reduce((map, pool) => {
      const key = `${pool.label}-${pool.side}-${pool.price.toFixed(2)}`;
      if (!map.has(key)) map.set(key, pool);
      return map;
    }, new Map()).values()
  );

  const pools = uniquePools.map((pool) => {
    const sweepStatus = classifyLiquiditySweepStatus(pool, normalizedCandles, livePrice, tolerance);
    const untouched = sweepStatus === 'Not swept' || sweepStatus === 'Sweep in progress';
    const sessionBoost =
      pool.type.startsWith('asia') && getSessionContext(now) === 'Asia'
        ? 5
        : (pool.type.startsWith('previousDay') || pool.type.startsWith('previousWeek')) && untouched
          ? 3
          : 1;
    const distanceScore = clampValue(14 - pool.distance / Math.max(atr * 0.35, 0.1), 0, 14);
    const clusterScore = Math.max(0, (pool.count - 1) * 3);
    return {
      ...pool,
      sweepStatus,
      untouched,
      weight: roundPrice(pool.baseWeight + clusterScore + pool.recencyScore + sessionBoost + distanceScore + (untouched ? 4 : 0)),
      relation:
        livePrice < pool.price - tolerance * 0.5
          ? 'above'
          : livePrice > pool.price + tolerance * 0.5
            ? 'below'
            : 'at-level',
    };
  });

  const abovePools = pools.filter((pool) => pool.relation === 'above').sort((a, b) => a.distance - b.distance || b.weight - a.weight);
  const belowPools = pools.filter((pool) => pool.relation === 'below').sort((a, b) => a.distance - b.distance || b.weight - a.weight);
  const nearestAbove = abovePools[0] ?? null;
  const nearestBelow = belowPools[0] ?? null;
  const poolByType = new Map(pools.map((pool) => [pool.type, pool]));
  const buySideWeight = averageNumbers(abovePools.slice(0, 3).map((pool) => pool.weight));
  const sellSideWeight = averageNumbers(belowPools.slice(0, 3).map((pool) => pool.weight));
  const momentum = (latest.close - closes[Math.max(0, closes.length - 6)]) / Math.max(atr, 0.01);
  const compression = (recentHigh - recentLow) / Math.max(atrLong * 6, 0.01) < 0.95;
  const aboveDistance = nearestAbove?.distance ?? atr * 2;
  const belowDistance = nearestBelow?.distance ?? atr * 2;
  const buyProbability = clampValue(
    50 +
      momentum * 8 +
      ((belowDistance - aboveDistance) / Math.max(atr, 0.01)) * 4 +
      (rangePosition > 0.58 ? 7 : rangePosition < 0.42 ? -7 : 0) +
      (buySideWeight - sellSideWeight) * 0.3 +
      (compression ? 4 : 0),
    8,
    92
  );
  const sellProbability = clampValue(
    50 -
      momentum * 8 +
      ((aboveDistance - belowDistance) / Math.max(atr, 0.01)) * 4 +
      (rangePosition < 0.42 ? 7 : rangePosition > 0.58 ? -7 : 0) +
      (sellSideWeight - buySideWeight) * 0.3 +
      (compression ? 4 : 0),
    8,
    92
  );

  let summaryBias = 'Neutral';
  if (Math.abs(buyProbability - sellProbability) <= 5) {
    summaryBias = rangePosition > 0.2 && rangePosition < 0.8 ? 'Two-sided pressure' : 'Neutral';
  } else if (buyProbability > sellProbability) {
    summaryBias = 'Buy-side favored';
  } else {
    summaryBias = 'Sell-side favored';
  }

  const favoredSide = buyProbability >= sellProbability ? 'BUY' : 'SELL';
  const favoredPools = favoredSide === 'BUY' ? abovePools : belowPools;
  const alternatePools = favoredSide === 'BUY' ? belowPools : abovePools;
  const primaryPool = favoredPools[0] ?? alternatePools[0] ?? null;
  const secondaryPool = favoredPools[1] ?? alternatePools[1] ?? favoredPools[0] ?? null;
  const activeSweepPool =
    pools
      .filter((pool) => pool.sweepStatus !== 'Not swept')
      .sort((a, b) => a.distance - b.distance || b.weight - a.weight)[0] ??
    primaryPool;
  const sweepStatus = activeSweepPool?.sweepStatus ?? 'Not swept';
  const postSweepRead =
    sweepStatus === 'Swept + rejected'
      ? 'Rejection likely'
      : sweepStatus === 'Swept + accepted'
        ? 'Acceptance likely'
        : sweepStatus === 'Sweep in progress'
          ? 'Monitor reaction'
          : 'No confirmation';

  const displacementRatio = Math.abs(latest.close - latest.open) / Math.max(averageNumbers(normalizedCandles.slice(-12).map((candle) => Math.abs(candle.close - candle.open))), 0.01);
  const displacement =
    displacementRatio > 1.55 ? 'Strong' : displacementRatio > 1.15 ? 'Weak' : 'None';
  const previousSwingHigh = swings.highs[swings.highs.length - 1]?.price ?? recentHigh;
  const previousSwingLow = swings.lows[swings.lows.length - 1]?.price ?? recentLow;
  const structureShift =
    latest.close > previousSwingHigh
      ? 'Bullish'
      : latest.close < previousSwingLow
        ? 'Bearish'
        : 'None';
  const upperWick = latest.high - Math.max(latest.open, latest.close);
  const lowerWick = Math.min(latest.open, latest.close) - latest.low;
  const wickBias =
    activeSweepPool?.side === 'BUY'
      ? upperWick / Math.max(latest.high - latest.low, 0.01)
      : lowerWick / Math.max(latest.high - latest.low, 0.01);
  const rejectionQuality =
    sweepStatus === 'Swept + rejected'
      ? wickBias > 0.48
        ? 'Strong'
        : wickBias > 0.28
          ? 'Moderate'
          : 'Weak'
      : sweepStatus === 'Sweep in progress'
        ? 'Weak'
        : 'None';
  const volatilityExpansion =
    atr > atrLong * 1.08 ? 'Expanding' : atr < atrLong * 0.94 ? 'Compressed' : 'Normal';

  let readinessScore =
    20 +
    (primaryPool ? 12 : 0) +
    (secondaryPool ? 6 : 0) +
    (displacement === 'Strong' ? 12 : displacement === 'Weak' ? 6 : 0) +
    (structureShift !== 'None' ? 12 : 0) +
    (rejectionQuality === 'Strong' ? 18 : rejectionQuality === 'Moderate' ? 12 : rejectionQuality === 'Weak' ? 6 : 0) +
    (volatilityExpansion === 'Expanding' ? 10 : volatilityExpansion === 'Normal' ? 4 : 0) +
    (sweepStatus === 'Swept + rejected' ? 20 : sweepStatus === 'Swept + accepted' ? 15 : sweepStatus === 'Sweep in progress' ? 8 : 0) +
    (Math.abs(buyProbability - sellProbability) > 10 ? 6 : 0);
  if (newsLockState === 'CAUTION') readinessScore -= 10;
  if (newsLockState === 'LOCKED') readinessScore = Math.min(readinessScore - 25, 39);
  readinessScore = clampValue(readinessScore, 0, 100);

  const executionState =
    readinessScore >= 80 ? 'Execution ready' : readinessScore >= 60 ? 'Setup forming' : readinessScore >= 40 ? 'Watch only' : 'No trade';

  let actionNow = 'Wait for confirmation';
  if (newsLockState === 'LOCKED') actionNow = 'No entry';
  else if (sweepStatus === 'Not swept') actionNow = 'Wait for sweep';
  else if (sweepStatus === 'Sweep in progress') actionNow = 'Wait for confirmation';
  else if (postSweepRead === 'Rejection likely') actionNow = 'Watch rejection';
  else if (postSweepRead === 'Acceptance likely') actionNow = 'Avoid chasing';
  else if (executionState === 'Setup forming' || executionState === 'Execution ready') actionNow = 'Bias still intact';

  const invalidation =
    activeSweepPool?.side === 'BUY'
      ? `Acceptance above ${(activeSweepPool.price + tolerance).toFixed(2)} invalidates short reaction idea`
      : activeSweepPool?.side === 'SELL'
        ? `Acceptance below ${(activeSweepPool.price - tolerance).toFixed(2)} invalidates long reaction idea`
        : 'No clean invalidation until a primary pool forms.';

  const currentDraw =
    summaryBias === 'Buy-side favored'
      ? 'Buy-side'
      : summaryBias === 'Sell-side favored'
        ? 'Sell-side'
        : summaryBias === 'Two-sided pressure'
          ? 'Two-sided'
          : 'Neutral';

  const currentRead =
    sweepStatus === 'Swept + rejected'
      ? `${activeSweepPool?.side === 'BUY' ? 'Buy-side' : 'Sell-side'} sweep completed with ${postSweepRead.toLowerCase()}.`
      : primaryPool
        ? `Price is approaching ${primaryPool.side === 'BUY' ? 'buy-side' : 'sell-side'} liquidity without confirmed ${postSweepRead === 'Acceptance likely' ? 'rejection' : 'acceptance'}.`
        : defaultDecision.currentRead;
  const bestCase =
    primaryPool?.side === 'BUY'
      ? `Sweep above ${primaryPool.label} then reject back below for short reaction setup.`
      : primaryPool?.side === 'SELL'
        ? `Sweep below ${primaryPool.label} then reclaim back above for long reaction setup.`
        : defaultDecision.bestCase;
  const doNothingIf =
    primaryPool?.side === 'BUY'
      ? `Price accepts above ${formatLiquidityPrice(primaryPool.price + tolerance)} with clean continuation.`
      : primaryPool?.side === 'SELL'
        ? `Price accepts below ${formatLiquidityPrice(primaryPool.price - tolerance)} with clean continuation.`
        : defaultDecision.doNothingIf;

  const primaryDraw =
    primaryPool?.relation === 'above'
      ? `Above price: ${primaryPool.label}`
      : primaryPool?.relation === 'below'
        ? `Below price: ${primaryPool.label}`
        : defaultDecision.primaryTargetDisplay;

  const attachPoolMeta = (pool) =>
    pool
      ? {
          ...pool,
          displayPrice: formatLiquidityPrice(pool.price),
          displayDistance: formatLiquidityDistance(pool.distance),
          tag: getLiquidityDisplayStatus(pool.sweepStatus),
        }
      : null;

  const chooseMapPool = (candidates, relation) =>
    candidates
      .filter((pool) =>
        pool &&
        pool.relation === relation &&
        (relation === 'above' ? pool.price > livePrice : pool.price < livePrice)
      )
      .sort((a, b) => a.distance - b.distance || b.weight - a.weight)[0] ?? null;

  const buildMapRow = (label, candidates) => ({
    label,
    above: attachPoolMeta(chooseMapPool(candidates, 'above')),
    below: attachPoolMeta(chooseMapPool(candidates, 'below')),
  });

  return {
    summaryBias,
    primaryTargetDisplay: primaryPool ? `${primaryPool.label} • ${formatLiquidityPrice(primaryPool.price)}` : defaultDecision.primaryTargetDisplay,
    sweepProbability: Math.round(Math.max(buyProbability, sellProbability)),
    sweepProbabilityLabel: buyProbability >= sellProbability ? 'Buy-side first' : 'Sell-side first',
    executionState,
    currentDraw,
    primaryDraw,
    primaryPool: attachPoolMeta(primaryPool),
    secondaryPool: attachPoolMeta(secondaryPool),
    sweepStatus,
    postSweepRead,
    actionNow,
    invalidation,
    confirmation: {
      displacement,
      structureShift,
      rejectionQuality,
      volatilityExpansion,
      sessionContext: getSessionContext(now),
      newsLock: newsLockState,
    },
    mapRows: [
      buildMapRow('Nearest Liquidity', [nearestAbove, nearestBelow]),
      buildMapRow('Equal Highs / Lows', [poolByType.get('equalHighs'), poolByType.get('equalLows')]),
      buildMapRow('Previous Day', [poolByType.get('previousDayHigh'), poolByType.get('previousDayLow')]),
      buildMapRow('Previous Week', [poolByType.get('previousWeekHigh'), poolByType.get('previousWeekLow')]),
      buildMapRow('Asia Session', [poolByType.get('asiaHigh'), poolByType.get('asiaLow')]),
      buildMapRow('Intraday Swings', [poolByType.get('intradaySwingHigh'), poolByType.get('intradaySwingLow')]),
      buildMapRow('Local Clusters', [poolByType.get('clusteredHighs'), poolByType.get('clusteredLows')]),
    ],
    currentPrice: livePrice,
    currentRead,
    bestCase,
    doNothingIf,
    dataCoverage: {
      hasPreviousDay: previousDayCandles.length > 0,
      hasPreviousWeek: previousWeekCandles.length > 0,
      hasAsiaRange: asiaCandles.length > 0,
    },
  };
}

function buildContextualOverlay({ candles, livePrice, liquidityDecision, signalCard, newsLockState, now = new Date() }) {
  const normalizedCandles = [...(Array.isArray(candles) ? candles : [])]
    .filter((candle) =>
      candle &&
      [candle.open, candle.high, candle.low, candle.close].every((value) => Number.isFinite(value))
    )
    .sort((a, b) => safeNumber(a.time, 0) - safeNumber(b.time, 0));
  const session = getSessionContext(now);
  const fallbackPrice = Number.isFinite(livePrice) ? livePrice : signalCard?.livePrice;
  const price = Number.isFinite(fallbackPrice) ? fallbackPrice : null;
  const recent = normalizedCandles.slice(-28);
  const closes = recent.map((candle) => candle.close);
  const latest = recent[recent.length - 1];
  const previous = recent[Math.max(0, recent.length - 7)] ?? latest;
  const highs = recent.map((candle) => candle.high);
  const lows = recent.map((candle) => candle.low);
  const rangeHigh = highs.length ? Math.max(...highs) : price;
  const rangeLow = lows.length ? Math.min(...lows) : price;
  const rangeSize = Math.max((rangeHigh ?? 0) - (rangeLow ?? 0), 0.01);
  const rangePosition = Number.isFinite(price) && Number.isFinite(rangeHigh) && Number.isFinite(rangeLow)
    ? clampValue(((price - rangeLow) / rangeSize) * 100, 0, 100)
    : 50;
  const tr = recent.slice(1).map((candle, index) => {
    const previousClose = recent[index].close;
    return Math.max(
      candle.high - candle.low,
      Math.abs(candle.high - previousClose),
      Math.abs(candle.low - previousClose)
    );
  });
  const shortAtr = averageNumbers(tr.slice(-8));
  const longAtr = averageNumbers(tr.slice(-20)) || shortAtr || 0.1;
  const volatilityRatio = shortAtr / Math.max(longAtr, 0.01);
  const momentum = latest && previous ? latest.close - previous.close : 0;
  const normalizedMomentum = momentum / Math.max(longAtr, 0.01);
  const structureShift = liquidityDecision?.confirmation?.structureShift ?? 'None';
  const volatilityState =
    volatilityRatio > 1.18
      ? 'Expanding'
      : volatilityRatio < 0.88
        ? 'Compressing'
        : Math.abs(normalizedMomentum) > 0.75
          ? 'Trending'
          : 'Ranging';
  const marketRegime =
    liquidityDecision?.sweepStatus === 'Swept + rejected'
      ? 'Reversing'
      : volatilityState === 'Expanding'
        ? 'Expanding'
        : volatilityState === 'Compressing'
          ? 'Compressing'
          : Math.abs(normalizedMomentum) > 0.85
            ? 'Trending'
            : 'Ranging';
  const structureState =
    structureShift === 'Bullish'
      ? 'Bullish structure'
      : structureShift === 'Bearish'
        ? 'Bearish structure'
        : Math.abs(normalizedMomentum) > 0.45
          ? 'Structure under pressure'
          : 'Mixed structure';
  const sessionRead =
    session === 'London'
      ? volatilityState === 'Expanding' ? 'London expansion active' : 'London probing range'
      : session === 'New York'
        ? volatilityState === 'Compressing' ? 'Pre-NY holding range' : 'New York reaction window'
        : session === 'Asia'
          ? 'Asia compression'
          : 'Off-session conditions';
  const side = signalCard?.side;
  const signalAligned =
    (side === 'BUY' && (structureState === 'Bullish structure' || liquidityDecision?.currentDraw === 'Sell-side')) ||
    (side === 'SELL' && (structureState === 'Bearish structure' || liquidityDecision?.currentDraw === 'Buy-side'));
  const signalEnvironment =
    newsLockState === PYROMANCER_RISK_STATES.LOCKED
      ? 'Conflicted'
      : signalAligned && liquidityDecision?.executionState !== 'No trade'
        ? 'Supportive'
        : signalAligned || liquidityDecision?.executionState === 'Setup forming'
          ? 'Conditional'
          : liquidityDecision?.executionState === 'No trade'
            ? 'Weak'
            : 'Conflicted';
  const flatPools = (liquidityDecision?.mapRows ?? []).flatMap((row) => [row.above, row.below]).filter(Boolean);
  const nearestAbove = flatPools
    .filter((pool) => pool.relation === 'above')
    .sort((a, b) => a.distance - b.distance)[0];
  const nearestBelow = flatPools
    .filter((pool) => pool.relation === 'below')
    .sort((a, b) => a.distance - b.distance)[0];
  const zone =
    rangePosition >= 68
      ? 'Upper range'
      : rangePosition <= 32
        ? 'Lower range'
        : 'Mid-range';
  const reactionZone =
    liquidityDecision?.sweepStatus === 'Swept + rejected' ||
    liquidityDecision?.postSweepRead === 'Rejection likely' ||
    rangePosition >= 72 ||
    rangePosition <= 28;
  const currentContext =
    liquidityDecision?.sweepStatus === 'Swept + rejected'
      ? 'Reaction zone active'
      : liquidityDecision?.sweepStatus === 'Swept + accepted'
        ? 'Trend continuation context'
        : marketRegime === 'Compressing'
          ? 'Post-sweep compression'
          : zone === 'Mid-range'
            ? 'Range midpoint drift'
            : 'Directional pressure building';
  const supportCandidates = [
    signalAligned ? `${side === 'BUY' ? 'bullish' : 'bearish'} structure still intact` : null,
    reactionZone ? 'price is near a reaction zone' : null,
    liquidityDecision?.sweepStatus === 'Swept + rejected' ? 'recent sweep rejected cleanly' : null,
    volatilityState === 'Expanding' ? 'volatility expanding from session flow' : null,
    newsLockState === PYROMANCER_RISK_STATES.CLEAR ? 'macro filter is clear' : null,
  ].filter(Boolean);
  const weakenCandidates = [
    liquidityDecision?.confirmation?.displacement === 'None' ? 'no displacement yet' : null,
    zone === 'Mid-range' ? 'still inside mid-range' : null,
    liquidityDecision?.postSweepRead === 'No confirmation' ? 'no confirmed reaction yet' : null,
    session === 'Off-session' ? 'off-session conditions' : null,
    newsLockState !== PYROMANCER_RISK_STATES.CLEAR ? 'event risk is active' : null,
  ].filter(Boolean);
  const actionBias =
    newsLockState === PYROMANCER_RISK_STATES.LOCKED
      ? 'no clean edge'
      : signalEnvironment === 'Supportive'
        ? 'bias intact'
        : signalEnvironment === 'Weak'
          ? 'avoid forcing entry'
          : signalEnvironment === 'Conflicted'
            ? 'context weakening'
            : 'wait for confirmation';

  return {
    marketRegime,
    structureState,
    session,
    sessionRead,
    signalEnvironment,
    currentContext,
    actionBias,
    rangePosition: Math.round(rangePosition),
    zone,
    reactionZone: reactionZone ? 'Reaction zone active' : 'Floating in mid-range',
    nearestAbove: nearestAbove ? `${nearestAbove.label} ${nearestAbove.displayPrice}` : 'No clean level above',
    nearestBelow: nearestBelow ? `${nearestBelow.label} ${nearestBelow.displayPrice}` : 'No clean level below',
    sweepStatus: getLiquidityDisplayStatus(liquidityDecision?.sweepStatus),
    structureBias: structureState.replace(' structure', ''),
    volatilityState,
    supports: supportCandidates.slice(0, 4),
    weakens: weakenCandidates.slice(0, 4),
    confirmation: [
      { label: 'Trend Bias', value: Math.abs(normalizedMomentum) > 0.85 ? 'Strong' : Math.abs(normalizedMomentum) > 0.4 ? 'Moderate' : 'Weak' },
      { label: 'Structure Shift', value: structureShift === 'None' ? 'Mixed' : structureShift },
      { label: 'Volatility', value: volatilityState === 'Expanding' ? 'Strong' : volatilityState === 'Compressing' ? 'Weak' : 'Moderate' },
      { label: 'Liquidity Pressure', value: liquidityDecision?.currentDraw === 'Neutral' ? 'Mixed' : liquidityDecision?.currentDraw ?? 'Mixed' },
      { label: 'Session Quality', value: session === 'Off-session' ? 'Weak' : session === 'Asia' ? 'Moderate' : 'Strong' },
      { label: 'News Lock', value: newsLockState === PYROMANCER_RISK_STATES.LOCKED ? 'Locked' : newsLockState === PYROMANCER_RISK_STATES.CAUTION ? 'Caution' : 'Clear' },
    ],
    currentRead: `${marketRegime} conditions with ${structureState.toLowerCase()} around ${zone.toLowerCase()}.`,
    bestUseCase: signalEnvironment === 'Supportive' ? 'Use context to hold bias while confirmation stays aligned.' : 'Use context to filter entries until alignment improves.',
    doNotForceIf: weakenCandidates[0] ? `Do not force if ${weakenCandidates[0]}.` : 'Do not force if price remains trapped away from liquidity.',
  };
}

function getResolutionSeconds(resolution) {
  const normalized = String(resolution ?? '15').toUpperCase();
  if (normalized === '1') return 60;
  if (normalized === '5') return 5 * 60;
  if (normalized === '15') return 15 * 60;
  if (normalized === '30') return 30 * 60;
  if (normalized === '60' || normalized === '1H') return 60 * 60;
  if (normalized === '240' || normalized === '4H') return 4 * 60 * 60;
  if (normalized === '1D' || normalized === 'D') return 24 * 60 * 60;
  return 15 * 60;
}

const TRADINGVIEW_XAU_SCAN_ENDPOINTS = [
  '/api/tv-xau-scan',
  'https://scanner.tradingview.com/cfd/scan',
];

const MARKET_TICKER_INSTRUMENTS = [
  { id: 'XAUUSD', symbol: 'OANDA:XAUUSD', decimals: 2 },
  { id: 'DXY', symbol: 'TVC:DXY', decimals: 2 },
  { id: 'US10Y', symbol: 'TVC:US10Y', decimals: 2 },
];
const MARKET_TICKER_REFRESH_MS = 7000;

function buildPendingMarketTickerItem(instrument) {
  return {
    ...instrument,
    value: null,
    changePercent: null,
    source: 'waiting-live-source',
    updatedAt: null,
  };
}

function buildMarketTickerPayload() {
  return {
    symbols: { tickers: MARKET_TICKER_INSTRUMENTS.map((instrument) => instrument.symbol), query: { types: [] } },
    columns: ['close', 'change'],
  };
}

function normalizeMarketTickerResponse(body) {
  if (!Array.isArray(body?.data)) return [];

  const instrumentsBySymbol = new Map(MARKET_TICKER_INSTRUMENTS.map((instrument) => [instrument.symbol, instrument]));
  return body.data
    .map((row) => {
      const instrument = instrumentsBySymbol.get(row?.s);
      if (!instrument || !Array.isArray(row?.d)) return null;

      const value = Number(row.d[0]);
      const changePercent = Number(row.d[1]);
      if (!Number.isFinite(value)) return null;

      return {
        ...instrument,
        value,
        changePercent: Number.isFinite(changePercent) ? changePercent : null,
        source: 'tradingview-scanner',
        updatedAt: new Date().toISOString(),
      };
    })
    .filter(Boolean);
}

async function fetchMarketTickerSnapshot() {
  const payload = buildMarketTickerPayload();

  for (const endpoint of TRADINGVIEW_XAU_SCAN_ENDPOINTS) {
    try {
      const response = await fetch(endpoint, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      });
      if (!response.ok) continue;

      const body = await response.json();
      const snapshot = normalizeMarketTickerResponse(body);
      if (snapshot.length) return snapshot;
    } catch (_error) {
      // Keep the ticker UI stable and try the next available source.
    }
  }

  return [];
}

function buildXauScanPayload(tf) {
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

function normalizeXauScanResponse(body, tf) {
  const values = body?.data?.[0]?.d;
  if (!Array.isArray(values)) return null;

  const [livePrice, open0, high0, low0, close0, open1, high1, low1, close1] = values.map((value) => Number(value));
  if (![livePrice, high0, low0, close0, high1, low1, close1].every((value) => Number.isFinite(value))) {
    return null;
  }

  const now = Math.floor(Date.now() / 1000);
  const step = getResolutionSeconds(tf);
  const alignedNow = now - (now % step);
  const currentOpen = Number.isFinite(open0) ? open0 : close0;
  const previousOpen = Number.isFinite(open1) ? open1 : close1;

  return {
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
    timeframe: tf,
    source: 'tradingview-scanner',
  };
}

async function requestXauScanFeed(tf) {
  const payload = buildXauScanPayload(tf);

  for (const endpoint of TRADINGVIEW_XAU_SCAN_ENDPOINTS) {
    try {
      const response = await fetch(endpoint, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      });
      if (!response.ok) continue;

      const body = await response.json();
      const normalized = normalizeXauScanResponse(body, tf);
      if (normalized) return normalized;
    } catch (_error) {
      // Try the next endpoint, then fall back to the local synthetic feed.
    }
  }

  return null;
}

function buildFallbackIndependentXauSignalFeed(resolution = '15', referencePrice = null) {
  const tf = String(resolution ?? '15').replace(/[^0-9A-Z]/gi, '') || '15';
  const step = getResolutionSeconds(tf);
  const now = Math.floor(Date.now() / 1000);
  const alignedNow = now - (now % step);
  const bucket = Math.floor(alignedNow / step);
  const candleCount = 40;
  const livePrice = roundPrice(
    Number.isFinite(referencePrice)
      ? referencePrice
      : 4800 + ((bucket % 11) - 5) * 0.35 + (pseudoNoise(bucket + 11) - 0.5) * 1.2
  );
  const trend = (pseudoNoise(bucket + 3) - 0.5) * 0.11;
  const candles = [];
  let close = roundPrice(livePrice - trend * candleCount - (pseudoNoise(bucket + 7) - 0.5) * 3.2);

  for (let index = 0; index < candleCount; index += 1) {
    const remaining = candleCount - index;
    const seed = bucket * 37 + index * 13;
    const driftToLive = (livePrice - close) / Math.max(1, remaining);
    const wave = Math.sin((bucket + index) / 4) * 0.18;
    const noise = (pseudoNoise(seed) - 0.5) * 0.72;
    const nextClose = index === candleCount - 1
      ? livePrice
      : roundPrice(close + driftToLive + trend + wave + noise);
    const open = roundPrice(close);
    const wick = 0.18 + pseudoNoise(seed + 101) * 0.48;

    candles.push({
      time: alignedNow - step * (candleCount - 1 - index),
      open,
      high: roundPrice(Math.max(open, nextClose) + wick),
      low: roundPrice(Math.min(open, nextClose) - wick),
      close: nextClose,
    });
    close = nextClose;
  }

  return {
    candles,
    livePrice,
    timeframe: tf,
    source: 'fallback-xau-feed',
  };
}

function renderLocalXauChart(container, feed) {
  const fallbackFeed = buildFallbackIndependentXauSignalFeed(feed?.timeframe ?? '15', feed?.livePrice);
  const candles = (Array.isArray(feed?.candles) && feed.candles.length ? feed.candles : fallbackFeed.candles).slice(-44);
  const livePrice = Number.isFinite(feed?.livePrice) ? feed.livePrice : fallbackFeed.livePrice;
  const width = 1000;
  const height = 560;
  const paddingX = 56;
  const paddingY = 58;
  const chartBottom = height - 52;
  const closes = candles.map((candle) => candle.close).filter((value) => Number.isFinite(value));
  const sortedCloses = [...closes, livePrice].sort((a, b) => a - b);
  const percentile = (ratio) => {
    if (!sortedCloses.length) return livePrice;
    const index = Math.min(sortedCloses.length - 1, Math.max(0, Math.round((sortedCloses.length - 1) * ratio)));
    return sortedCloses[index];
  };
  const center = livePrice;
  const softHigh = Math.max(percentile(0.92), center);
  const softLow = Math.min(percentile(0.08), center);
  const naturalRange = Math.max(softHigh - softLow, 2.4);
  const maxPrice = softHigh + naturalRange * 0.32;
  const minPrice = softLow - naturalRange * 0.32;
  const priceRange = Math.max(maxPrice - minPrice, 1);
  const clampPrice = (price) => clampValue(price, minPrice, maxPrice);
  const xStep = (width - paddingX * 2) / Math.max(1, candles.length - 1);
  const priceToY = (price) => paddingY + ((maxPrice - clampPrice(price)) / priceRange) * (chartBottom - paddingY);
  const closePath = candles
    .map((candle, index) => `${index === 0 ? 'M' : 'L'} ${paddingX + index * xStep} ${priceToY(candle.close)}`)
    .join(' ');
  const areaPath = `${closePath} L ${width - paddingX} ${chartBottom} L ${paddingX} ${chartBottom} Z`;
  const markerNodes = candles
    .filter((_, index) => index % 6 === 0 || index === candles.length - 1)
    .map((candle, index) => {
      const sourceIndex = index === Math.floor(candles.length / 6) ? candles.length - 1 : candles.indexOf(candle);
      const x = paddingX + sourceIndex * xStep;
      return `<circle cx="${x.toFixed(1)}" cy="${priceToY(candle.close).toFixed(1)}" r="2.4" fill="#00FFA3" opacity="0.38" />`;
    })
    .join('');
  const gridNodes = Array.from({ length: 4 }, (_, index) => {
    const y = paddingY + ((chartBottom - paddingY) / 3) * index;
    const price = maxPrice - (priceRange / 4) * index;
    return `
      <line x1="${paddingX}" y1="${y.toFixed(1)}" x2="${width - paddingX}" y2="${y.toFixed(1)}" stroke="rgba(255,255,255,0.045)" />
      <text x="${width - paddingX + 10}" y="${(y + 4).toFixed(1)}" fill="rgba(255,255,255,0.28)" font-size="11" font-family="monospace">${price.toFixed(2)}</text>
    `;
  }).join('');
  const liveY = priceToY(livePrice);
  const rangeHigh = Math.max(...closes, livePrice);
  const rangeLow = Math.min(...closes, livePrice);
  const highY = priceToY(rangeHigh);
  const lowY = priceToY(rangeLow);
  const priceDelta = closes.length > 1 ? livePrice - closes[0] : 0;
  const deltaColor = priceDelta >= 0 ? '#00FFA3' : '#FF4D6D';
  const deltaText = `${priceDelta >= 0 ? '+' : ''}${priceDelta.toFixed(2)}`;

  container.innerHTML = `
    <div class="h-full w-full bg-[#050505] text-white relative overflow-hidden">
      <div class="absolute inset-0 bg-[radial-gradient(circle_at_15%_10%,rgba(0,255,163,0.08),transparent_32%),linear-gradient(180deg,rgba(255,255,255,0.018),transparent_34%)]"></div>
      <div class="absolute left-7 top-7 z-10">
        <div class="flex items-center gap-3">
          <div class="text-[10px] uppercase tracking-[0.28em] text-[#00FFA3] font-black">XAUUSD</div>
          <div class="rounded-full border border-white/10 bg-white/5 px-2 py-0.5 text-[8px] uppercase tracking-[0.16em] text-zinc-400 font-black">M15</div>
        </div>
        <div class="mt-2 flex items-end gap-3">
          <div class="text-4xl italic font-black tracking-tight">${livePrice.toFixed(2)}</div>
          <div class="pb-1 text-[12px] font-mono font-black" style="color:${deltaColor}">${deltaText}</div>
        </div>
      </div>
      <div class="absolute right-7 top-7 z-10 text-right">
        <div class="text-[8px] uppercase tracking-[0.22em] text-zinc-600 font-black">Session Range</div>
        <div class="mt-1 text-[11px] font-mono text-zinc-400">${rangeLow.toFixed(2)} / ${rangeHigh.toFixed(2)}</div>
      </div>
      <svg viewBox="0 0 ${width} ${height}" preserveAspectRatio="none" class="absolute inset-0 h-full w-full">
        <defs>
          <linearGradient id="local-chart-fill" x1="0" x2="0" y1="0" y2="1">
            <stop offset="0%" stop-color="#00FFA3" stop-opacity="0.2" />
            <stop offset="45%" stop-color="#00FFA3" stop-opacity="0.065" />
            <stop offset="100%" stop-color="#00FFA3" stop-opacity="0" />
          </linearGradient>
          <filter id="local-line-glow" x="-20%" y="-20%" width="140%" height="140%">
            <feGaussianBlur stdDeviation="3" result="blur" />
            <feMerge>
              <feMergeNode in="blur" />
              <feMergeNode in="SourceGraphic" />
            </feMerge>
          </filter>
        </defs>
        <rect x="${paddingX}" y="${paddingY}" width="${width - paddingX * 2}" height="${chartBottom - paddingY}" rx="18" fill="rgba(0,0,0,0.12)" />
        ${gridNodes}
        <line x1="${paddingX}" y1="${highY.toFixed(1)}" x2="${width - paddingX}" y2="${highY.toFixed(1)}" stroke="rgba(255,255,255,0.1)" stroke-width="1" stroke-dasharray="5 8" />
        <line x1="${paddingX}" y1="${lowY.toFixed(1)}" x2="${width - paddingX}" y2="${lowY.toFixed(1)}" stroke="rgba(255,255,255,0.1)" stroke-width="1" stroke-dasharray="5 8" />
        <path d="${areaPath}" fill="url(#local-chart-fill)" opacity="0.95" />
        <path d="${closePath}" fill="none" stroke="rgba(0,255,163,0.32)" stroke-width="8" stroke-linecap="round" stroke-linejoin="round" filter="url(#local-line-glow)" />
        <path d="${closePath}" fill="none" stroke="#00FFA3" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round" />
        ${markerNodes}
        <line x1="${paddingX}" y1="${liveY.toFixed(1)}" x2="${width - paddingX}" y2="${liveY.toFixed(1)}" stroke="#FBBF24" stroke-width="1.1" stroke-dasharray="6 8" opacity="0.62" />
        <circle cx="${(paddingX + (candles.length - 1) * xStep).toFixed(1)}" cy="${liveY.toFixed(1)}" r="5.5" fill="#050505" stroke="#FBBF24" stroke-width="2" />
        <text x="${width - paddingX + 10}" y="${(liveY + 4).toFixed(1)}" fill="#FBBF24" font-size="12" font-family="monospace" font-weight="700">${livePrice.toFixed(2)}</text>
      </svg>
    </div>
  `;
}

async function fetchIndependentXauSignalFeed(resolution = '15') {
  const tf = String(resolution ?? '15').replace(/[^0-9A-Z]/gi, '') || '15';
  const scannerFeed = await requestXauScanFeed(tf);
  return scannerFeed ?? buildFallbackIndependentXauSignalFeed(tf);
}

function mergeIndependentSignalCandles(existingCandles, incomingCandles, resolution = '15', minimumCount = 40) {
  const step = getResolutionSeconds(resolution);
  const normalized = [...(Array.isArray(existingCandles) ? existingCandles : []), ...(Array.isArray(incomingCandles) ? incomingCandles : [])]
    .filter((candle) =>
      candle &&
      [candle.open, candle.high, candle.low, candle.close].every((value) => Number.isFinite(value))
    )
    .sort((a, b) => safeNumber(a.time, 0) - safeNumber(b.time, 0));

  const deduped = [];
  for (const candle of normalized) {
    const last = deduped[deduped.length - 1];
    if (last && safeNumber(last.time, -1) === safeNumber(candle.time, -2)) {
      deduped[deduped.length - 1] = candle;
    } else {
      deduped.push({
        time: safeNumber(candle.time, 0),
        open: roundPrice(candle.open),
        high: roundPrice(candle.high),
        low: roundPrice(candle.low),
        close: roundPrice(candle.close),
      });
    }
  }

  if (!deduped.length) return [];
  if (deduped.length >= minimumCount) return deduped.slice(-minimumCount);

  const anchor = deduped[0];
  const missingCount = minimumCount - deduped.length;
  const anchorTime = safeNumber(anchor.time, 0);
  const anchorOpen = roundPrice(anchor.open);
  const backfill = [];
  let close = roundPrice(anchorOpen - (pseudoNoise(anchorTime + 17) - 0.5) * 4.2);

  for (let index = 0; index < missingCount; index += 1) {
    const seed = anchorTime / Math.max(1, step) + index * 19;
    const remaining = missingCount - index;
    const driftToAnchor = (anchorOpen - close) / Math.max(1, remaining);
    const wave = Math.sin((seed + index) / 3.7) * 0.16;
    const noise = (pseudoNoise(seed + 3) - 0.5) * 0.52;
    const nextClose = index === missingCount - 1
      ? anchorOpen
      : roundPrice(close + driftToAnchor + wave + noise);
    const open = roundPrice(close);
    const wick = 0.16 + pseudoNoise(seed + 101) * 0.42;

    backfill.push({
      time: anchorTime - step * (missingCount - index),
      open,
      high: roundPrice(Math.max(open, nextClose) + wick),
      low: roundPrice(Math.min(open, nextClose) - wick),
      close: nextClose,
    });
    close = nextClose;
  }

  return [...backfill, ...deduped];
}

const PYROMANCER_RISK_STATES = {
  CLEAR: 'CLEAR',
  CAUTION: 'CAUTION',
  LOCKED: 'LOCKED',
};

const PYROMANCER_FOREX_FACTORY_URLS = [
  '/api/ff-calendar',
  'https://nfs.faireconomy.media/ff_calendar_thisweek.xml',
];
const PYROMANCER_FOREX_FACTORY_CALENDAR_URL = 'https://www.forexfactory.com/calendar';
const PYROMANCER_CALENDAR_REFRESH_MS = 15 * 60 * 1000;
const PYROMANCER_CAUTION_WINDOW_BEFORE = 60;
const PYROMANCER_LOCK_WINDOW_BEFORE = 15;
const PYROMANCER_LOCK_WINDOW_AFTER = 15;
const PYROMANCER_MAJOR_MACRO_PATTERNS = [
  /fomc|fed funds|interest rate decision|rate decision/i,
  /powell|fed chair|federal reserve speech|fed speech|jackson hole/i,
  /\bcpi\b|consumer price index|inflation rate/i,
  /core cpi|cpi ex food and energy|core inflation/i,
  /\bppi\b|producer prices/i,
  /\bpce\b|personal consumption expenditures/i,
  /core pce/i,
  /non farm payrolls|nonfarm payrolls|\bnfp\b/i,
  /unemployment rate|jobless claims|initial jobless claims/i,
  /\bgdp\b|gross domestic product/i,
  /\bism\b|\bpmi\b|manufacturing pmi|services pmi/i,
  /retail sales/i,
  /fomc minutes|minutes of fomc|fed minutes/i,
];

function formatPyromancerCountdown(minutesToEvent) {
  if (!Number.isFinite(minutesToEvent)) return 'No major event queued';
  const absoluteMinutes = Math.abs(Math.round(minutesToEvent));
  const hours = Math.floor(absoluteMinutes / 60);
  const minutes = absoluteMinutes % 60;
  if (hours > 0) return `${hours}h ${String(minutes).padStart(2, '0')}m`;
  return `${absoluteMinutes}m`;
}

function isPyromancerMajorMacroEvent(eventName = '') {
  return PYROMANCER_MAJOR_MACRO_PATTERNS.some((pattern) => pattern.test(eventName));
}

function getPyromancerRiskState(timeToEventMinutes) {
  if (!Number.isFinite(timeToEventMinutes)) return PYROMANCER_RISK_STATES.CLEAR;
  if (timeToEventMinutes > PYROMANCER_CAUTION_WINDOW_BEFORE) return PYROMANCER_RISK_STATES.CLEAR;
  if (timeToEventMinutes > PYROMANCER_LOCK_WINDOW_BEFORE) return PYROMANCER_RISK_STATES.CAUTION;
  if (timeToEventMinutes >= -PYROMANCER_LOCK_WINDOW_AFTER) return PYROMANCER_RISK_STATES.LOCKED;
  return PYROMANCER_RISK_STATES.CLEAR;
}

function getPyromancerGuidanceText(riskState) {
  if (riskState === PYROMANCER_RISK_STATES.LOCKED) {
    return 'High-impact event window active. No fresh signal before release risk clears.';
  }
  if (riskState === PYROMANCER_RISK_STATES.CAUTION) {
    return 'Event risk is approaching. New signals should be treated more carefully.';
  }
  return 'No major event risk detected. Fresh signals allowed.';
}

function formatPyromancerLocalTime(date) {
  if (!(date instanceof Date) || Number.isNaN(date.getTime())) return '--';
  return formatGmt8Time(date);
}

function parsePyromancerEventTime(dateValue = '', timeValue = '') {
  const dateMatch = String(dateValue).trim().match(/^(\d{2})-(\d{2})-(\d{4})$/);
  const timeMatch = String(timeValue).trim().toLowerCase().match(/^(\d{1,2}):(\d{2})(am|pm)$/);
  if (!dateMatch || !timeMatch) return null;

  const [, monthValue, dayValue, yearValue] = dateMatch;
  const [, hourValue, minuteValue, meridiem] = timeMatch;
  let hours = Number(hourValue);
  const minutes = Number(minuteValue);

  if (meridiem === 'pm' && hours !== 12) hours += 12;
  if (meridiem === 'am' && hours === 12) hours = 0;

  const eventTime = createGmt8Date(Number(yearValue), Number(monthValue), Number(dayValue), hours, minutes);

  return Number.isNaN(eventTime.getTime()) ? null : eventTime;
}

function isForexFactoryExpectedHighImpactEvent({ eventName, impact, eventTime, now = new Date() }) {
  if (!eventName) return false;
  if (!/^high$/i.test(String(impact).trim())) return false;
  if (!(eventTime instanceof Date) || Number.isNaN(eventTime.getTime())) return false;
  return eventTime.getTime() >= now.getTime() - PYROMANCER_LOCK_WINDOW_AFTER * 60 * 1000;
}

async function fetchPyromancerCalendarEvents(now = new Date()) {
  for (const calendarUrl of PYROMANCER_FOREX_FACTORY_URLS) {
    try {
      const response = await fetch(calendarUrl);
      if (!response.ok) continue;
      const xmlText = await response.text();
      if (!xmlText.includes('<weeklyevents>')) continue;
      const parser = new DOMParser();
      const xml = parser.parseFromString(xmlText, 'text/xml');
      const items = Array.from(xml.querySelectorAll('event'));
      if (!items.length) continue;

      const events = items
        .map((item) => {
          const eventName = item.querySelector('title')?.textContent?.trim() ?? '';
          const country = item.querySelector('country')?.textContent?.trim() ?? '';
          const impact = item.querySelector('impact')?.textContent?.trim() ?? '';
          const dateValue = item.querySelector('date')?.textContent?.trim() ?? '';
          const timeValue = item.querySelector('time')?.textContent?.trim() ?? '';
          const eventUrl = item.querySelector('url')?.textContent?.trim() ?? PYROMANCER_FOREX_FACTORY_CALENDAR_URL;
          const eventTime = parsePyromancerEventTime(dateValue, timeValue);

          if (!isForexFactoryExpectedHighImpactEvent({ eventName, impact, eventTime, now })) return null;

          return {
            eventName,
            eventTime,
            impactLevel: 'HIGH',
            country: country || 'Global',
            currency: country || 'N/A',
            affectedMarket: 'XAUUSD / Global Macro',
            sourceUrl: eventUrl,
            isMajorMacroEvent: true,
          };
        })
        .filter(Boolean)
        .sort((a, b) => a.eventTime - b.eventTime);

      if (events.length) return events;
    } catch (_error) {
      // Try the next calendar source before falling back to a neutral empty state.
    }
  }

  return null;
}

function buildPyromancerOutput(events, now = new Date()) {
  const enrichedEvents = (Array.isArray(events) ? events : [])
    .map((event) => {
      const timeToEventMinutes = Math.round((event.eventTime.getTime() - now.getTime()) / 60000);
      const riskState = getPyromancerRiskState(timeToEventMinutes);
      return {
        ...event,
        timeToEventMinutes,
        riskState,
        guidanceText: getPyromancerGuidanceText(riskState),
      };
    })
    .filter((event) => event.timeToEventMinutes >= -PYROMANCER_LOCK_WINDOW_AFTER)
    .sort((a, b) => a.timeToEventMinutes - b.timeToEventMinutes);

  const nextRelevantEvent = enrichedEvents[0] ?? null;
  const currentRiskState = nextRelevantEvent?.riskState ?? PYROMANCER_RISK_STATES.CLEAR;
  const guidanceText =
    currentRiskState === PYROMANCER_RISK_STATES.CLEAR
      ? 'Fresh signals allowed.'
      : getPyromancerGuidanceText(currentRiskState);
  const realNextMajorEventDisplay = nextRelevantEvent
    ? `${nextRelevantEvent.eventName} \u2022 ${formatPyromancerLocalTime(nextRelevantEvent.eventTime)}`
    : 'No major event scheduled';
  const realClearUntilText =
    currentRiskState === PYROMANCER_RISK_STATES.CLEAR
      ? nextRelevantEvent
        ? `Clear until ${formatPyromancerLocalTime(nextRelevantEvent.eventTime)}`
        : 'No major event queued'
      : '';

  return {
    currentRiskState,
    nextEventName: nextRelevantEvent?.eventName ?? 'No major event scheduled',
    nextEventTime: nextRelevantEvent?.eventTime ?? null,
    countdownText: nextRelevantEvent ? formatPyromancerCountdown(nextRelevantEvent.timeToEventMinutes) : 'No major event queued',
    nextMajorEventDisplay: realNextMajorEventDisplay,
    clearUntilText: realClearUntilText,
    affectedMarket: nextRelevantEvent?.affectedMarket ?? 'XAUUSD / USD',
    sourceUrl: nextRelevantEvent?.sourceUrl ?? PYROMANCER_FOREX_FACTORY_CALENDAR_URL,
    hasRealEvent: !!nextRelevantEvent,
    guidanceText,
    isSignalLocked: currentRiskState === PYROMANCER_RISK_STATES.LOCKED,
    upcomingEvents: enrichedEvents.slice(0, 3),
  };
}

const App = () => {
  // --- 状态与配置 ---
  const [activeTab, setActiveTab] = useState('execution'); 
  const [showPyromancer, setShowPyromancer] = useState(false);
  const [showContextOverlay, setShowContextOverlay] = useState(false);
  const [showV2Modal, setShowV2Modal] = useState(false);
  const [showFeedbackModal, setShowFeedbackModal] = useState(false);
  const [balance, setBalance] = useState(10000);
  const [riskPercent, setRiskPercent] = useState(2);
  const [manualAlertInputs, setManualAlertInputs] = useState({
    entry: '',
    stop: '',
    target: '',
  });
  const [v2WaitlistForm, setV2WaitlistForm] = useState({
    name: '',
    phone: '',
    email: '',
  });
  const [v2WaitlistStatus, setV2WaitlistStatus] = useState('idle');
  const [v2WaitlistError, setV2WaitlistError] = useState('');
  const [feedbackForm, setFeedbackForm] = useState({
    name: '',
    email: '',
    feedback: '',
  });
  const [feedbackStatus, setFeedbackStatus] = useState('idle');
  const [feedbackError, setFeedbackError] = useState('');
  const [alertStatus, setAlertStatus] = useState('IDLE');
  const [alertArmed, setAlertArmed] = useState(false);
  const prevLivePriceRef = useRef(null);
  const alertAudioContextRef = useRef(null);
  const alertBreachStateRef = useRef({ target: false, stop: false });
  const [signalRefreshBucket, setSignalRefreshBucket] = useState(() => getSignalRefreshBucket());
  const [signalCardRefreshBucket, setSignalCardRefreshBucket] = useState(() => getSignalCardRefreshBucket());
  const [signalCardCountdownMs, setSignalCardCountdownMs] = useState(() => getSignalCardCountdownMs());
  const tvEmbedReadyRef = useRef(false);
  const [tvFallbackActive, setTvFallbackActive] = useState(false);
  const [tvChartAttempt, setTvChartAttempt] = useState(0);
  const signalCardPreviousSignalRef = useRef(null);
  const [pyromancerEvents, setPyromancerEvents] = useState([]);
  const [pyromancerNow, setPyromancerNow] = useState(() => new Date());
  const [signalCardMarketFeed, setSignalCardMarketFeed] = useState({
    candles: [],
    livePrice: null,
    timeframe: '15',
    source: 'independent-xau-feed',
  });
  const [marketTickerSnapshot, setMarketTickerSnapshot] = useState(() =>
    MARKET_TICKER_INSTRUMENTS.map(buildPendingMarketTickerItem)
  );
  const [signalCardEngineInput, setSignalCardEngineInput] = useState(() => ({
    candles: [],
    livePrice: null,
    timeframe: '15',
    source: 'independent-xau-feed',
    bucketId: getSignalCardRefreshBucket(),
  }));
  const [signalCardDebug, setSignalCardDebug] = useState({
    lastFeedUpdateTime: null,
    latestLivePrice: null,
    candleCount: 0,
    engineRecomputeTime: null,
    currentSignalStatus: 'BOOTING',
  });
  const sidebarAutoCloseTimerRef = useRef(null);

  // 国际化文案 (精准对标截图)
  const clearSidebarAutoCloseTimer = () => {
    if (sidebarAutoCloseTimerRef.current) {
      window.clearTimeout(sidebarAutoCloseTimerRef.current);
      sidebarAutoCloseTimerRef.current = null;
    }
  };

  const closeActiveSidebarFeature = () => {
    setShowContextOverlay(false);
    setShowPyromancer(false);
    setShowV2Modal(false);
    setActiveTab((currentTab) => (
      currentTab === 'liquidity' || currentTab === 'journal' ? 'execution' : currentTab
    ));
  };

  const scheduleSidebarAutoClose = () => {
    clearSidebarAutoCloseTimer();
    sidebarAutoCloseTimerRef.current = window.setTimeout(() => {
      closeActiveSidebarFeature();
      sidebarAutoCloseTimerRef.current = null;
    }, 420);
  };

  const closeSidebarPanels = () => {
    clearSidebarAutoCloseTimer();
    setShowContextOverlay(false);
    setShowPyromancer(false);
    setShowV2Modal(false);
  };

  const openSidebarTab = (tab) => {
    clearSidebarAutoCloseTimer();
    closeSidebarPanels();
    setActiveTab((currentTab) => (currentTab === tab ? 'execution' : tab));
  };

  const openExecutionWorkspace = () => {
    clearSidebarAutoCloseTimer();
    closeSidebarPanels();
    setActiveTab('execution');
  };

  const toggleContextOverlay = () => {
    clearSidebarAutoCloseTimer();
    setShowPyromancer(false);
    setShowV2Modal(false);
    if (showContextOverlay) {
      setShowContextOverlay(false);
      return;
    }
    setActiveTab('execution');
    setShowContextOverlay(true);
  };

  const togglePyromancer = () => {
    clearSidebarAutoCloseTimer();
    setShowContextOverlay(false);
    setShowV2Modal(false);
    if (showPyromancer) {
      setShowPyromancer(false);
      return;
    }
    setActiveTab('execution');
    setShowPyromancer(true);
  };

  const toggleV2Modal = () => {
    clearSidebarAutoCloseTimer();
    setShowContextOverlay(false);
    setShowPyromancer(false);
    if (showV2Modal) {
      setShowV2Modal(false);
      return;
    }
    setActiveTab('execution');
    setV2WaitlistStatus('idle');
    setV2WaitlistError('');
    setShowV2Modal(true);
  };

  const updateV2WaitlistField = (field, value) => {
    setV2WaitlistForm((previousForm) => ({ ...previousForm, [field]: value }));
    if (v2WaitlistStatus !== 'submitting') {
      setV2WaitlistStatus('idle');
      setV2WaitlistError('');
    }
  };

  const submitV2Waitlist = async (event) => {
    event.preventDefault();
    const name = v2WaitlistForm.name.trim();
    const phone = v2WaitlistForm.phone.trim();
    const email = v2WaitlistForm.email.trim();
    const isValidForm = name.length > 1 && isValidWaitlistPhone(phone) && isValidWaitlistEmail(email);

    if (!isValidForm) {
      setV2WaitlistStatus('error');
      setV2WaitlistError('Please enter a valid name, phone number, and email.');
      return;
    }

    setV2WaitlistStatus('submitting');
    setV2WaitlistError('');

    try {
      await submitWeb3Form({
        subject: 'PYROFXHUB V2 Waitlist',
        name,
        phone,
        email,
      });

      setV2WaitlistStatus('success');
      setV2WaitlistForm({ name: '', phone: '', email: '' });
    } catch (_error) {
      setV2WaitlistStatus('error');
      setV2WaitlistError('Something went wrong. Please try again.');
    }
  };

  const openFeedbackModal = () => {
    setFeedbackStatus('idle');
    setFeedbackError('');
    setShowFeedbackModal(true);
  };

  const updateFeedbackField = (field, value) => {
    setFeedbackForm((previousForm) => ({ ...previousForm, [field]: value }));
    if (feedbackStatus !== 'submitting') {
      setFeedbackStatus('idle');
      setFeedbackError('');
    }
  };

  const submitFeedback = async (event) => {
    event.preventDefault();
    const name = feedbackForm.name.trim();
    const email = feedbackForm.email.trim();
    const feedback = feedbackForm.feedback.trim();

    if (name.length < 2 || !isValidWaitlistEmail(email) || feedback.length < 3) {
      setFeedbackStatus('error');
      setFeedbackError('Please enter your name, email, and feedback.');
      return;
    }

    setFeedbackStatus('submitting');
    setFeedbackError('');

    try {
      await submitWeb3Form({
        subject: 'PYROFXHUB Product Feedback',
        name,
        email,
        feedback,
      });

      setFeedbackStatus('success');
      setFeedbackForm({ name: '', email: '', feedback: '' });
    } catch (_error) {
      setFeedbackStatus('error');
      setFeedbackError('Something went wrong. Please try again.');
    }
  };

  const t = {
    CN: {
      execRepeat: "PYRO SIGNALS",
      beta: "BETA 模式",
      data: "实时流数据",
      balance: "账户净值",
      alloc: "风险占比",
      lot: "智能仓位",
      target: "目标扩展",
      stop: "风险截断",
      entry: "入场位置",
      v2Title: "V2 全球内测",
      v2Desc: "下一代神经模拟算法即将开启。包含多资产同步扫描与深度流动性热图。",
      v2PopTitle: "Stay Tuned for V2",
      marketStatus: "LIVE 连接中",
      delta: "实时获利进度"
    }
  }['CN'];

  const signalCardEngineSignal = useMemo(
    () =>
      buildPyroSignalV2({
        candles: signalCardEngineInput.candles,
        livePrice: signalCardEngineInput.livePrice,
        timeframe: signalCardEngineInput.timeframe,
        bucketId: signalCardEngineInput.bucketId,
        previousSignal: signalCardPreviousSignalRef.current,
      }),
    [signalCardEngineInput]
  );

  useEffect(() => {
    signalCardPreviousSignalRef.current = signalCardEngineSignal;
  }, [signalCardEngineSignal]);

  useEffect(() => {
    setSignalCardDebug((prev) => ({
      ...prev,
      engineRecomputeTime: new Date().toISOString(),
      currentSignalStatus: signalCardEngineSignal.status,
    }));
  }, [signalCardEngineSignal]);

  const signalCardBase = useMemo(() => {
    const stop = Number.isFinite(signalCardEngineSignal.stop) && signalCardEngineSignal.stop > 0 ? signalCardEngineSignal.stop : null;
    const target = Number.isFinite(signalCardEngineSignal.target) && signalCardEngineSignal.target > 0 ? signalCardEngineSignal.target : null;
    const livePrice =
      Number.isFinite(signalCardEngineSignal.livePrice) && signalCardEngineSignal.livePrice > 0
        ? signalCardEngineSignal.livePrice
        : null;
    const entry =
      Number.isFinite(signalCardEngineSignal.entry) && signalCardEngineSignal.entry > 0
        ? signalCardEngineSignal.entry
        : livePrice;
    const normalizedSignal = {
      ...signalCardEngineSignal,
      stop,
      target,
      livePrice,
      entry,
    };
    const display = buildSignalCardDisplay(normalizedSignal);

    return {
      title: signalCardEngineSignal.title,
      side: signalCardEngineSignal.side,
      tacticalSide: signalCardEngineSignal.side === 'WAIT' ? 'BUY' : signalCardEngineSignal.side,
      readiness: display.readiness,
      statusLabel: display.statusLabel,
      confidence: signalCardEngineSignal.confidence,
      livePrice,
      entry,
      stop,
      target,
      bePrice: Number.isFinite(signalCardEngineSignal.bePrice) && signalCardEngineSignal.bePrice > 0 ? signalCardEngineSignal.bePrice : null,
      valid: display.valid,
      validity: signalCardEngineSignal.validity,
      progress: Number.isFinite(signalCardEngineSignal.progressPercent) ? signalCardEngineSignal.progressPercent : 0,
      actionText: display.actionText,
      explanation: display.explanation,
      invalidationText: display.invalidationText,
    };
  }, [signalCardEngineSignal]);

  const riskCalculator = useMemo(() => {
    const accountBalance = Number(balance);
    const riskRate = Number(riskPercent);
    const dollarPerPointPerLot = 100;
    const hasAccountBalance = Number.isFinite(accountBalance) && accountBalance > 0;
    const hasRiskRate = Number.isFinite(riskRate) && riskRate > 0;
    const hasStopLoss =
      Number.isFinite(signalCardBase.entry) &&
      signalCardBase.entry > 0 &&
      Number.isFinite(signalCardBase.stop) &&
      signalCardBase.stop > 0;
    const riskAmount = hasAccountBalance && hasRiskRate ? Number((accountBalance * (riskRate / 100)).toFixed(2)) : 0;
    const stopDistancePips =
      hasStopLoss
        ? Math.max(1, Math.ceil(Math.abs(signalCardBase.entry - signalCardBase.stop) * 10))
        : 0;
    const stopDistancePoints = stopDistancePips / 10;
    const canCalculate = hasAccountBalance && hasRiskRate && stopDistancePoints > 0;
    const lots = canCalculate
        ? Math.max(0.01, Number((riskAmount / (stopDistancePoints * dollarPerPointPerLot)).toFixed(2)))
        : 0.01;
    const emptyReason = !hasAccountBalance
      ? 'Enter account value to calculate lot size'
      : !hasRiskRate
        ? 'Enter risk percentage to calculate lot size'
        : !hasStopLoss
          ? 'Minimum lot shown until stop loss is set'
          : '';

    return {
      riskAmount,
      stopDistancePips,
      lots,
      canCalculate,
      emptyReason,
    };
  }, [balance, riskPercent, signalCardBase.entry, signalCardBase.stop]);

  const tradeArchiveData = useMemo(() => {
    const archiveAnchorPrice =
      Number.isFinite(signalCardMarketFeed.livePrice) && signalCardMarketFeed.livePrice > 0
        ? signalCardMarketFeed.livePrice
        : Number.isFinite(signalCardBase.livePrice) && signalCardBase.livePrice > 0
          ? signalCardBase.livePrice
          : 4800;

    const records = Array.from({ length: 20 }).map((_, index) => {
      const bucket = signalRefreshBucket - (19 - index);
      const seed = bucket * 17.131 + index * 3.77;
      const direction = pseudoNoise(seed) > 0.48 ? 'BUY' : 'SELL';
      const entry = roundPrice(archiveAnchorPrice + (pseudoNoise(seed + 1) - 0.5) * 18);
      const slPips = Math.round(20 + pseudoNoise(seed + 3) * 60);
      const stateRoll = pseudoNoise(seed + 4);
      const qualificationRoll = pseudoNoise(seed + 5);
      const rr = ARCHIVE_DEFAULT_RR;

      let outcome = ARCHIVE_OUTCOMES.OPEN;
      let reviewStatus = ARCHIVE_REVIEW_STATUS.PENDING;

      if (qualificationRoll < 0.12) {
        reviewStatus = ARCHIVE_REVIEW_STATUS.MISSED;
        outcome = ARCHIVE_OUTCOMES.NOT_TRIGGERED;
      } else if (qualificationRoll < 0.24) {
        reviewStatus = ARCHIVE_REVIEW_STATUS.WATCHED;
        outcome = ARCHIVE_OUTCOMES.NOT_TRIGGERED;
      } else if (qualificationRoll < 0.36) {
        reviewStatus = ARCHIVE_REVIEW_STATUS.FILTERED;
        outcome = ARCHIVE_OUTCOMES.INVALIDATED_BEFORE_ENTRY;
      } else {
        reviewStatus = ARCHIVE_REVIEW_STATUS.QUALIFIED;
        if (stateRoll > 0.76) outcome = ARCHIVE_OUTCOMES.WIN;
        else if (stateRoll > 0.48) outcome = ARCHIVE_OUTCOMES.LOSS;
        else outcome = ARCHIVE_OUTCOMES.OPEN;
      }

      const timestamp = new Date(bucket * SIGNAL_REFRESH_MS).toISOString();

      return deriveArchiveRecord({
        id: `${bucket}-${index}`,
        direction,
        entry,
        tpResultPips: 0,
        slResultPips: 0,
        outcome,
        timestamp,
        reviewStatus,
        slPips,
        rr,
      });
    });

    const qualifiedClosed = records.filter((record) => record.countedInWinRate);
    const wins = qualifiedClosed.filter((record) => record.outcome === ARCHIVE_OUTCOMES.WIN).length;
    const winRate = qualifiedClosed.length ? (wins / qualifiedClosed.length) * 100 : 0;
    const todayKey = getLocalDayKey(new Date());
    const isGmt8Today = (record) => getLocalDayKey(new Date(record.timestamp)) === todayKey;
    const signalsToday = records.filter(isGmt8Today).length;
    const qualifiedIssuedToday = records.filter(
      (record) => isGmt8Today(record) && record.reviewStatus === ARCHIVE_REVIEW_STATUS.QUALIFIED
    ).length;
    const qualifiedClosedToday = records.filter(
      (record) => isGmt8Today(record) && record.countedInWinRate
    ).length;
    const totalPipsSecuredToday = records
      .filter((record) => isGmt8Today(record) && record.countedInWinRate)
      .reduce((total, record) => {
        if (record.outcome === ARCHIVE_OUTCOMES.WIN) return total + record.tpResultPips;
        if (record.outcome === ARCHIVE_OUTCOMES.LOSS) return total - record.slResultPips;
        return total;
      }, 0);
    const statusCounts = {
      qualified: records.filter((record) => record.reviewStatus === ARCHIVE_REVIEW_STATUS.QUALIFIED).length,
      watched: records.filter((record) => record.reviewStatus === ARCHIVE_REVIEW_STATUS.WATCHED).length,
      invalidated: records.filter((record) => record.outcome === ARCHIVE_OUTCOMES.INVALIDATED_BEFORE_ENTRY).length,
      pending: records.filter((record) => record.reviewStatus === ARCHIVE_REVIEW_STATUS.PENDING).length,
      missed: records.filter((record) => record.reviewStatus === ARCHIVE_REVIEW_STATUS.MISSED).length,
    };

    return {
      records: records.reverse(),
      winRate,
      signalsToday,
      totalIssuedToday: signalsToday,
      qualifiedIssuedToday,
      qualifiedClosedToday,
      totalPipsSecuredToday,
      qualifiedClosedCount: qualifiedClosed.length,
      wins,
      statusCounts,
      anchorPrice: archiveAnchorPrice,
      sourceLabel: 'Synthetic session archive',
    };
  }, [signalRefreshBucket, signalCardBase.livePrice, signalCardMarketFeed.livePrice]);

  const manualAlertConfig = useMemo(
    () => getManualAlertConfig(manualAlertInputs),
    [manualAlertInputs]
  );

  const pyromancerOutput = useMemo(
    () => buildPyromancerOutput(pyromancerEvents, pyromancerNow),
    [pyromancerEvents, pyromancerNow]
  );

  const liquidityDecision = useMemo(
    () =>
      buildLiquidityDecision({
        candles: signalCardMarketFeed.candles,
        livePrice: signalCardMarketFeed.livePrice,
        newsLockState: pyromancerOutput.currentRiskState,
        now: pyromancerNow,
      }),
    [signalCardMarketFeed.candles, signalCardMarketFeed.livePrice, pyromancerOutput.currentRiskState, pyromancerNow]
  );

  const signalCard = useMemo(() => {
    return {
      ...signalCardBase,
      countdownLabel: formatSignalCountdown(signalCardCountdownMs),
    };
  }, [signalCardBase, signalCardCountdownMs]);

  const marketTickerItems = useMemo(() => {
    const snapshotById = new Map(marketTickerSnapshot.map((item) => [item.id, item]));

    return MARKET_TICKER_INSTRUMENTS.map((instrument) => {
      const snapshot = snapshotById.get(instrument.id) ?? buildPendingMarketTickerItem(instrument);
      const xauLivePrice =
        instrument.id === 'XAUUSD' && Number.isFinite(signalCardMarketFeed.livePrice)
          ? signalCardMarketFeed.livePrice
          : null;

      return {
        ...snapshot,
        value: Number.isFinite(xauLivePrice) ? xauLivePrice : snapshot.value,
        source: Number.isFinite(xauLivePrice) ? signalCardMarketFeed.source : snapshot.source,
      };
    });
  }, [marketTickerSnapshot, signalCardMarketFeed.livePrice, signalCardMarketFeed.source]);

  const contextualOverlay = useMemo(
    () =>
      buildContextualOverlay({
        candles: signalCardMarketFeed.candles,
        livePrice: signalCardMarketFeed.livePrice,
        liquidityDecision,
        signalCard,
        newsLockState: pyromancerOutput.currentRiskState,
        now: pyromancerNow,
      }),
    [
      signalCardMarketFeed.candles,
      signalCardMarketFeed.livePrice,
      liquidityDecision,
      signalCard,
      pyromancerOutput.currentRiskState,
      pyromancerNow,
    ]
  );

  useEffect(() => {
    return () => {
      if (sidebarAutoCloseTimerRef.current) {
        window.clearTimeout(sidebarAutoCloseTimerRef.current);
      }
    };
  }, []);

  useEffect(() => {
    let cancelled = false;

    const refreshMarketTicker = async () => {
      const snapshot = await fetchMarketTickerSnapshot();
      if (cancelled || !snapshot.length) return;

      setMarketTickerSnapshot((previousSnapshot) => {
        const nextById = new Map(previousSnapshot.map((item) => [item.id, item]));
        snapshot.forEach((item) => nextById.set(item.id, item));
        return MARKET_TICKER_INSTRUMENTS.map((instrument) =>
          nextById.get(instrument.id) ?? buildPendingMarketTickerItem(instrument)
        );
      });
    };

    refreshMarketTicker();
    const intervalId = window.setInterval(refreshMarketTicker, MARKET_TICKER_REFRESH_MS);

    return () => {
      cancelled = true;
      window.clearInterval(intervalId);
    };
  }, []);

  useEffect(() => {
    const updateSignalTimer = () => {
      const now = Date.now();
      setSignalCardCountdownMs(getSignalCardCountdownMs(now));
      setSignalRefreshBucket((prev) => {
        const nextBucket = getSignalRefreshBucket(now);
        return prev !== nextBucket ? nextBucket : prev;
      });
      setSignalCardRefreshBucket((prev) => {
        const nextBucket = getSignalCardRefreshBucket(now);
        return prev !== nextBucket ? nextBucket : prev;
      });
    };

    updateSignalTimer();
    const intervalId = setInterval(updateSignalTimer, 1000);
    return () => clearInterval(intervalId);
  }, []);

  useEffect(() => {
    let cancelled = false;

    const syncSignalCardFromIndependentFeed = async () => {
      const source = await fetchIndependentXauSignalFeed('15');
      if (!source || cancelled) return false;
      setSignalCardMarketFeed((previousFeed) => {
        const mergedCandles = mergeIndependentSignalCandles(previousFeed.candles, source.candles, source.timeframe);
        const nextFeed = {
          candles: mergedCandles,
          livePrice: source.livePrice,
          timeframe: source.timeframe,
          source: source.source,
        };
        setSignalCardDebug((prev) => ({
          ...prev,
          lastFeedUpdateTime: new Date().toISOString(),
          latestLivePrice: source.livePrice,
          candleCount: mergedCandles.length,
        }));
        setSignalCardEngineInput({
          ...nextFeed,
          bucketId: signalCardRefreshBucket,
        });
        return nextFeed;
      });
      return true;
    };

    const recomputeSignalCard = async () => {
      const synced = await syncSignalCardFromIndependentFeed();
      if (cancelled) return;
      if (!synced) return;
    };

    recomputeSignalCard();

    return () => {
      cancelled = true;
    };
  }, [signalCardRefreshBucket]);

  useEffect(() => {
    let cancelled = false;

    const syncSignalCardFromIndependentFeed = async () => {
      const source = await fetchIndependentXauSignalFeed('15');
      if (!source || cancelled) return false;
      setSignalCardMarketFeed((previousFeed) => {
        const mergedCandles = mergeIndependentSignalCandles(previousFeed.candles, source.candles, source.timeframe);
        setSignalCardDebug((prev) => ({
          ...prev,
          lastFeedUpdateTime: new Date().toISOString(),
          latestLivePrice: source.livePrice,
          candleCount: mergedCandles.length,
        }));
        return {
          candles: mergedCandles,
          livePrice: source.livePrice,
          timeframe: source.timeframe,
          source: source.source,
        };
      });
      return true;
    };

    const refreshLiveSignalPrice = async () => {
      await syncSignalCardFromIndependentFeed();
    };

    refreshLiveSignalPrice();
    const intervalId = setInterval(refreshLiveSignalPrice, 5000);

    return () => {
      cancelled = true;
      clearInterval(intervalId);
    };
  }, [signalCardRefreshBucket]);

  useEffect(() => {
    const current = signalCard.livePrice;
    const previous = prevLivePriceRef.current;

    if (alertArmed && manualAlertConfig.valid && Number.isFinite(current)) {
      const targetBreached =
        manualAlertConfig.direction === 'target-above'
          ? current >= manualAlertConfig.target
          : current <= manualAlertConfig.target;
      const stopBreached =
        manualAlertConfig.direction === 'target-above'
          ? current <= manualAlertConfig.stop
          : current >= manualAlertConfig.stop;
      const targetCrossed =
        targetBreached &&
        !alertBreachStateRef.current.target &&
        (!Number.isFinite(previous) ||
          (manualAlertConfig.direction === 'target-above'
            ? previous < manualAlertConfig.target
            : previous > manualAlertConfig.target));
      const stopCrossed =
        stopBreached &&
        !alertBreachStateRef.current.stop &&
        (!Number.isFinite(previous) ||
          (manualAlertConfig.direction === 'target-above'
            ? previous > manualAlertConfig.stop
            : previous < manualAlertConfig.stop));

      if (targetCrossed) {
        setAlertStatus('TARGET HIT');
        playManualAlertSound(alertAudioContextRef, 'profit');
      } else if (stopCrossed) {
        setAlertStatus('STOP LOSS HIT');
        playManualAlertSound(alertAudioContextRef, 'stop');
      } else if (!targetBreached && !stopBreached && (alertStatus === 'ARMED' || alertStatus === 'TARGET HIT' || alertStatus === 'STOP LOSS HIT')) {
        setAlertStatus('MONITORING');
      }

      alertBreachStateRef.current = {
        target: targetBreached,
        stop: stopBreached,
      };
    }

    prevLivePriceRef.current = current;
  }, [signalCard.livePrice, alertArmed, alertStatus, manualAlertConfig]);

  useEffect(() => {
    let cancelled = false;

    const refreshPyromancerEvents = async () => {
      const now = new Date();
      const events = await fetchPyromancerCalendarEvents(now);
      if (cancelled) return;
      setPyromancerEvents(Array.isArray(events) ? events : []);
      setPyromancerNow(now);
    };

    refreshPyromancerEvents();
    const intervalId = setInterval(refreshPyromancerEvents, PYROMANCER_CALENDAR_REFRESH_MS);

    return () => {
      cancelled = true;
      clearInterval(intervalId);
    };
  }, []);

  useEffect(() => {
    const intervalId = setInterval(() => {
      setPyromancerNow(new Date());
    }, 1000);

    return () => clearInterval(intervalId);
  }, []);

  const tvContainer = useRef(null);

  useEffect(() => {
    if (activeTab !== 'execution' || !tvContainer.current) return undefined;

    const container = tvContainer.current;
    tvEmbedReadyRef.current = false;
    setTvFallbackActive(false);
    container.innerHTML = '';
    container.id = 'tv_main_chart_prod';

    const loadingShell = document.createElement('div');
    loadingShell.className = 'h-full w-full bg-[#050505] flex items-center justify-center text-[10px] uppercase tracking-[0.28em] text-zinc-600';
    loadingShell.textContent = 'Loading XAUUSD chart';
    container.appendChild(loadingShell);

    const getTradingViewIframe = () =>
      container.querySelector('iframe[src*="advanced-chart"], iframe[title*="advanced chart"]');
    const markTradingViewReady = () => {
      const iframe = getTradingViewIframe();
      if (!iframe) return false;
      tvEmbedReadyRef.current = true;
      loadingShell.remove();
      setTvFallbackActive(false);
      return true;
    };

    const observer = new MutationObserver(markTradingViewReady);
    observer.observe(container, { childList: true, subtree: true });

    const script = document.createElement('script');
    script.src = 'https://s3.tradingview.com/external-embedding/embed-widget-advanced-chart.js';
    script.type = 'text/javascript';
    script.async = true;
    script.innerHTML = JSON.stringify({
      autosize: true,
      symbol: 'OANDA:XAUUSD',
      interval: '15',
      timezone: APP_TIME_ZONE,
      theme: 'dark',
      style: '1',
      locale: 'zh_CN',
      backgroundColor: '#050505',
      gridColor: 'rgba(255,255,255,0.04)',
      hide_side_toolbar: true,
      allow_symbol_change: false,
      save_image: false,
      calendar: false,
      support_host: 'https://www.tradingview.com',
      studies: ['Volume@tv-basicstudies', 'PivotPointsHighLow@tv-basicstudies'],
    });
    script.onerror = () => {
      loadingShell.remove();
      tvEmbedReadyRef.current = false;
      setTvFallbackActive(true);
    };
    script.onload = () => {
      markTradingViewReady();
    };
    container.appendChild(script);

    const fallbackTimer = window.setTimeout(() => {
      if (!markTradingViewReady()) {
        setTvFallbackActive(true);
      }
    }, 15000);

    return () => {
      window.clearTimeout(fallbackTimer);
      observer.disconnect();
      tvEmbedReadyRef.current = false;
      setTvFallbackActive(false);
      container.innerHTML = '';
    };
  }, [activeTab, tvChartAttempt]);

  useEffect(() => {
    if (activeTab === 'execution' && tvFallbackActive && tvContainer.current) {
      renderLocalXauChart(tvContainer.current, signalCardMarketFeed);
    }
  }, [activeTab, signalCardMarketFeed, tvFallbackActive]);

  useEffect(() => {
    if (activeTab !== 'execution' || !tvFallbackActive) return undefined;
    const retryTimer = window.setTimeout(() => {
      setTvChartAttempt((attempt) => attempt + 1);
    }, 30000);
    return () => window.clearTimeout(retryTimer);
  }, [activeTab, tvFallbackActive]);

  return (
    <div className="flex h-screen w-full bg-[#050505] text-[#EAEAEA] font-sans overflow-hidden">
      
      {/* 侧边栏 Sidebar */}
      <nav className="w-20 flex flex-col items-center py-8 border-r border-white/5 bg-[#080808] z-[120] shadow-2xl">
        <div className="mb-12 text-[#00FFA3] drop-shadow-[0_0_15px_rgba(0,255,163,0.6)] animate-pulse">
          <Flame size={32} fill="currentColor" />
        </div>
        
        <div className="flex-1 flex flex-col gap-8 items-center">
          <SidebarIcon active={activeTab === 'execution' && !showContextOverlay && !showPyromancer && !showV2Modal} icon={<Crosshair size={22} />} onClick={openExecutionWorkspace} />
          <SidebarIcon active={activeTab === 'liquidity' && !showContextOverlay && !showPyromancer && !showV2Modal} icon={<Waves size={22} />} onClick={() => openSidebarTab('liquidity')} onMouseEnter={clearSidebarAutoCloseTimer} onMouseLeave={scheduleSidebarAutoClose} />
          <SidebarIcon active={showContextOverlay} icon={<Activity size={22} />} onClick={toggleContextOverlay} onMouseEnter={clearSidebarAutoCloseTimer} onMouseLeave={scheduleSidebarAutoClose} />
          <SidebarIcon active={showPyromancer} icon={<Wand2 size={22} />} onClick={togglePyromancer} onMouseEnter={clearSidebarAutoCloseTimer} onMouseLeave={scheduleSidebarAutoClose} />
          <SidebarIcon active={activeTab === 'journal' && !showContextOverlay && !showPyromancer && !showV2Modal} icon={<BookOpen size={22} />} onClick={() => openSidebarTab('journal')} onMouseEnter={clearSidebarAutoCloseTimer} onMouseLeave={scheduleSidebarAutoClose} />
          
          <div className="w-8 h-[1px] bg-white/10 my-2" />
          
          <button onMouseEnter={clearSidebarAutoCloseTimer} onMouseLeave={scheduleSidebarAutoClose} onClick={toggleV2Modal} className={`p-3 rounded-2xl border transition-all shadow-lg active:scale-95 ${showV2Modal ? 'scale-105 bg-amber-500/18 border-amber-400/40 text-amber-300 shadow-[0_0_24px_rgba(245,158,11,0.18)]' : 'bg-amber-500/10 border-amber-500/20 text-amber-500 hover:scale-110'}`}>
            <Crown size={22} />
          </button>
        </div>

        {/* 底部功能区 - 还原截图图标 */}
      </nav>

      <main className="flex-1 flex flex-col overflow-hidden relative min-h-0">
        
        {/* Header - 物理同步价格栏 */}
        <header className="h-16 border-b border-white/5 bg-[#0A0A0A]/95 flex items-center justify-between gap-5 px-8 z-50 backdrop-blur-xl">
          <div className="flex min-w-0 flex-1 items-center gap-6">
            <h1 className="text-xl font-black italic tracking-tighter text-white uppercase select-none">PYROFX<span className="text-[#00FFA3]">HUB</span></h1>
            <div className="h-6 w-[1px] bg-[#00FFA3]/12 mx-2" />
            
            {/* 实时价格容器 */}
            <div className="min-w-0 flex-1 max-w-[560px]">
               <MarketTickerMarquee items={marketTickerItems} />
            </div>
          </div>

          <div className="flex shrink-0 items-center gap-3">
             <div className="px-4 py-1.5 bg-amber-500/10 border border-amber-500/30 rounded-full shadow-[0_0_15px_rgba(245,158,11,0.1)]">
                <span className="text-[10px] font-black text-amber-500 tracking-widest uppercase italic">{t.beta}</span>
             </div>
             <div className="flex items-center gap-2">
                <button className="flex h-9 w-9 items-center justify-center rounded-lg border border-sky-500/20 bg-sky-500/10 text-sky-400 shadow-[0_0_18px_rgba(14,165,233,0.10)] transition-all hover:border-sky-400/35 hover:bg-sky-500/15 hover:text-sky-300 active:scale-95" aria-label="Send">
                  <Send size={17} />
                </button>
                <button className="flex h-9 w-9 items-center justify-center rounded-lg border border-emerald-500/20 bg-emerald-500/10 text-emerald-400 shadow-[0_0_18px_rgba(16,185,129,0.10)] transition-all hover:border-emerald-400/35 hover:bg-emerald-500/15 hover:text-emerald-300 active:scale-95" aria-label="Chat">
                  <MessageCircle size={17} />
                </button>
             </div>
          </div>
        </header>

        {/* 滚动工作区 */}
        <div className="flex-1 min-h-0 overflow-y-auto p-6 flex flex-col gap-6 custom-scrollbar bg-[#050505]">
          {activeTab === 'execution' && (
            <>
              {/* 指标摘要 */}
              {/* 核心图表区域 */}
              <section className="h-[720px] shrink-0 bg-[#0A0A0A] border border-white/5 rounded-[2.5rem] overflow-hidden relative shadow-2xl group transition-all">
                <div className="absolute inset-0" ref={tvContainer} />
                <div className="absolute top-0 left-0 right-0 z-30 h-10 bg-[#0A0A0A] pointer-events-auto" />
                <div className={`absolute top-3 right-3 z-40 w-[196px] rounded-lg border p-2 backdrop-blur-md transition-all ${alertStatus === 'TARGET HIT' ? 'bg-[#00FFA3]/10 border-[#00FFA3]/35 shadow-[0_0_18px_rgba(0,255,163,0.18)]' : alertStatus === 'STOP LOSS HIT' ? 'bg-red-500/10 border-red-400/35 shadow-[0_0_18px_rgba(248,113,113,0.18)]' : alertArmed ? 'bg-black/80 border-[#00FFA3]/25' : 'bg-black/75 border-white/10'}`}>
                  <div className="flex items-center justify-between mb-1">
                    <div className="text-[7px] uppercase tracking-[0.08em] text-zinc-500 font-black">Price Monitor</div>
                    <div className={`text-[7px] font-black uppercase ${alertStatus === 'TARGET HIT' ? 'text-[#00FFA3]' : alertStatus === 'STOP LOSS HIT' || alertStatus === 'INVALID' ? 'text-red-400' : alertArmed ? 'text-[#00FFA3]' : 'text-zinc-500'}`}>
                      {alertStatus}
                    </div>
                  </div>
                  <div className="grid grid-cols-3 gap-1.5">
                    <label>
                      <div className="text-[6px] uppercase tracking-[0.06em] text-zinc-500 font-black mb-0.5">Enter</div>
                      <input
                        type="number"
                        value={manualAlertInputs.entry}
                        onChange={(e) => {
                          setManualAlertInputs((prev) => ({ ...prev, entry: e.target.value }));
                          setAlertArmed(false);
                          setAlertStatus('IDLE');
                          alertBreachStateRef.current = { target: false, stop: false };
                        }}
                        className="input-no-spin w-full rounded-md border border-white/10 bg-black/50 px-1 py-1 text-[9px] font-black text-white outline-none focus:border-[#00FFA3]/30"
                      />
                    </label>
                    <label>
                      <div className="text-[6px] uppercase tracking-[0.06em] text-zinc-500 font-black mb-0.5">Stop</div>
                      <input
                        type="number"
                        value={manualAlertInputs.stop}
                        onChange={(e) => {
                          setManualAlertInputs((prev) => ({ ...prev, stop: e.target.value }));
                          setAlertArmed(false);
                          setAlertStatus('IDLE');
                          alertBreachStateRef.current = { target: false, stop: false };
                        }}
                        className="input-no-spin w-full rounded-md border border-white/10 bg-black/50 px-1 py-1 text-[9px] font-black text-white outline-none focus:border-red-400/30"
                      />
                    </label>
                    <label>
                      <div className="text-[6px] uppercase tracking-[0.06em] text-zinc-500 font-black mb-0.5">Target</div>
                      <input
                        type="number"
                        value={manualAlertInputs.target}
                        onChange={(e) => {
                          setManualAlertInputs((prev) => ({ ...prev, target: e.target.value }));
                          setAlertArmed(false);
                          setAlertStatus('IDLE');
                          alertBreachStateRef.current = { target: false, stop: false };
                        }}
                        className="input-no-spin w-full rounded-md border border-white/10 bg-black/50 px-1 py-1 text-[9px] font-black text-white outline-none focus:border-[#00FFA3]/30"
                      />
                    </label>
                  </div>
                  <div className="mt-1.5 flex items-center gap-1.5">
                    <button
                      onClick={async () => {
                        if (!manualAlertConfig.valid) {
                          setAlertArmed(false);
                          setAlertStatus('INVALID');
                          return;
                        }

                        try {
                          const AudioCtx = window.AudioContext || window.webkitAudioContext;
                          if (AudioCtx && !alertAudioContextRef.current) {
                            alertAudioContextRef.current = new AudioCtx();
                          }
                          if (alertAudioContextRef.current?.state === 'suspended') {
                            await alertAudioContextRef.current.resume();
                          }
                        } catch (_error) {
                          // Ignore permission issues.
                        }

                        setAlertArmed(true);
                        setAlertStatus('MONITORING');
                        alertBreachStateRef.current = { target: false, stop: false };
                        prevLivePriceRef.current = signalCard.livePrice;
                      }}
                      className={`shrink-0 rounded-md border px-2 py-1.5 text-[7px] font-black uppercase tracking-[0.04em] transition-all ${alertStatus === 'STOP LOSS HIT' ? 'border-red-400/40 bg-red-400/10 text-red-300' : 'border-[#00FFA3]/30 bg-[#00FFA3]/10 text-[#00FFA3]'}`}
                    >
                      Arm
                    </button>
                    <div className="min-w-0 text-[7px] leading-3 text-zinc-500">
                      {alertStatus === 'TARGET HIT'
                        ? 'Profit alert triggered'
                        : alertStatus === 'STOP LOSS HIT'
                          ? 'Stop loss alert triggered'
                          : alertStatus === 'INVALID'
                            ? manualAlertConfig.reason
                            : alertArmed
                              ? 'Monitoring live price...'
                              : 'Idle'}
                    </div>
                  </div>
                </div>
              </section>
            </>
          )}

          {activeTab === 'liquidity' && (
            <div
              onMouseEnter={clearSidebarAutoCloseTimer}
              onMouseLeave={scheduleSidebarAutoClose}
              className="custom-scrollbar liquidity-scrollbar min-w-0 flex-1 overflow-y-auto px-3 py-5 sm:px-5 lg:px-6 lg:py-7 animate-in slide-in-from-bottom-4 duration-500"
            >
              <div className="mx-auto w-full max-w-[1400px] min-w-0 space-y-6 pb-8">
                <div className="grid grid-cols-1 gap-4 xl:grid-cols-4">
                  <LiquiditySummaryCard label="Liquidity Bias" value={liquidityDecision.summaryBias} accentClassName={liquidityDecision.summaryBias === 'Buy-side favored' ? 'text-[#00FFA3]' : liquidityDecision.summaryBias === 'Sell-side favored' ? 'text-red-400' : liquidityDecision.summaryBias === 'Two-sided pressure' ? 'text-amber-300' : 'text-white'} />
                  <LiquiditySummaryCard label="Primary Target" value={liquidityDecision.primaryTargetDisplay} accentClassName="text-white" />
                  <LiquiditySummaryCard label="Sweep Probability" value={`${liquidityDecision.sweepProbability}%`} helper={liquidityDecision.sweepProbabilityLabel} accentClassName="text-[#00FFA3]" />
                  <LiquiditySummaryCard label="Execution State" value={liquidityDecision.executionState} accentClassName={liquidityDecision.executionState === 'Execution ready' ? 'text-[#00FFA3]' : liquidityDecision.executionState === 'Setup forming' ? 'text-amber-300' : liquidityDecision.executionState === 'Watch only' ? 'text-sky-300' : 'text-white'} />
                </div>

                <div className="grid grid-cols-1 items-stretch gap-4 rounded-[2rem] border border-[#00FFA3]/14 bg-[radial-gradient(circle_at_top_left,rgba(0,255,163,0.08),transparent_30%),linear-gradient(180deg,rgba(255,255,255,0.026),rgba(255,255,255,0.008))] p-4 shadow-[0_28px_80px_rgba(0,0,0,0.5)] xl:grid-cols-[0.9fr_1.45fr_0.8fr]">
                  <div className="flex min-h-[108px] flex-col justify-center rounded-[1.25rem] border border-white/6 bg-black/30 px-5 py-4">
                    <div className="text-[10px] font-black uppercase tracking-[0.18em] text-zinc-500">Primary Draw</div>
                    <div className={`mt-2 text-[20px] font-black leading-tight ${liquidityDecision.currentDraw === 'Buy-side' ? 'text-[#00FFA3]' : liquidityDecision.currentDraw === 'Sell-side' ? 'text-red-400' : liquidityDecision.currentDraw === 'Two-sided' ? 'text-amber-300' : 'text-white'}`}>
                      {liquidityDecision.primaryDraw}
                    </div>
                  </div>
                  <div className="flex min-h-[108px] flex-col justify-center rounded-[1.25rem] border border-white/6 bg-black/30 px-5 py-4">
                    <div className="text-[10px] font-black uppercase tracking-[0.18em] text-zinc-500">Current Read</div>
                    <div className="mt-2 text-sm font-semibold leading-6 text-zinc-100">{liquidityDecision.currentRead}</div>
                  </div>
                  <div className="flex min-h-[108px] flex-col justify-center rounded-[1.25rem] border border-white/6 bg-black/30 px-5 py-4">
                    <div className="text-[10px] font-black uppercase tracking-[0.18em] text-zinc-500">Action Now</div>
                    <div className={`mt-2 text-[20px] font-black leading-tight ${liquidityDecision.actionNow === 'No entry' ? 'text-red-400' : liquidityDecision.actionNow === 'Watch rejection' || liquidityDecision.actionNow === 'Wait for confirmation' ? 'text-amber-300' : liquidityDecision.actionNow === 'Wait for sweep' ? 'text-sky-300' : 'text-white'}`}>
                      {liquidityDecision.actionNow}
                    </div>
                  </div>
                </div>

                <div className="grid min-w-0 grid-cols-1 items-start gap-6 2xl:grid-cols-[minmax(0,1fr)_340px]">
                  <div className="min-w-0 rounded-[2.4rem] border border-white/6 bg-[#0A0A0A] shadow-[0_28px_80px_rgba(0,0,0,0.55)]">
                    <div className="border-b border-white/6 bg-[radial-gradient(circle_at_top_left,rgba(0,255,163,0.10),transparent_28%),linear-gradient(180deg,rgba(255,255,255,0.02),rgba(255,255,255,0))] px-5 py-5 sm:px-6">
                      <div className="flex flex-wrap items-center justify-between gap-4">
                        <div className="min-w-0">
                          <div className="text-[10px] font-black uppercase tracking-[0.2em] text-[#00FFA3]">Liquidity Map</div>
                          <div className="mt-2 text-[28px] font-black italic text-white">Current XAUUSD Draw</div>
                        </div>
                        <div className="min-w-[172px] rounded-[1.4rem] border border-[#00FFA3]/18 bg-[#00FFA3]/8 px-4 py-3 text-right">
                          <div className="text-[10px] font-black uppercase tracking-[0.18em] text-zinc-500">Current Price</div>
                          <div className="mt-1 text-[28px] font-black leading-none text-white">{formatLiquidityPrice(liquidityDecision.currentPrice)}</div>
                        </div>
                      </div>
                    </div>

                    <div className="px-3 py-5 sm:px-4">
                      <div className="w-full min-w-0">
                        <div className="mb-4 grid min-w-0 grid-cols-[72px_minmax(0,1fr)_48px_minmax(0,1fr)] gap-2 px-1">
                          <div className="text-[9px] font-black uppercase tracking-[0.12em] text-zinc-600">Layer</div>
                          <div className="text-[9px] font-black uppercase tracking-[0.12em] text-zinc-600">Above Price</div>
                          <div className="text-center text-[7px] font-black uppercase tracking-[0.02em] text-zinc-600">Current</div>
                          <div className="text-[9px] font-black uppercase tracking-[0.12em] text-zinc-600">Below Price</div>
                        </div>

                        <div className="space-y-3">
                          {liquidityDecision.mapRows.map((row) => (
                            <div key={row.label} className="grid min-h-[88px] min-w-0 grid-cols-[72px_minmax(0,1fr)_48px_minmax(0,1fr)] items-stretch gap-2 rounded-[1.2rem] border border-white/6 bg-[linear-gradient(180deg,rgba(255,255,255,0.022),rgba(255,255,255,0.008))] p-2.5 shadow-[inset_0_1px_0_rgba(255,255,255,0.03)]">
                              <div className="min-w-0 flex items-center rounded-[0.9rem] border border-white/5 bg-black/20 px-2 py-2.5">
                                <div className="whitespace-normal text-[8px] font-black uppercase leading-3 tracking-[0.04em] text-zinc-400">{row.label}</div>
                              </div>
                              <LiquidityMapCell pool={row.above} side="BUY" />
                              <div className="min-w-0 flex items-center justify-center">
                                <div className="w-full rounded-[0.75rem] border border-[#00FFA3]/24 bg-[#00FFA3]/10 px-1 py-2.5 text-center shadow-[0_0_18px_rgba(0,255,163,0.12)]">
                                  <div className="text-[6px] font-black uppercase tracking-[0.03em] text-[#00FFA3]">Live</div>
                                  <div className="mt-1 text-[9px] font-black leading-none text-white">{formatLiquidityPrice(liquidityDecision.currentPrice)}</div>
                                </div>
                              </div>
                              <LiquidityMapCell pool={row.below} side="SELL" />
                            </div>
                          ))}
                        </div>
                      </div>
                    </div>
                  </div>

                  <div className="grid gap-3">
                    <LiquidityDecisionCard label="Current Draw" value={liquidityDecision.currentDraw} tone={liquidityDecision.currentDraw === 'Buy-side' ? 'green' : liquidityDecision.currentDraw === 'Sell-side' ? 'red' : liquidityDecision.currentDraw === 'Two-sided' ? 'amber' : 'white'} />
                    <LiquidityPoolDecisionCard label="Primary Pool" pool={liquidityDecision.primaryPool} />
                    <LiquidityPoolDecisionCard label="Secondary Pool" pool={liquidityDecision.secondaryPool} />
                    <LiquidityDecisionCard label="Sweep Status" value={liquidityDecision.sweepStatus} tone={liquidityDecision.sweepStatus === 'Swept + rejected' ? 'amber' : liquidityDecision.sweepStatus === 'Swept + accepted' ? 'red' : liquidityDecision.sweepStatus === 'Sweep in progress' ? 'sky' : 'white'} />
                    <LiquidityDecisionCard label="Post-Sweep Read" value={liquidityDecision.postSweepRead} tone={liquidityDecision.postSweepRead === 'Rejection likely' ? 'amber' : liquidityDecision.postSweepRead === 'Acceptance likely' ? 'red' : liquidityDecision.postSweepRead === 'Monitor reaction' ? 'sky' : 'white'} />
                    <LiquidityDecisionCard label="Action Now" value={liquidityDecision.actionNow} tone={liquidityDecision.actionNow === 'No entry' ? 'red' : liquidityDecision.actionNow === 'Watch rejection' ? 'amber' : 'white'} />
                    <div className="flex min-h-[118px] flex-col justify-center rounded-[1.6rem] border border-white/6 bg-[#0A0A0A] px-5 py-4 shadow-[0_24px_60px_rgba(0,0,0,0.45)]">
                      <div className="text-[10px] font-black uppercase tracking-[0.18em] text-zinc-500">Invalidation</div>
                      <div className="mt-2 text-sm leading-6 text-zinc-200">{liquidityDecision.invalidation}</div>
                    </div>
                  </div>
                </div>

                <div className="overflow-hidden rounded-[2.2rem] border border-white/6 bg-[#0A0A0A] shadow-[0_28px_80px_rgba(0,0,0,0.5)]">
                  <div className="border-b border-white/6 px-5 py-4 sm:px-6">
                    <div className="text-[10px] font-black uppercase tracking-[0.2em] text-[#00FFA3]">Confirmation Layer</div>
                    <div className="mt-2 text-[24px] font-black italic text-white">CONFIRMATION LAYER</div>
                  </div>
                  <div className="grid grid-cols-2 gap-3 px-5 py-5 sm:grid-cols-3 xl:grid-cols-6 sm:px-6">
                    <LiquidityMiniCard label="Displacement" value={liquidityDecision.confirmation.displacement} />
                    <LiquidityMiniCard label="Structure Shift" value={liquidityDecision.confirmation.structureShift} />
                    <LiquidityMiniCard label="Rejection Quality" value={liquidityDecision.confirmation.rejectionQuality} />
                    <LiquidityMiniCard label="Volatility Expansion" value={liquidityDecision.confirmation.volatilityExpansion} />
                    <LiquidityMiniCard label="Session Context" value={liquidityDecision.confirmation.sessionContext} />
                    <LiquidityMiniCard label="News Lock" value={liquidityDecision.confirmation.newsLock} />
                  </div>
                </div>

                <div className="grid grid-cols-1 gap-3 xl:grid-cols-3">
                  <LiquidityGuidanceCard label="Current Read" value={liquidityDecision.currentRead} />
                  <LiquidityGuidanceCard label="Best Case" value={liquidityDecision.bestCase} />
                  <LiquidityGuidanceCard label="Do Nothing If" value={liquidityDecision.doNothingIf} />
                </div>

                <div className="grid grid-cols-1 gap-3 xl:grid-cols-3">
                  <LiquidityCoverageCard label="Previous Day Levels" ready={liquidityDecision.dataCoverage.hasPreviousDay} />
                  <LiquidityCoverageCard label="Previous Week Levels" ready={liquidityDecision.dataCoverage.hasPreviousWeek} />
                  <LiquidityCoverageCard label="Asia Session Range" ready={liquidityDecision.dataCoverage.hasAsiaRange} />
                </div>
              </div>
            </div>
          )}

          {activeTab === 'journal' && (
            <div
              onMouseEnter={clearSidebarAutoCloseTimer}
              onMouseLeave={scheduleSidebarAutoClose}
              className="flex-1 p-4 sm:p-6 lg:p-8 animate-in slide-in-from-bottom-4 duration-500"
            >
              <div className="max-w-6xl mx-auto">
                <div className="overflow-hidden rounded-[2.6rem] border border-white/6 bg-[#0A0A0A] shadow-[0_28px_80px_rgba(0,0,0,0.55)]">
                  <div className="border-b border-white/6 bg-[radial-gradient(circle_at_top_left,rgba(0,255,163,0.10),transparent_32%),linear-gradient(180deg,rgba(255,255,255,0.02),rgba(255,255,255,0))] px-4 py-5 sm:px-6 lg:px-8">
                    <div className="flex flex-col gap-5 xl:flex-row xl:items-start xl:justify-between">
                      <div className="min-w-0">
                        <div className="mb-3 inline-flex items-center gap-2 rounded-full border border-[#00FFA3]/14 bg-[#00FFA3]/6 px-3 py-1.5">
                          <BookOpen size={14} className="text-[#00FFA3]" />
                          <span className="text-[9px] font-black uppercase tracking-[0.2em] text-[#00FFA3]">Simulated Session Board</span>
                        </div>
                        <h2 className="text-[28px] leading-none font-black italic tracking-[-0.04em] text-white sm:text-[34px] lg:text-[40px]">
                          TRADE ARCHIVE
                        </h2>
                      </div>

                      <div className="grid w-full grid-cols-1 gap-3 sm:grid-cols-2 xl:max-w-[430px]">
                        <div className="rounded-[1.45rem] border border-white/6 bg-black/35 px-4 py-3 text-right shadow-[inset_0_1px_0_rgba(255,255,255,0.03)] sm:px-5 sm:py-3.5">
                          <div className="text-[10px] font-black uppercase tracking-[0.18em] text-zinc-500">Simulated Pips Today</div>
                          <div className={`mt-2 text-[30px] font-black leading-none sm:text-[34px] ${tradeArchiveData.totalPipsSecuredToday >= 0 ? 'text-[#00FFA3]' : 'text-red-400'}`}>
                            {tradeArchiveData.totalPipsSecuredToday >= 0 ? '+' : ''}{tradeArchiveData.totalPipsSecuredToday} pips
                          </div>
                          <div className="mt-1.5 text-[11px] text-zinc-500">Modeled from current-session records</div>
                        </div>
                        <div className="rounded-[1.45rem] border border-white/6 bg-black/35 px-4 py-3 text-right shadow-[inset_0_1px_0_rgba(255,255,255,0.03)] sm:px-5 sm:py-3.5">
                          <div className="text-[10px] font-black uppercase tracking-[0.18em] text-zinc-500">Session Records</div>
                          <div className="mt-2 text-[30px] font-black leading-none text-white sm:text-[34px]">{tradeArchiveData.signalsToday}</div>
                          <div className="mt-1.5 text-[11px] text-zinc-500">Synthetic records, price-anchored</div>
                        </div>
                      </div>
                    </div>

                    <div className="mt-4 grid grid-cols-2 gap-2 sm:grid-cols-3 lg:grid-cols-5">
                      <ArchiveBadge label="Qualified" value={tradeArchiveData.statusCounts.qualified} tone="green" />
                      <ArchiveBadge label="Watched" value={tradeArchiveData.statusCounts.watched} tone="blue" />
                      <ArchiveBadge label="Invalidated" value={tradeArchiveData.statusCounts.invalidated} tone="amber" />
                      <ArchiveBadge label="Pending" value={tradeArchiveData.statusCounts.pending} tone="white" />
                      <ArchiveBadge label="Missed" value={tradeArchiveData.statusCounts.missed} tone="red" />
                    </div>
                  </div>

                  <div className="px-4 py-4 sm:px-6 lg:px-8 lg:py-5">
                    <div className="mb-4 flex items-center justify-between gap-4">
                      <div className="text-[11px] font-black uppercase tracking-[0.2em] text-zinc-500">Recent Simulated Records</div>
                      <div className="rounded-full border border-white/8 bg-white/[0.03] px-3.5 py-1.5 text-[10px] font-black uppercase tracking-[0.18em] text-zinc-400">
                        Anchored near {formatLiquidityPrice(tradeArchiveData.anchorPrice)}
                      </div>
                    </div>

                    <div className="space-y-2">
                      {tradeArchiveData.records.map((record) => (
                        <div
                          key={record.id}
                          className="rounded-[1.25rem] border border-white/6 bg-[linear-gradient(180deg,rgba(255,255,255,0.022),rgba(255,255,255,0.008))] px-3 py-3 shadow-[inset_0_1px_0_rgba(255,255,255,0.03)] transition-all hover:border-white/10 hover:bg-white/[0.03] sm:px-4"
                        >
                          <div className="flex flex-col gap-3 xl:grid xl:grid-cols-[1.15fr_0.9fr_0.72fr_0.72fr_0.95fr_1.05fr] xl:items-center xl:gap-3">
                            <div className="min-w-0">
                              <div className={`text-[13px] font-black uppercase tracking-[0.16em] ${record.direction === 'BUY' ? 'text-[#00FFA3]' : 'text-red-400'}`}>
                                {record.direction}
                              </div>
                              <div className="mt-1 text-[10px] text-zinc-600">Simulated session record</div>
                            </div>

                            <div className="grid grid-cols-2 gap-3 text-left xl:contents">
                              <ArchiveField label="Entry" value={record.entry.toFixed(2)} valueClassName="text-white" />
                              <ArchiveField label="TP" value={record.tpResultPips ? `${record.tpResultPips} pips` : '--'} valueClassName="text-[#00FFA3]" />
                              <ArchiveField label="SL" value={record.slResultPips ? `${record.slResultPips} pips` : '--'} valueClassName="text-red-400" />
                              <div className="min-w-0">
                                <div className="mb-1 text-[9px] font-black uppercase tracking-[0.16em] text-zinc-600 xl:hidden">Outcome</div>
                                <ArchiveStatusPill type="outcome" value={record.outcome} />
                              </div>
                              <div className="min-w-0">
                                <div className="mb-1 text-[9px] font-black uppercase tracking-[0.16em] text-zinc-600 xl:hidden">Review</div>
                                <ArchiveStatusPill type="review" value={record.reviewStatus} />
                              </div>
                              <div className="min-w-0">
                                <div className="mb-1 text-[9px] font-black uppercase tracking-[0.16em] text-zinc-600 xl:hidden">Time</div>
                                <div className="text-[10px] text-zinc-500">{formatGmt8DateTime(new Date(record.timestamp), 'en-GB')}</div>
                              </div>
                            </div>
                          </div>
                        </div>
                      ))}
                    </div>
                  </div>
                </div>
              </div>
            </div>
          )}
        </div>

        {showContextOverlay ? (
          <div
            onMouseEnter={clearSidebarAutoCloseTimer}
            onMouseLeave={scheduleSidebarAutoClose}
            className="absolute inset-x-0 bottom-0 top-16 z-[140] bg-black/60 backdrop-blur-md animate-in fade-in duration-200"
          >
            <div className="ml-auto flex h-full w-full max-w-[1120px] flex-col border-l border-[#00FFA3]/14 bg-[#070707]/96 shadow-[-32px_0_90px_rgba(0,0,0,0.68)]">
              <div className="flex items-start justify-between gap-4 border-b border-white/6 bg-[radial-gradient(circle_at_top_left,rgba(0,255,163,0.10),transparent_30%),linear-gradient(180deg,rgba(255,255,255,0.024),rgba(255,255,255,0.006))] px-5 py-5 sm:px-6">
                <div>
                  <div className="text-[10px] font-black uppercase tracking-[0.24em] text-[#00FFA3]">CONTEXTUAL OVERLAY</div>
                  <h2 className="mt-2 text-[30px] font-black italic leading-none tracking-[-0.04em] text-white sm:text-[38px]">CONTEXTUAL OVERLAY</h2>
                  <p className="mt-2 text-sm font-semibold text-zinc-500">Read the environment behind the signal.</p>
                </div>
                <div className="flex items-start gap-3">
                  <div className="hidden rounded-[1.2rem] border border-[#00FFA3]/18 bg-[#00FFA3]/8 px-4 py-3 text-right sm:block">
                    <div className="text-[10px] font-black uppercase tracking-[0.18em] text-zinc-500">Active Signal</div>
                    <div className={`mt-1 text-[24px] font-black leading-none ${signalCard.side === 'BUY' ? 'text-[#00FFA3]' : signalCard.side === 'SELL' ? 'text-red-400' : 'text-white'}`}>{signalCard.side} XAUUSD</div>
                  </div>
                  <button
                    onClick={() => setShowContextOverlay(false)}
                    className="flex h-10 w-10 items-center justify-center rounded-lg border border-white/10 bg-white/[0.03] text-zinc-400 transition-all hover:border-[#00FFA3]/25 hover:bg-[#00FFA3]/8 hover:text-[#00FFA3] active:scale-95"
                    aria-label="Close contextual overlay"
                  >
                    <X size={18} />
                  </button>
                </div>
              </div>

              <div className="flex-1 overflow-y-auto custom-scrollbar px-4 py-5 sm:px-6">
                <div className="space-y-5">
                  <div className="grid grid-cols-1 gap-3 md:grid-cols-2 xl:grid-cols-4">
                    <ContextSummaryCard label="Market Regime" value={contextualOverlay.marketRegime} tone={contextualOverlay.marketRegime === 'Trending' || contextualOverlay.marketRegime === 'Expanding' ? 'green' : contextualOverlay.marketRegime === 'Reversing' ? 'amber' : 'white'} />
                    <ContextSummaryCard label="Structure State" value={contextualOverlay.structureState} tone={contextualOverlay.structureState.includes('Bullish') ? 'green' : contextualOverlay.structureState.includes('Bearish') ? 'red' : contextualOverlay.structureState.includes('pressure') ? 'amber' : 'white'} />
                    <ContextSummaryCard label="Session Context" value={contextualOverlay.session} helper={contextualOverlay.sessionRead} tone={contextualOverlay.session === 'Off-session' ? 'white' : 'green'} />
                    <ContextSummaryCard label="Signal Environment" value={contextualOverlay.signalEnvironment} tone={contextualOverlay.signalEnvironment === 'Supportive' ? 'green' : contextualOverlay.signalEnvironment === 'Conditional' ? 'amber' : contextualOverlay.signalEnvironment === 'Weak' ? 'red' : 'white'} />
                  </div>

                  <div className="grid grid-cols-1 gap-5 xl:grid-cols-[minmax(0,1.35fr)_340px]">
                    <ContextMapPanel data={contextualOverlay} />

                    <div className="space-y-3">
                      <ContextDecisionCard label="Current Context" value={contextualOverlay.currentContext} tone="white" />
                      <ContextBulletCard label="What Supports The Signal" items={contextualOverlay.supports} tone="green" />
                      <ContextBulletCard label="What Weakens The Signal" items={contextualOverlay.weakens} tone="red" />
                      <ContextDecisionCard label="Action Bias" value={contextualOverlay.actionBias} tone={contextualOverlay.actionBias === 'bias intact' ? 'green' : contextualOverlay.actionBias === 'context weakening' || contextualOverlay.actionBias === 'avoid forcing entry' ? 'red' : 'amber'} />
                    </div>
                  </div>

                  <div className="overflow-hidden rounded-[2.2rem] border border-white/6 bg-[#0A0A0A] shadow-[0_28px_80px_rgba(0,0,0,0.5)]">
                    <div className="border-b border-white/6 px-5 py-4 sm:px-6">
                      <div className="text-[10px] font-black uppercase tracking-[0.2em] text-[#00FFA3]">Confirmation Grid</div>
                    </div>
                    <div className="grid grid-cols-2 gap-3 px-5 py-5 sm:grid-cols-3 xl:grid-cols-6 sm:px-6">
                      {contextualOverlay.confirmation.map((tile) => (
                        <ContextConfirmationTile key={tile.label} label={tile.label} value={tile.value} />
                      ))}
                    </div>
                  </div>

                  <div className="grid grid-cols-1 gap-3 xl:grid-cols-3">
                    <ContextGuidanceCard label="Current Read" value={contextualOverlay.currentRead} />
                    <ContextGuidanceCard label="Best Use Case" value={contextualOverlay.bestUseCase} />
                    <ContextGuidanceCard label="Do Not Force If" value={contextualOverlay.doNotForceIf} />
                  </div>
                </div>
              </div>
            </div>
          </div>
        ) : null}
      </main>

      {/* 右侧执行面板 */}
      <aside className="w-[420px] bg-[#080808] border-l border-white/5 flex flex-col shadow-[-30px_0_60px_rgba(0,0,0,0.7)] z-[100] overflow-hidden">
        <div className="p-6 space-y-4 basis-[70%] shrink-0 overflow-hidden">
           <div className="flex justify-between items-center">
              <span className="text-[8px] font-black uppercase tracking-[0.22em] text-[#00FFA3] italic">{t.execRepeat}</span>
              <div className="flex items-center gap-2">
                 <button
                   onClick={openFeedbackModal}
                   className="feedback-neon-pulse rounded-md border border-[#00FFA3]/35 bg-[#00FFA3]/10 px-2.5 py-1 text-[8px] font-black uppercase tracking-[0.12em] text-[#00FFA3] shadow-[0_0_14px_rgba(0,255,163,0.22)] transition-all hover:border-[#00FFA3]/70 hover:bg-[#00FFA3]/16 hover:text-white active:scale-[0.98]"
                 >
                   Help us improve
                 </button>
                 <div className="px-3 py-1 bg-amber-500/10 border border-amber-400/30 rounded-full text-[10px] font-black text-amber-300 tracking-[0.16em]" style={{ textShadow: '0 0 12px rgba(251,191,36,0.75)' }}>ENG/中</div>
              </div>
           </div>

           {/* 信号模块 - 还原发光进度条 */}
           <div className="-mt-2 bg-[#0A0A0A] border border-[#00FFA3]/30 rounded-[2rem] p-3.5 shadow-[0_0_50px_rgba(0,255,163,0.05)] relative overflow-hidden min-h-0">
              <div className="flex justify-between items-start gap-3 mb-2.5">
                 <div>
                    <h2
                      className={`text-3xl font-black italic tracking-tight uppercase ${signalCard.side === 'BUY' ? 'text-[#00FFA3]' : signalCard.side === 'SELL' ? 'text-red-500' : 'text-white'}`}
                      style={{
                        textShadow:
                          signalCard.side === 'BUY'
                            ? '0 0 16px rgba(0,255,163,0.55), 0 0 30px rgba(0,255,163,0.18)'
                            : signalCard.side === 'SELL'
                              ? '0 0 16px rgba(239,68,68,0.55), 0 0 30px rgba(239,68,68,0.18)'
                              : 'none',
                      }}
                    >
                      {signalCard.side} XAUUSD
                    </h2>
                    <p className="mt-0.5 text-[8px] font-black uppercase tracking-[0.08em] text-zinc-500">Next refresh in {signalCard.countdownLabel}</p>
                 </div>
                 <div className="shrink-0 text-right">
                    <span className="block text-[13px] font-mono text-[#00FFA3] font-black italic leading-none">{signalCard.confidence.toFixed(1)}%</span>
                    <div className="mt-1 rounded-full border border-white/8 bg-white/[0.025] px-2.5 py-1 text-[7px] text-zinc-500 font-black uppercase tracking-[0.12em]">{signalCard.statusLabel}</div>
                 </div>
              </div>

              <div className="mb-3 flex justify-end">
                 <button
                    onClick={toggleV2Modal}
                    className="rounded-md border border-amber-300/28 bg-amber-300/[0.07] px-3 py-1.5 text-[8px] font-black uppercase tracking-[0.12em] text-amber-200 shadow-[0_0_14px_rgba(251,191,36,0.12)] transition-all hover:border-amber-200/70 hover:bg-amber-300/14 hover:text-amber-100 hover:shadow-[0_0_22px_rgba(251,191,36,0.22)] active:scale-95"
                  >
                    SIGNALS NOW !
                  </button>
              </div>

              <div className="bg-black/35 rounded-[1.2rem] p-3 border border-white/5 space-y-2.5 mb-3 shadow-inner">
                 <div className="flex justify-between items-center rounded-[0.9rem] bg-black/28 px-3 py-2.5">
                    <span className="text-[9px] text-gray-500 uppercase font-black italic tracking-[0.12em]">{t.entry}</span>
                    <span className={`font-mono font-black tracking-tight leading-none ${Number.isFinite(signalCard.entry) && signalCard.entry > 0 ? 'text-[28px] text-white' : 'text-[13px] uppercase tracking-[0.1em] text-zinc-500'}`}>{formatSignalPrice(signalCard.entry)}</span>
                 </div>
                 <div className="grid grid-cols-2 gap-2">
                    <div className="rounded-[0.9rem] border border-[#00FFA3]/10 bg-[#00FFA3]/[0.035] px-3 py-2.5">
                      <span className="text-[8px] text-[#00FFA3]/80 uppercase font-black italic tracking-[0.12em] block mb-1.5">{t.target}</span>
                      <span className={`font-mono font-black leading-none ${Number.isFinite(signalCard.target) && signalCard.target > 0 ? 'text-lg text-[#00FFA3]' : 'text-[12px] uppercase tracking-[0.1em] text-zinc-500'}`}>{formatSignalPrice(signalCard.target)}</span>
                    </div>
                    <div className="rounded-[0.9rem] border border-red-400/10 bg-red-500/[0.035] px-3 py-2.5 text-right">
                      <span className="text-[8px] text-red-400/80 uppercase font-black italic tracking-[0.12em] block mb-1.5">{t.stop}</span>
                      <span className={`font-mono font-black leading-none ${Number.isFinite(signalCard.stop) && signalCard.stop > 0 ? 'text-lg text-red-500' : 'text-[12px] uppercase tracking-[0.1em] text-zinc-500'}`}>{formatSignalPrice(signalCard.stop)}</span>
                    </div>
                 </div>
              </div>

              {/* 获利百分比进度条 */}
              <div className="space-y-1.5 mb-3">
                 <div className="flex justify-between text-[9px] text-gray-500 font-black uppercase tracking-[0.08em]">
                    <span>{t.delta}</span>
                    <span className="text-[#00FFA3] font-mono animate-pulse text-[11px]">{signalCard.progress.toFixed(1)}%</span>
                 </div>
                 <div className="h-2 w-full bg-black/80 rounded-full p-0.5 border border-white/10 overflow-hidden relative shadow-inner">
                    <div 
                      className="h-full bg-gradient-to-r from-[#00FFA3]/30 via-[#00FFA3] to-[#00FFA3] rounded-full transition-all duration-1000 shadow-[0_0_20px_rgba(0,255,163,0.7)]" 
                      style={{ width: `${signalCard.progress.toFixed(1)}%` }} 
                    />
                 </div>
              </div>

              <div className="grid grid-cols-2 gap-1.5">
                 <MiniFeature label="Live" value={formatSignalPrice(signalCard.livePrice)} />
                 <MiniFeature label="BE" value={formatSignalPrice(signalCard.bePrice)} />
                 <MiniFeature label="Validity" value={signalCard.valid ? 'VALID' : 'STANDBY'} />
                 <MiniFeature label="Status" value={signalCard.statusLabel} />
              </div>
               {SHOW_SIGNAL_DEBUG ? (
                 <div className="mt-2 rounded-[0.9rem] border border-white/8 bg-black/35 p-2">
                    <div className="mb-1 text-[8px] font-black uppercase tracking-[0.14em] text-amber-300">Signal Debug</div>
                    <div className="grid grid-cols-2 gap-x-2 gap-y-1 text-[8px] leading-3 text-zinc-400 font-mono">
                       <div>Feed: {signalCardDebug.lastFeedUpdateTime ? formatGmt8Time(new Date(signalCardDebug.lastFeedUpdateTime), { hour12: false, second: '2-digit' }) : '--:--:--'}</div>
                       <div>Live: {Number.isFinite(signalCardDebug.latestLivePrice) ? signalCardDebug.latestLivePrice.toFixed(2) : '--'}</div>
                       <div>Candles: {signalCardDebug.candleCount}</div>
                       <div>Engine: {signalCardDebug.engineRecomputeTime ? formatGmt8Time(new Date(signalCardDebug.engineRecomputeTime), { hour12: false, second: '2-digit' }) : '--:--:--'}</div>
                       <div className="col-span-2">Status: {signalCardDebug.currentSignalStatus}</div>
                    </div>
                 </div>
               ) : null}
              <div className="mt-3 border-t border-white/6 px-1 pt-2.5">
                <p className="text-[11.5px] text-zinc-200 font-bold leading-5">{signalCard.actionText}</p>
              {signalCard.invalidationText ? (
                  <p className="mt-1.5 text-[9.5px] text-zinc-500 font-black leading-4 tracking-[0.04em]">{signalCard.invalidationText}</p>
              ) : null}
              </div>
           </div>

        </div>

        {/* 底部输入与计算器 */}
        <div className="basis-[30%] shrink-0 p-4 bg-[#060606] border-t border-white/5 rounded-t-[2.5rem] shadow-2xl flex flex-col justify-start">
           <div className="grid grid-cols-2 gap-3 mb-3">
              <InputBox label={t.balance} value={balance} onChange={setBalance} suffix="$" />
              <InputBox label={t.alloc} value={riskPercent} onChange={setRiskPercent} color="#ff4d6d" suffix="%" />
           </div>
           
           <div className="w-full bg-[#00FFA3]/5 border border-[#00FFA3]/20 rounded-[1rem] p-2 text-left relative overflow-hidden group hover:bg-[#00FFA3]/10 transition-all shadow-2xl">
              <div className="text-[26px] font-black text-[#00FFA3] tracking-tight font-mono drop-shadow-[0_0_10px_rgba(0,255,163,0.4)] mt-0.5">
                {riskCalculator.lots.toFixed(2)} lots
              </div>
              <p className="text-[7px] text-gray-400 mt-0.5 font-mono tracking-[0.03em] leading-3">
                {riskCalculator.canCalculate
                  ? `STOP distance: ${riskCalculator.stopDistancePips} PIPS • RISK: $${riskCalculator.riskAmount.toFixed(2)}`
                  : `${riskCalculator.emptyReason} • AMOUNT: $${riskCalculator.riskAmount.toFixed(2)}`}
              </p>
              
              {/* 右下角工具占位图标 */}
              <div className="absolute bottom-2 right-2 flex flex-col gap-1 opacity-20 group-hover:opacity-50 transition-all">
                 <div className="w-2 h-2 bg-white/20 rounded-sm rotate-45" />
                 <div className="w-2 h-2 border border-white/20 rounded-full" />
              </div>
           </div>
        </div>
      </aside>

      {/* 全局全局模态框 */}
      {showPyromancer && <div onMouseEnter={clearSidebarAutoCloseTimer} onMouseLeave={scheduleSidebarAutoClose} className="absolute inset-0 z-[190] bg-black/95 backdrop-blur-3xl flex items-center justify-center p-6 animate-in fade-in duration-300">
         <div className="max-w-xl w-full p-6 sm:p-7 bg-[#0A0A0A] border border-[#00FFA3]/20 rounded-[2.5rem] shadow-[0_0_100px_rgba(0,255,163,0.08)] relative">
            <button
              onClick={() => setShowPyromancer(false)}
              className="absolute top-5 right-5 rounded-full border border-white/10 bg-white/[0.03] p-2 text-zinc-400 hover:text-white hover:bg-white/[0.06] transition-all"
            >
              <X size={16} />
            </button>

            <div className="pr-10 mb-6">
              <div className="text-[11px] text-zinc-500 font-black uppercase tracking-[0.24em] mb-3">PYROMANCER</div>
              <h2 className="text-4xl font-black text-white italic uppercase tracking-tighter">NEWS LOCK</h2>
              <p className="text-sm text-zinc-500 mt-3">Fresh signals are filtered when event risk is elevated.</p>
            </div>

            <div className="grid grid-cols-2 gap-3 mb-4">
              <div className="rounded-[1.6rem] border border-white/6 bg-black/35 px-4 py-4">
                <div className="text-[10px] text-zinc-500 font-black uppercase tracking-[0.18em] mb-2">Risk Status</div>
                <div className={`text-[28px] font-black leading-none tracking-tight ${
                  pyromancerOutput.currentRiskState === PYROMANCER_RISK_STATES.LOCKED
                    ? 'text-red-400'
                    : pyromancerOutput.currentRiskState === PYROMANCER_RISK_STATES.CAUTION
                      ? 'text-amber-300'
                      : 'text-[#00FFA3]'
                }`}>
                  {pyromancerOutput.currentRiskState}
                </div>
              </div>
              <div className="rounded-[1.6rem] border border-white/6 bg-black/35 px-4 py-4">
                <div className="text-[10px] text-zinc-500 font-black uppercase tracking-[0.18em] mb-2">Next Event In</div>
                <div className="text-[28px] font-black leading-none tracking-tight text-white">{pyromancerOutput.countdownText}</div>
              </div>
            </div>

            <div className="rounded-[1.9rem] border border-white/8 bg-[linear-gradient(180deg,rgba(255,255,255,0.03),rgba(255,255,255,0.015))] px-5 py-6 mb-4 shadow-[inset_0_1px_0_rgba(255,255,255,0.03)]">
              <div className="text-[10px] text-zinc-500 font-black uppercase tracking-[0.18em] mb-3">Signal Gate</div>
              <div className={`text-[30px] sm:text-[34px] font-black leading-tight tracking-tight ${
                pyromancerOutput.currentRiskState === PYROMANCER_RISK_STATES.LOCKED
                  ? 'text-red-400'
                  : pyromancerOutput.currentRiskState === PYROMANCER_RISK_STATES.CAUTION
                    ? 'text-amber-300'
                    : 'text-[#00FFA3]'
              }`}>
                {pyromancerOutput.currentRiskState === PYROMANCER_RISK_STATES.LOCKED
                  ? 'Fresh signals temporarily locked'
                  : pyromancerOutput.currentRiskState === PYROMANCER_RISK_STATES.CAUTION
                    ? 'Use caution before event'
                    : 'Signals allowed'}
              </div>
            </div>

            <div className="space-y-3">
              <div className="rounded-[1.4rem] border border-white/6 bg-black/25 px-4 py-4">
                <div className="mb-2 flex items-center justify-between gap-3">
                  <div className="text-[10px] text-zinc-500 font-black uppercase tracking-[0.18em]">Next High-Impact Event</div>
                  {pyromancerOutput.hasRealEvent ? (
                    <a
                      href={pyromancerOutput.sourceUrl}
                      target="_blank"
                      rel="noreferrer"
                      className="flex h-7 w-7 shrink-0 items-center justify-center rounded-md border border-amber-300/20 bg-amber-300/8 text-amber-300/80 transition-all hover:border-amber-300/40 hover:bg-amber-300/12 hover:text-amber-200"
                      aria-label="Open ForexFactory calendar event"
                    >
                      <ArrowUpRight size={14} />
                    </a>
                  ) : null}
                </div>
                <div className="text-base font-black text-white">{pyromancerOutput.nextMajorEventDisplay}</div>
              </div>
              <div className="rounded-[1.4rem] border border-white/6 bg-black/25 px-4 py-4">
                <div className="text-[10px] text-zinc-500 font-black uppercase tracking-[0.18em] mb-2">Guidance</div>
                <div className="text-sm text-zinc-500 mb-2">{pyromancerOutput.clearUntilText}</div>
                <div className="text-sm leading-7 text-zinc-300">{pyromancerOutput.guidanceText}</div>
              </div>
            </div>
         </div>
      </div>}

      {showV2Modal && <div onMouseEnter={clearSidebarAutoCloseTimer} onMouseLeave={scheduleSidebarAutoClose} className="absolute inset-0 z-[200] bg-black/95 backdrop-blur-3xl flex items-center justify-center p-6 animate-in fade-in duration-300">
         <div className="relative max-w-md w-full rounded-[2.2rem] border border-amber-400/30 bg-[#0A0A0A] p-7 shadow-[0_0_100px_rgba(245,158,11,0.16),inset_0_1px_0_rgba(255,255,255,0.05)]">
            <button
              onClick={() => setShowV2Modal(false)}
              className="absolute right-5 top-5 flex h-9 w-9 items-center justify-center rounded-md border border-amber-300/15 bg-amber-300/6 text-amber-200/70 transition-all hover:border-amber-300/35 hover:bg-amber-300/10 hover:text-amber-100 active:scale-95"
              aria-label="Close V2 waitlist"
            >
              <X size={15} />
            </button>

            {v2WaitlistStatus === 'success' ? (
              <div className="py-8 text-center">
                <Crown size={54} className="text-amber-300 mx-auto mb-7 drop-shadow-[0_0_22px_rgba(251,191,36,0.45)]" />
                <div className="text-[10px] font-black uppercase tracking-[0.24em] text-amber-300/80">V2 Priority List</div>
                <h2 className="mt-4 text-3xl font-black uppercase italic tracking-tight text-white">You're in.</h2>
                <p className="mt-4 text-sm font-semibold leading-6 text-zinc-400">You’re in. We’ll notify you first when V2 opens.</p>
                <button
                  onClick={() => setShowV2Modal(false)}
                  className="mt-8 w-full rounded-md bg-amber-300 px-4 py-3.5 text-[11px] font-black uppercase tracking-[0.18em] text-black shadow-[0_0_26px_rgba(251,191,36,0.22)] transition-all hover:bg-amber-200 active:scale-95"
                >
                  Close
                </button>
              </div>
            ) : (
              <>
                <div className="pr-11">
                  <Crown size={42} className="mb-6 text-amber-300 drop-shadow-[0_0_22px_rgba(251,191,36,0.38)]" />
                  <div className="text-[10px] font-black uppercase tracking-[0.24em] text-amber-300/80">V2 Waitlist</div>
                  <h2 className="mt-3 text-3xl font-black uppercase italic tracking-tight text-white">Get early access to V2</h2>
                  <p className="mt-4 text-sm font-semibold leading-6 text-zinc-500">
                    Join the priority list for V2 and get first access to the next release, including smarter multi-asset scanning, sharper execution tools, and deeper market context.
                  </p>
                </div>

                <form onSubmit={submitV2Waitlist} className="mt-6 space-y-3">
                  <label className="block">
                    <span className="mb-1.5 block text-[9px] font-black uppercase tracking-[0.18em] text-zinc-500">Name</span>
                    <input
                      type="text"
                      value={v2WaitlistForm.name}
                      onChange={(event) => updateV2WaitlistField('name', event.target.value)}
                      placeholder="Enter your name"
                      required
                      className="w-full rounded-lg border border-amber-300/12 bg-black/45 px-4 py-3 text-sm font-semibold text-white outline-none transition-all placeholder:text-zinc-700 focus:border-amber-300/40 focus:bg-black/60"
                    />
                  </label>
                  <label className="block">
                    <span className="mb-1.5 block text-[9px] font-black uppercase tracking-[0.18em] text-zinc-500">Phone Number</span>
                    <input
                      type="tel"
                      value={v2WaitlistForm.phone}
                      onChange={(event) => updateV2WaitlistField('phone', event.target.value)}
                      placeholder="Enter your phone number"
                      required
                      className="w-full rounded-lg border border-amber-300/12 bg-black/45 px-4 py-3 text-sm font-semibold text-white outline-none transition-all placeholder:text-zinc-700 focus:border-amber-300/40 focus:bg-black/60"
                    />
                  </label>
                  <label className="block">
                    <span className="mb-1.5 block text-[9px] font-black uppercase tracking-[0.18em] text-zinc-500">Email</span>
                    <input
                      type="email"
                      value={v2WaitlistForm.email}
                      onChange={(event) => updateV2WaitlistField('email', event.target.value)}
                      placeholder="Enter your email"
                      required
                      className="w-full rounded-lg border border-amber-300/12 bg-black/45 px-4 py-3 text-sm font-semibold text-white outline-none transition-all placeholder:text-zinc-700 focus:border-amber-300/40 focus:bg-black/60"
                    />
                  </label>

                  {v2WaitlistStatus === 'error' ? (
                    <div className="rounded-lg border border-red-400/20 bg-red-400/8 px-4 py-3 text-xs font-bold text-red-300">
                      {v2WaitlistError || 'Something went wrong. Please try again.'}
                    </div>
                  ) : null}

                  <button
                    type="submit"
                    disabled={v2WaitlistStatus === 'submitting'}
                    className="w-full rounded-lg bg-amber-300 px-4 py-4 text-[11px] font-black uppercase tracking-[0.18em] text-black shadow-[0_0_28px_rgba(251,191,36,0.22)] transition-all hover:bg-amber-200 disabled:cursor-not-allowed disabled:opacity-60 active:scale-95"
                  >
                    {v2WaitlistStatus === 'submitting' ? 'Submitting...' : 'Join Priority List'}
                  </button>
                </form>
              </>
            )}
         </div>
      </div>}

      {showFeedbackModal && <div className="absolute inset-0 z-[205] bg-black/90 backdrop-blur-2xl flex items-center justify-center p-6 animate-in fade-in duration-200">
         <div className="relative w-full max-w-md rounded-[2rem] border border-[#00FFA3]/18 bg-[#090909] p-7 shadow-[0_0_80px_rgba(0,255,163,0.10),inset_0_1px_0_rgba(255,255,255,0.045)]">
            <button
              onClick={() => setShowFeedbackModal(false)}
              className="absolute right-5 top-5 flex h-9 w-9 items-center justify-center rounded-md border border-white/10 bg-white/[0.03] text-zinc-500 transition-all hover:border-[#00FFA3]/25 hover:bg-[#00FFA3]/8 hover:text-[#00FFA3] active:scale-95"
              aria-label="Close feedback"
            >
              <X size={15} />
            </button>

            {feedbackStatus === 'success' ? (
              <div className="py-7 text-center">
                <MessageCircle size={46} className="mx-auto mb-6 text-[#00FFA3] drop-shadow-[0_0_18px_rgba(0,255,163,0.35)]" />
                <div className="text-[10px] font-black uppercase tracking-[0.22em] text-[#00FFA3]/80">Product Feedback</div>
                <h2 className="mt-4 text-3xl font-black uppercase italic tracking-tight text-white">Received.</h2>
                <p className="mt-4 text-sm font-semibold leading-6 text-zinc-400">Thanks. Your feedback has been received.</p>
                <button
                  onClick={() => setShowFeedbackModal(false)}
                  className="mt-8 w-full rounded-md border border-[#00FFA3]/25 bg-[#00FFA3]/12 px-4 py-3.5 text-[11px] font-black uppercase tracking-[0.18em] text-[#00FFA3] transition-all hover:bg-[#00FFA3]/18 active:scale-95"
                >
                  Close
                </button>
              </div>
            ) : (
              <>
                <div className="pr-11">
                  <div className="mb-4 inline-flex rounded-full border border-[#00FFA3]/14 bg-[#00FFA3]/6 px-3 py-1 text-[9px] font-black uppercase tracking-[0.2em] text-[#00FFA3]">Feedback</div>
                  <h2 className="text-3xl font-black uppercase italic tracking-tight text-white">Help us improve PYROFXHUB</h2>
                  <p className="mt-4 text-sm font-semibold leading-6 text-zinc-500">
                    Tell us what feels weak, missing, confusing, or worth improving. We review product feedback for future updates.
                  </p>
                </div>

                <form onSubmit={submitFeedback} className="mt-6 space-y-3">
                  <label className="block">
                    <span className="mb-1.5 block text-[9px] font-black uppercase tracking-[0.18em] text-zinc-500">Name</span>
                    <input
                      type="text"
                      value={feedbackForm.name}
                      onChange={(event) => updateFeedbackField('name', event.target.value)}
                      placeholder="Enter your name"
                      required
                      className="w-full rounded-lg border border-[#00FFA3]/12 bg-black/45 px-4 py-3 text-sm font-semibold text-white outline-none transition-all placeholder:text-zinc-700 focus:border-[#00FFA3]/35 focus:bg-black/60"
                    />
                  </label>
                  <label className="block">
                    <span className="mb-1.5 block text-[9px] font-black uppercase tracking-[0.18em] text-zinc-500">Email</span>
                    <input
                      type="email"
                      value={feedbackForm.email}
                      onChange={(event) => updateFeedbackField('email', event.target.value)}
                      placeholder="Enter your email"
                      required
                      className="w-full rounded-lg border border-[#00FFA3]/12 bg-black/45 px-4 py-3 text-sm font-semibold text-white outline-none transition-all placeholder:text-zinc-700 focus:border-[#00FFA3]/35 focus:bg-black/60"
                    />
                  </label>
                  <label className="block">
                    <span className="mb-1.5 block text-[9px] font-black uppercase tracking-[0.18em] text-zinc-500">Feedback</span>
                    <textarea
                      value={feedbackForm.feedback}
                      onChange={(event) => updateFeedbackField('feedback', event.target.value)}
                      placeholder="Share your suggestion, issue, or feature request"
                      required
                      rows={4}
                      className="w-full resize-none rounded-lg border border-[#00FFA3]/12 bg-black/45 px-4 py-3 text-sm font-semibold leading-6 text-white outline-none transition-all placeholder:text-zinc-700 focus:border-[#00FFA3]/35 focus:bg-black/60"
                    />
                  </label>

                  {feedbackStatus === 'error' ? (
                    <div className="rounded-lg border border-red-400/20 bg-red-400/8 px-4 py-3 text-xs font-bold text-red-300">
                      {feedbackError || 'Something went wrong. Please try again.'}
                    </div>
                  ) : null}

                  <button
                    type="submit"
                    disabled={feedbackStatus === 'submitting'}
                    className="w-full rounded-lg border border-[#00FFA3]/30 bg-[#00FFA3]/12 px-4 py-4 text-[11px] font-black uppercase tracking-[0.18em] text-[#00FFA3] shadow-[0_0_26px_rgba(0,255,163,0.12)] transition-all hover:bg-[#00FFA3]/18 disabled:cursor-not-allowed disabled:opacity-60 active:scale-95"
                  >
                    {feedbackStatus === 'submitting' ? 'Submitting...' : 'Submit Feedback'}
                  </button>
                </form>
              </>
            )}
         </div>
      </div>}

      <style>{`
        * { scrollbar-width: thin; scrollbar-color: rgba(0,255,163,0.24) rgba(0,0,0,0.38); }
        *::-webkit-scrollbar { width: 7px; height: 7px; }
        *::-webkit-scrollbar-track { background: rgba(0,0,0,0.38); border-radius: 999px; }
        *::-webkit-scrollbar-thumb { background: linear-gradient(180deg, rgba(0,255,163,0.38), rgba(0,255,163,0.14)); border: 1px solid rgba(255,255,255,0.08); border-radius: 999px; box-shadow: 0 0 14px rgba(0,255,163,0.12); }
        *::-webkit-scrollbar-thumb:hover { background: linear-gradient(180deg, rgba(0,255,163,0.52), rgba(0,255,163,0.2)); }
        .custom-scrollbar { scrollbar-width: thin; scrollbar-color: rgba(0,255,163,0.22) rgba(255,255,255,0.025); }
        .custom-scrollbar::-webkit-scrollbar { width: 7px; height: 7px; }
        .custom-scrollbar::-webkit-scrollbar-track { background: rgba(255,255,255,0.025); border-radius: 999px; }
        .custom-scrollbar::-webkit-scrollbar-thumb { background: linear-gradient(180deg, rgba(0,255,163,0.34), rgba(0,255,163,0.12)); border: 1px solid rgba(255,255,255,0.08); border-radius: 999px; }
        .custom-scrollbar::-webkit-scrollbar-thumb:hover { background: linear-gradient(180deg, rgba(0,255,163,0.48), rgba(0,255,163,0.18)); }
        .liquidity-scrollbar { scrollbar-gutter: stable; }
        .liquidity-scrollbar::-webkit-scrollbar-track { background: rgba(0,0,0,0.34); }
        .liquidity-scrollbar::-webkit-scrollbar-thumb { box-shadow: 0 0 14px rgba(0,255,163,0.18); }
        .market-ticker-mask {
          mask-image: linear-gradient(90deg, transparent 0, #000 7%, #000 93%, transparent 100%);
          -webkit-mask-image: linear-gradient(90deg, transparent 0, #000 7%, #000 93%, transparent 100%);
        }
        .market-ticker-track { animation: marketTickerScroll 24s linear infinite; }
        .market-ticker-mask:hover .market-ticker-track { animation-play-state: paused; }
        @keyframes marketTickerScroll {
          0% { transform: translateX(0); }
          100% { transform: translateX(-50%); }
        }
        .feedback-neon-pulse { animation: feedbackNeonPulse 1.6s ease-in-out infinite; }
        @keyframes feedbackNeonPulse {
          0%, 100% {
            box-shadow: 0 0 10px rgba(0,255,163,0.18), inset 0 1px 0 rgba(255,255,255,0.05);
            border-color: rgba(0,255,163,0.28);
            color: #00FFA3;
          }
          50% {
            box-shadow: 0 0 22px rgba(0,255,163,0.48), 0 0 36px rgba(0,255,163,0.12), inset 0 1px 0 rgba(255,255,255,0.10);
            border-color: rgba(0,255,163,0.72);
            color: #EFFFF8;
          }
        }
        @media (prefers-reduced-motion: reduce) {
          .market-ticker-track { animation: none; }
          .feedback-neon-pulse { animation: none; }
        }
        .input-no-spin::-webkit-outer-spin-button,
        .input-no-spin::-webkit-inner-spin-button { -webkit-appearance: none; margin: 0; }
        .input-no-spin[type=number] { -moz-appearance: textfield; appearance: textfield; }
        .tv-floating-toolbar,
        .chart-controls-bar,
        #header-toolbar-resolutions,
        .tv-side-toolbar,
        .left-toolbar-container,
        .layout__area--left {
          display: none !important;
          pointer-events: none !important;
        }
        .tv-lightweight-charts-container .layout__area--left,
        .tv-lightweight-charts-container .layout__area--top {
          display: none !important;
          pointer-events: none !important;
        }
        .tv-header__area--right {
          display: none !important;
          opacity: 0 !important;
          pointer-events: none !important;
          width: 0 !important;
        }
        [data-name="legend"],
        [data-name="image"],
        [data-name="screenshot"],
        [data-name="header-screenshot"],
        [data-role="button"][aria-label="Indicators"] {
          display: none !important;
          pointer-events: none !important;
        }
        body { background-color: #050505; color: #EAEAEA; user-select: none; }
      `}</style>
    </div>
  );
};

// 辅助组件
const SidebarIcon = ({ icon, onClick, active, onMouseEnter, onMouseLeave }) => {
  return (
    <div
      className="relative"
      onMouseEnter={onMouseEnter}
      onMouseLeave={onMouseLeave}
    >
      <button
        onClick={() => {
          onClick?.();
        }}
        className={`p-4 rounded-2xl transition-all duration-300 ${active ? 'bg-[#00FFA3]/10 text-[#00FFA3] shadow-[0_0_25px_rgba(0,255,163,0.15)]' : 'text-gray-600 hover:text-white hover:bg-white/5'} active:scale-90`}
      >
        {icon}
      </button>
    </div>
  );
};

function formatTickerValue(value, decimals) {
  return Number.isFinite(value) ? value.toFixed(decimals) : '--';
}

function formatTickerChange(value) {
  return Number.isFinite(value) ? `${value >= 0 ? '+' : ''}${value.toFixed(2)}%` : '--';
}

const MarketTickerMarquee = ({ items }) => {
  const tickerItems = Array.isArray(items) && items.length ? items : MARKET_TICKER_INSTRUMENTS.map(buildPendingMarketTickerItem);
  const loopItems = [...tickerItems, ...tickerItems];

  return (
    <div className="market-ticker-mask h-10 overflow-hidden rounded-lg bg-[#03110d]/55 shadow-[0_0_22px_rgba(0,255,163,0.06),inset_0_1px_0_rgba(0,255,163,0.08)]">
      <div className="market-ticker-track flex h-full w-max items-center gap-3 px-3">
        {loopItems.map((item, index) => {
          const change = item.changePercent;
          const hasValue = Number.isFinite(item.value);
          const isUp = Number.isFinite(change) && change >= 0;
          const isDown = Number.isFinite(change) && change < 0;
          const toneClass = isUp ? 'text-[#00FFA3]' : isDown ? 'text-red-400' : 'text-zinc-500';

          return (
            <div
              key={`${item.id}-${index}`}
              className="flex h-7 shrink-0 items-center gap-2 rounded-md bg-[#06110e]/75 px-3 text-[10px] font-black uppercase tracking-[0.08em] shadow-[inset_0_0_0_1px_rgba(0,255,163,0.08)]"
            >
              <span className="text-zinc-300">{item.id}</span>
              <span className={hasValue ? 'font-mono text-white' : 'font-mono text-zinc-600'}>
                {formatTickerValue(item.value, item.decimals)}
              </span>
              <span className={`inline-flex items-center gap-1 font-mono ${toneClass}`}>
                {isUp ? <ArrowUpRight size={12} /> : isDown ? <ArrowDownRight size={12} /> : null}
                {formatTickerChange(change)}
              </span>
            </div>
          );
        })}
      </div>
    </div>
  );
};

const InputBox = ({ label, value, onChange, color="#fff", suffix="" }) => {
  const normalizedValue = value === '' || value == null ? '' : Number.isFinite(Number(value)) ? String(Number(value)) : '';

  return (
    <div className="bg-black/40 border border-white/5 rounded-2xl px-3 py-3 text-left shadow-inner">
       <div className="select-none text-[9px] text-gray-600 font-black uppercase mb-1.5 tracking-[0.12em] italic">{label}</div>
       <div className="flex min-w-0 items-center gap-1.5 rounded-lg border border-white/5 bg-black/25 px-2.5 py-1.5">
         <input
           type="text"
           inputMode="decimal"
           value={normalizedValue}
           onChange={(e) => {
             const cleanedValue = e.target.value.replace(/[^\d.]/g, '');
             const [whole, ...decimalParts] = cleanedValue.split('.');
             const nextValue = decimalParts.length ? `${whole}.${decimalParts.join('')}` : whole;
             onChange(nextValue === '' ? '' : Number(nextValue));
           }}
           className="input-no-spin min-w-0 flex-1 bg-transparent text-left text-xl font-black font-mono outline-none selection:bg-[#00FFA3]/20"
           style={{ color, textShadow: color !== '#fff' ? `0 0 14px ${color}` : 'none' }}
         />
         {suffix ? <span className="select-none shrink-0 text-sm font-black font-mono text-zinc-500">{suffix}</span> : null}
       </div>
    </div>
  );
};

const MiniFeature = ({ label, value, className = '' }) => (
  <div className={`bg-black/30 border border-white/5 rounded-lg px-2 py-1.5 min-h-[44px] ${className}`}>
     <div className="text-[7px] text-gray-600 font-black uppercase tracking-[0.14em] mb-0.5">{label}</div>
     <div className="text-[9px] text-zinc-300 font-semibold leading-3.5 break-words">{value}</div>
  </div>
);

const OverlayStat = ({ label, value, accent = 'text-white' }) => (
  <div>
     <div className="text-[6px] uppercase tracking-[0.05em] text-zinc-500 font-black mb-0.5">{label}</div>
     <div className={`text-[10px] font-black leading-3 ${accent}`}>{value}</div>
  </div>
);

const getContextToneClass = (tone = 'white') =>
  tone === 'green'
    ? 'text-[#00FFA3]'
    : tone === 'red'
      ? 'text-red-400'
      : tone === 'amber'
        ? 'text-amber-300'
        : tone === 'sky'
          ? 'text-sky-300'
          : 'text-white';

const ContextSummaryCard = ({ label, value, helper, tone = 'white' }) => (
  <div className="rounded-[1.65rem] border border-white/6 bg-[#0A0A0A] px-4 py-4 shadow-[0_24px_60px_rgba(0,0,0,0.45)]">
    <div className="text-[10px] font-black uppercase tracking-[0.18em] text-zinc-500">{label}</div>
    <div className={`mt-3 text-[23px] font-black leading-tight tracking-[-0.03em] ${getContextToneClass(tone)}`}>{value}</div>
    {helper ? <div className="mt-2 text-[11px] font-semibold text-zinc-500">{helper}</div> : null}
  </div>
);

const ContextMapPanel = ({ data }) => {
  const markerLeft = `${Math.max(4, Math.min(96, data.rangePosition))}%`;
  const zoneTone =
    data.zone === 'Upper range'
      ? 'text-[#00FFA3]'
      : data.zone === 'Lower range'
        ? 'text-red-400'
        : 'text-amber-300';

  return (
    <div className="overflow-hidden rounded-[2.4rem] border border-white/6 bg-[#0A0A0A] shadow-[0_28px_80px_rgba(0,0,0,0.55)]">
      <div className="border-b border-white/6 bg-[radial-gradient(circle_at_top_left,rgba(0,255,163,0.10),transparent_30%),linear-gradient(180deg,rgba(255,255,255,0.02),rgba(255,255,255,0))] px-5 py-5 sm:px-6">
        <div className="flex items-start justify-between gap-4">
          <div>
            <div className="text-[10px] font-black uppercase tracking-[0.2em] text-[#00FFA3]">Context Map</div>
            <div className="mt-2 text-[28px] font-black italic tracking-[-0.04em] text-white">MARKET ENVIRONMENT</div>
          </div>
          <div className={`rounded-full border border-white/10 bg-white/[0.03] px-3 py-1.5 text-[10px] font-black uppercase tracking-[0.16em] ${zoneTone}`}>
            {data.zone}
          </div>
        </div>
      </div>
      <div className="px-5 py-5 sm:px-6">
        <div className="rounded-[1.6rem] border border-white/6 bg-black/30 px-4 py-5">
          <div className="mb-3 flex items-center justify-between text-[10px] font-black uppercase tracking-[0.16em] text-zinc-600">
            <span>Lower Range</span>
            <span>Current Location</span>
            <span>Upper Range</span>
          </div>
          <div className="relative h-3 rounded-full border border-white/8 bg-black/70 shadow-inner">
            <div className="absolute inset-y-0 left-0 rounded-full bg-gradient-to-r from-red-400/20 via-amber-300/18 to-[#00FFA3]/25" style={{ width: markerLeft }} />
            <div className="absolute top-1/2 h-6 w-6 -translate-y-1/2 rounded-full border border-[#00FFA3]/45 bg-[#050505] shadow-[0_0_22px_rgba(0,255,163,0.28)]" style={{ left: `calc(${markerLeft} - 12px)` }} />
          </div>
          <div className="mt-3 text-right text-[11px] font-mono font-black text-zinc-400">{data.rangePosition}% of active range</div>
        </div>

        <div className="mt-4 grid grid-cols-1 gap-3 md:grid-cols-2">
          <ContextMapMetric label="Nearest Liquidity Above" value={data.nearestAbove} tone="green" />
          <ContextMapMetric label="Nearest Liquidity Below" value={data.nearestBelow} tone="red" />
          <ContextMapMetric label="Recent Sweep Status" value={data.sweepStatus} tone={data.sweepStatus === 'Rejected' ? 'amber' : data.sweepStatus === 'Accepted' ? 'green' : 'white'} />
          <ContextMapMetric label="Structure Bias" value={data.structureBias} tone={data.structureBias.includes('Bullish') ? 'green' : data.structureBias.includes('Bearish') ? 'red' : 'amber'} />
          <ContextMapMetric label="Volatility State" value={data.volatilityState} tone={data.volatilityState === 'Expanding' ? 'green' : data.volatilityState === 'Compressing' ? 'amber' : 'white'} />
          <ContextMapMetric label="Session State" value={data.sessionRead} tone={data.session === 'Off-session' ? 'white' : 'green'} />
        </div>

        <div className="mt-4 rounded-[1.35rem] border border-[#00FFA3]/14 bg-[#00FFA3]/6 px-4 py-3">
          <div className="text-[10px] font-black uppercase tracking-[0.18em] text-zinc-500">Reaction Location</div>
          <div className="mt-2 text-[18px] font-black text-white">{data.reactionZone}</div>
        </div>
      </div>
    </div>
  );
};

const ContextMapMetric = ({ label, value, tone = 'white' }) => (
  <div className="rounded-[1.15rem] border border-white/6 bg-[linear-gradient(180deg,rgba(255,255,255,0.022),rgba(255,255,255,0.008))] px-4 py-3">
    <div className="text-[9px] font-black uppercase tracking-[0.16em] text-zinc-600">{label}</div>
    <div className={`mt-2 text-[14px] font-black leading-tight ${getContextToneClass(tone)}`}>{value}</div>
  </div>
);

const ContextDecisionCard = ({ label, value, tone = 'white' }) => (
  <div className="rounded-[1.6rem] border border-white/6 bg-[#0A0A0A] px-4 py-4 shadow-[0_24px_60px_rgba(0,0,0,0.45)]">
    <div className="text-[10px] font-black uppercase tracking-[0.18em] text-zinc-500">{label}</div>
    <div className={`mt-2 text-[20px] font-black leading-tight tracking-[-0.03em] ${getContextToneClass(tone)}`}>{value}</div>
  </div>
);

const ContextBulletCard = ({ label, items, tone = 'white' }) => (
  <div className="rounded-[1.6rem] border border-white/6 bg-[#0A0A0A] px-4 py-4 shadow-[0_24px_60px_rgba(0,0,0,0.45)]">
    <div className="text-[10px] font-black uppercase tracking-[0.18em] text-zinc-500">{label}</div>
    <div className="mt-3 space-y-2">
      {(items.length ? items : ['no clean supporting read yet']).map((item) => (
        <div key={item} className="flex items-start gap-2 text-[12px] font-semibold leading-5 text-zinc-300">
          <span className={`mt-1 h-1.5 w-1.5 shrink-0 rounded-full ${tone === 'green' ? 'bg-[#00FFA3]' : tone === 'red' ? 'bg-red-400' : 'bg-zinc-500'}`} />
          <span>{item}</span>
        </div>
      ))}
    </div>
  </div>
);

const ContextConfirmationTile = ({ label, value }) => (
  <div className="rounded-[1.2rem] border border-white/6 bg-black/35 px-3 py-3 shadow-[inset_0_1px_0_rgba(255,255,255,0.03)]">
    <div className="text-[9px] font-black uppercase tracking-[0.16em] text-zinc-500">{label}</div>
    <div className="mt-2 text-[15px] font-black leading-tight text-white">{value}</div>
  </div>
);

const ContextGuidanceCard = ({ label, value }) => (
  <div className="rounded-[1.45rem] border border-white/6 bg-[#0A0A0A] px-4 py-4 shadow-[0_24px_60px_rgba(0,0,0,0.42)]">
    <div className="text-[10px] font-black uppercase tracking-[0.18em] text-[#00FFA3]">{label}</div>
    <div className="mt-2 text-sm font-semibold leading-6 text-zinc-200">{value}</div>
  </div>
);

const ArchiveField = ({ label, value, valueClassName = 'text-white' }) => (
  <div className="min-w-0">
    <div className="mb-1 text-[9px] font-black uppercase tracking-[0.16em] text-zinc-600 xl:hidden">{label}</div>
    <div className={`font-mono text-[13px] font-semibold ${valueClassName}`}>{value}</div>
  </div>
);

const ArchiveBadge = ({ label, value, tone = 'white' }) => {
  const toneClass =
    tone === 'green'
      ? 'text-[#00FFA3] border-[#00FFA3]/18 bg-[#00FFA3]/8'
      : tone === 'blue'
        ? 'text-sky-300 border-sky-300/18 bg-sky-300/8'
        : tone === 'amber'
          ? 'text-amber-300 border-amber-300/18 bg-amber-300/8'
          : tone === 'red'
            ? 'text-red-400 border-red-400/18 bg-red-400/8'
            : 'text-zinc-300 border-white/8 bg-white/[0.03]';

  return (
    <div className={`rounded-[1rem] border px-3 py-2.5 shadow-[inset_0_1px_0_rgba(255,255,255,0.03)] ${toneClass}`}>
      <div className="text-[9px] font-black uppercase tracking-[0.16em] opacity-70">{label}</div>
      <div className="mt-1.5 text-[17px] font-black leading-none">{value}</div>
    </div>
  );
};

const ArchiveStatusPill = ({ type, value }) => {
  const palette =
    type === 'outcome'
      ? value === 'WIN'
        ? 'text-[#00FFA3] border-[#00FFA3]/18 bg-[#00FFA3]/10'
        : value === 'LOSS'
          ? 'text-red-400 border-red-400/18 bg-red-400/10'
          : value === 'OPEN'
            ? 'text-amber-300 border-amber-300/18 bg-amber-300/10'
            : value === 'NOT_TRIGGERED'
              ? 'text-sky-300 border-sky-300/18 bg-sky-300/10'
              : value === 'INVALIDATED_BEFORE_ENTRY'
                ? 'text-orange-300 border-orange-300/18 bg-orange-300/10'
                : 'text-zinc-300 border-white/10 bg-white/[0.04]'
      : value === 'QUALIFIED'
        ? 'text-[#00FFA3] border-[#00FFA3]/18 bg-[#00FFA3]/10'
        : value === 'WATCHED'
          ? 'text-sky-300 border-sky-300/18 bg-sky-300/10'
          : value === 'FILTERED'
            ? 'text-orange-300 border-orange-300/18 bg-orange-300/10'
            : value === 'MISSED'
              ? 'text-red-400 border-red-400/18 bg-red-400/10'
              : 'text-zinc-300 border-white/10 bg-white/[0.04]';

  return (
    <div className={`inline-flex rounded-full border px-2.5 py-1 text-[9px] font-black uppercase tracking-[0.14em] ${palette}`}>
      {value}
    </div>
  );
};

const LiquiditySummaryCard = ({ label, value, helper, accentClassName = 'text-white' }) => (
  <div className="flex min-h-[126px] flex-col justify-between rounded-[1.45rem] border border-white/6 bg-[#0A0A0A] px-5 py-4 shadow-[0_24px_60px_rgba(0,0,0,0.45)]">
    <div className="text-[10px] font-black uppercase leading-4 tracking-[0.16em] text-zinc-500">{label}</div>
    <div className={`mt-3 break-words text-[22px] font-black leading-tight ${accentClassName}`}>{value}</div>
    {helper ? <div className="mt-3 text-[11px] leading-4 text-zinc-500">{helper}</div> : <div className="mt-3 h-4" />}
  </div>
);

const LiquidityMapCell = ({ pool, side }) => {
  if (!pool) {
    return (
      <div className="flex h-full min-w-0 items-stretch">
        <div className="flex w-full min-w-0 items-center rounded-[1rem] border border-dashed border-white/8 bg-black/20 px-3 py-3 text-[10px] leading-4 text-zinc-600">No active level</div>
      </div>
    );
  }

  return (
    <div className="flex h-full min-w-0 items-stretch">
      <div className={`flex w-full min-w-0 items-center rounded-[0.95rem] border px-2.5 py-2.5 ${side === 'BUY' ? 'border-[#00FFA3]/18 bg-[#00FFA3]/[0.07]' : 'border-red-400/18 bg-red-400/[0.07]'}`}>
        <div className="w-full min-w-0">
          <div className="whitespace-normal text-[9px] font-black uppercase leading-3.5 tracking-[0.02em] text-white">{pool.label}</div>
          <div className="mt-2 flex min-w-0 flex-wrap items-center gap-1.5">
            <div className="min-w-0 text-[11px] font-mono font-semibold leading-none text-zinc-200">{pool.displayPrice}</div>
            <div className="shrink-0 whitespace-nowrap rounded-full border border-white/10 bg-white/[0.03] px-1.5 py-0.5 text-[6px] font-black uppercase leading-none text-zinc-400">{pool.tag}</div>
          </div>
        </div>
      </div>
    </div>
  );
};

const LiquidityDecisionCard = ({ label, value, tone = 'white' }) => {
  const toneClass =
    tone === 'green'
      ? 'text-[#00FFA3]'
      : tone === 'red'
        ? 'text-red-400'
        : tone === 'amber'
          ? 'text-amber-300'
          : tone === 'sky'
            ? 'text-sky-300'
            : 'text-white';

  return (
    <div className="flex min-h-[92px] flex-col justify-center rounded-[1.45rem] border border-white/6 bg-[#0A0A0A] px-5 py-4 shadow-[0_24px_60px_rgba(0,0,0,0.45)]">
      <div className="text-[10px] font-black uppercase leading-4 tracking-[0.16em] text-zinc-500">{label}</div>
      <div className={`mt-2 break-words text-[19px] font-black leading-tight ${toneClass}`}>{value}</div>
    </div>
  );
};

const LiquidityPoolDecisionCard = ({ label, pool }) => (
  <div className="flex min-h-[116px] flex-col justify-center rounded-[1.45rem] border border-white/6 bg-[#0A0A0A] px-5 py-4 shadow-[0_24px_60px_rgba(0,0,0,0.45)]">
    <div className="text-[10px] font-black uppercase leading-4 tracking-[0.16em] text-zinc-500">{label}</div>
    <div className="mt-2 break-words text-[16px] font-black leading-tight text-white">{pool?.label ?? 'No clean pool'}</div>
    <div className="mt-3 flex flex-wrap items-center justify-between gap-2">
      <div className="text-[15px] font-mono font-semibold leading-none text-zinc-200">{pool?.displayPrice ?? '--'}</div>
      <div className="rounded-full border border-white/8 bg-white/[0.03] px-2 py-1 text-[10px] leading-none text-zinc-500">{pool ? `${pool.displayDistance} away` : '--'}</div>
    </div>
  </div>
);

const LiquidityMiniCard = ({ label, value }) => (
  <div className="flex min-h-[92px] flex-col justify-center rounded-[1.15rem] border border-white/6 bg-black/35 px-4 py-3 shadow-[inset_0_1px_0_rgba(255,255,255,0.03)]">
    <div className="text-[9px] font-black uppercase leading-4 tracking-[0.14em] text-zinc-500">{label}</div>
    <div className="mt-2 break-words text-[15px] font-black leading-tight text-white">{value}</div>
  </div>
);

const LiquidityGuidanceCard = ({ label, value }) => (
  <div className="min-h-[130px] rounded-[1.45rem] border border-white/6 bg-[#0A0A0A] px-5 py-4 shadow-[0_24px_60px_rgba(0,0,0,0.45)]">
    <div className="text-[10px] font-black uppercase leading-4 tracking-[0.16em] text-zinc-500">{label}</div>
    <div className="mt-3 text-sm leading-6 text-zinc-200">{value}</div>
  </div>
);

const LiquidityCoverageCard = ({ label, ready }) => (
  <div className="min-h-[86px] rounded-[1.25rem] border border-white/6 bg-black/30 px-5 py-4">
    <div className="text-[10px] font-black uppercase leading-4 tracking-[0.14em] text-zinc-500">{label}</div>
    <div className={`mt-2 text-[13px] font-black leading-5 ${ready ? 'text-[#00FFA3]' : 'text-zinc-500'}`}>{ready ? 'Ready from live feed' : 'Limited by current feed history'}</div>
  </div>
);

export default App;
