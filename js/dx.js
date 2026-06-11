// CondX — DX cluster spots (best-effort; tolerant of third-party outages).
// Primary source is HamQTH's dxc_csv.php (CORS '*', reliable). DX Summit is a
// JSON fallback. Every fetch is time-boxed so a dead source degrades quickly
// to the "couldn't fetch" message instead of hanging the tab forever.
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

// HF + 6m only — drop the VHF/UHF (2m, 70cm…) spots the feeds also carry.
const inScope = s => s.dx && Number.isFinite(s.freq) && s.freq < 60000;

function fetchText(url, ms = 8000) {
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), ms);
  return fetch(url, { cache: 'no-store', signal: ctrl.signal })
    .then(r => { if (!r.ok) throw new Error(String(r.status)); return r.text(); })
    .finally(() => clearTimeout(t));
}

// HamQTH dxc_csv.php — one spot per line, caret-delimited fields:
// call ^ kHz ^ spotter ^ comment ^ "HHMM YYYY-MM-DD" ^ flag ^ _ ^ continent ^ band ^ country ^ id
function parseHamqth(text) {
  return text.split('\n').map(l => l.trim()).filter(Boolean).map(line => {
    const f = line.split('^');
    const khz = parseFloat(f[1]);
    const raw = (f[4] || '').trim();                 // "0650 2026-06-11" (UTC)
    const m = raw.match(/^(\d{2})(\d{2})\s+(\d{4}-\d{2}-\d{2})$/);
    const time = m ? `${m[3]}T${m[1]}:${m[2]}:00Z` : raw;
    return {
      dx: f[0], spotter: f[2], freq: khz,
      band: bandForFreqKHz(khz),
      comment: (f[3] || '').trim(),
      country: (f[9] || '').trim(),
      cont: (f[7] || '').trim(),
      time
    };
  });
}

function parseDxSummit(raw) {
  const list = Array.isArray(raw) ? raw : (raw.spots || []);
  return list.map(s => {
    const khz = parseFloat(s.frequency ?? s.freq);
    return {
      dx: s.dx_call ?? s.dx ?? s.call,
      spotter: s.de_call ?? s.spotter ?? s.de,
      freq: khz,
      band: bandForFreqKHz(khz),
      comment: (s.info ?? s.comment ?? '').trim(),
      country: '', cont: '',
      time: s.time ?? s.date_time ?? s.when
    };
  });
}

// Returns { spots:[...], source, error:null } or a degraded { spots:[], error }.
export async function getSpots(limit = 40) {
  // 1) HamQTH — CORS '*', no proxy needed.
  try {
    const spots = parseHamqth(await fetchText(`${DATA.dxHamqth}?limit=${limit}`))
      .filter(inScope).slice(0, limit);
    if (spots.length) return { spots, source: 'HamQTH', error: null };
  } catch (_) { /* fall through */ }

  // 2) DX Summit — direct, then via the CORS proxy.
  const dxUrl = `${DATA.dxSummit}?limit=${limit}`;
  for (const viaProxy of [false, true]) {
    try {
      const target = viaProxy ? DATA.corsProxy + encodeURIComponent(dxUrl) : dxUrl;
      const spots = parseDxSummit(JSON.parse(await fetchText(target)))
        .filter(inScope).slice(0, limit);
      if (spots.length) return { spots, source: viaProxy ? 'DX Summit (proxy)' : 'DX Summit', error: null };
    } catch (_) { /* try next */ }
  }

  return { spots: [], source: null, error: 'spots-unavailable' };
}
