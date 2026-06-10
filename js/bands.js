// CondX — band openness engine.
// Turns MUF / foF2 / solar indices / day-night into a 0-100 score + status/color
// per band. This is a heuristic estimate, not a propagation prediction model.
import { BANDS } from './config.js';
import { sunElevation } from './geo.js';

export const STATUS = {
  excellent: { label: 'Excellent', cls: 'st-excellent', open: true },
  good:      { label: 'Good',      cls: 'st-good',      open: true },
  fair:      { label: 'Fair',      cls: 'st-fair',      open: true },
  poor:      { label: 'Poor',      cls: 'st-poor',      open: false },
  closed:    { label: 'Closed',    cls: 'st-closed',    open: false },
  es:        { label: 'Es watch',  cls: 'st-es',        open: false }
};

function statusFromScore(score) {
  if (score >= 80) return 'excellent';
  if (score >= 62) return 'good';
  if (score >= 45) return 'fair';
  if (score >= 25) return 'poor';
  return 'closed';
}

// Daytime D-layer absorption penalty: worst on the low bands, and strongest
// when the sun is high. Near 0 at/above ~12 MHz and at night.
function dayAbsorption(freq, elev) {
  const sun = Math.max(0, Math.sin(elev * Math.PI / 180));   // 0..1 (noon ≈ 1)
  const base = Math.max(0, 12 - freq);                        // 160m≈10 … 20m≈0
  return base * 7 * sun;                                      // noon: 160m≈71, 80m≈59, 40m≈35
}

// Build the context the classifier needs from current conditions.
export function buildContext({ mufd, fof2, lat, lon, sfi, kp, date = new Date() }) {
  const elev = sunElevation(date, lat, lon);
  return {
    mufd: mufd ?? estimateMuf(sfi, elev),
    fof2,
    sfi, kp: kp ?? 0,
    elev,
    isDay: elev > 0,
    isGrayline: elev > -8 && elev < 6,
    month: date.getUTCMonth() + 1,
    estimated: mufd == null
  };
}

// Fallback MUF(3000) when no live ionosonde reading is available (very rough).
// Exported so the path-MUF engine can estimate the midpoint MUF the same way.
export function estimateMuf(sfi, elev) {
  const dayFactor = Math.max(0, Math.sin(elev * Math.PI / 180));
  const fof2 = 2.5 + 0.018 * (sfi || 90) + 8 * dayFactor;
  return +(fof2 * 3.0).toFixed(1);
}

function classifyOne(band, ctx) {
  const f = band.freq;
  const muf = ctx.mufd;
  const owf = 0.85 * muf;            // optimum working frequency
  let score, headroom;

  if (f <= owf) {
    headroom = (owf - f) / owf;                 // 0..1
    score = 70 + 30 * Math.min(1, headroom);    // 70..100
  } else if (f <= muf) {
    score = 50 + 18 * ((muf - f) / (muf - owf)); // 50..68 marginal
  } else {
    const over = (f - muf) / muf;
    score = Math.max(0, 42 - over * 180);        // above MUF, falls fast
  }

  // Daytime absorption hurts the low bands.
  if (ctx.isDay) score -= dayAbsorption(f, ctx.elev);
  // Grayline lifts the low bands a little.
  if (ctx.isGrayline && f <= 7) score += 8;
  // Geomagnetic storms degrade everything, low bands / high paths most.
  if (ctx.kp >= 5) score -= (ctx.kp - 4) * 9;

  score = Math.max(0, Math.min(100, Math.round(score)));
  let key = statusFromScore(score);

  // 6m: flag sporadic-E season even when F2 says closed.
  let note = '';
  if (band.id === '6m') {
    const esSeason = [5, 6, 7, 8].includes(ctx.month) ||
                     [11, 12].includes(ctx.month);
    if (muf >= 50) { note = 'F2 open!'; }
    else if (esSeason && !STATUS[key].open) { key = 'es'; note = 'Es season'; }
  }

  return {
    band: band.id, freq: f, score, status: key,
    open: STATUS[key].open, note,
    headroom: Math.max(0, +(muf / f).toFixed(2))   // MUF/freq ratio
  };
}

export function classifyAll(ctx) {
  return BANDS.map(b => classifyOne(b, ctx));
}
