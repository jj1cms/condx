// CondX — DX cluster spots (best-effort; tolerant of third-party outages).
import { DATA, BANDS } from './config.js';

function bandForFreqKHz(khz) {
  const mhz = khz / 1000;
  let best = null, bestD = Infinity;
  for (const b of BANDS) {
    const d = Math.abs(b.freq - mhz);
    if (d < bestD && d < 1.2) { bestD = d; best = b.id; }
  }
  // wider HF bands not in our list -> approximate label
  if (!best) {
    if (mhz >= 1.8 && mhz < 2) best = '160m';
    else if (mhz >= 3.5 && mhz < 4) best = '80m';
    else if (mhz >= 7 && mhz < 7.3) best = '40m';
    else if (mhz >= 14 && mhz < 14.4) best = '20m';
    else if (mhz >= 28 && mhz < 30) best = '10m';
    else if (mhz >= 50 && mhz < 54) best = '6m';
  }
  return best;
}

async function tryFetch(url, viaProxy) {
  const target = viaProxy ? DATA.corsProxy + encodeURIComponent(url) : url;
  const r = await fetch(target, { cache: 'no-store' });
  if (!r.ok) throw new Error(`${r.status}`);
  return r.json();
}

// Returns { spots: [...], source: 'direct'|'proxy', error: null } or throws-free
// degraded result { spots: [], error: '...' }.
export async function getSpots(limit = 40) {
  const url = `${DATA.dxSummit}?limit=${limit}`;
  let raw = null, source = null;
  try { raw = await tryFetch(url, false); source = 'direct'; }
  catch (_) {
    try { raw = await tryFetch(url, true); source = 'proxy'; }
    catch (e) { return { spots: [], source: null, error: 'spots-unavailable' }; }
  }

  const list = Array.isArray(raw) ? raw : (raw.spots || []);
  const spots = list.map(s => {
    const khz = parseFloat(s.frequency ?? s.freq);
    return {
      dx: s.dx_call ?? s.dx ?? s.call,
      spotter: s.de_call ?? s.spotter ?? s.de,
      freq: khz,
      band: bandForFreqKHz(khz),
      comment: (s.info ?? s.comment ?? '').trim(),
      time: s.time ?? s.date_time ?? s.when
    };
  }).filter(s => s.dx && Number.isFinite(s.freq));

  return { spots, source, error: spots.length ? null : 'no-spots' };
}
