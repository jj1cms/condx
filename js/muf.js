// CondX — KC2G ionosonde data (real-time MUF / foF2) + MUF map URL
import { DATA } from './config.js';
import { distanceKm } from './geo.js';

async function fetchJSONWithTimeout(url, ms = 8000) {
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), ms);
  try {
    const r = await fetch(url, { cache: 'no-store', signal: ctrl.signal });
    if (!r.ok) throw new Error(String(r.status));
    return await r.json();
  } finally { clearTimeout(t); }
}

// Normalised list of ionosonde stations with a fresh MUF reading.
// KC2G's stations.json sends no CORS header, so it is fetched through a CORS
// proxy. This is best-effort — the band engine falls back to estimated MUF
// (no station data) whenever this fails.
export async function getStations() {
  const url = DATA.corsProxy + encodeURIComponent(DATA.kc2gStations);
  const raw = await fetchJSONWithTimeout(url, 8000);
  const now = Date.now();
  return raw.map(s => {
    const st = s.station || {};
    let lon = parseFloat(st.longitude);
    if (lon > 180) lon -= 360;                 // KC2G uses 0..360 east
    const t = s.time ? Date.parse(s.time + 'Z') : NaN;
    return {
      name: st.name || st.code || '?',
      code: st.code,
      lat: parseFloat(st.latitude),
      lon,
      mufd: s.mufd != null ? +s.mufd : null,   // MUF(3000) in MHz
      fof2: s.fof2 != null ? +s.fof2 : null,
      time: t,
      ageMin: Number.isFinite(t) ? Math.round((now - t) / 60000) : null
    };
  }).filter(s => Number.isFinite(s.lat) && Number.isFinite(s.lon) && s.mufd != null);
}

// Nearest station with a recent reading (default within last 2h).
export function nearestStation(stations, lat, lon, maxAgeMin = 120) {
  let best = null, bestD = Infinity;
  for (const s of stations) {
    if (s.ageMin != null && s.ageMin > maxAgeMin) continue;
    const d = distanceKm(lat, lon, s.lat, s.lon);
    if (d < bestD) { bestD = d; best = s; }
  }
  return best ? { ...best, distanceKm: Math.round(bestD) } : null;
}

// Cache-busted MUF map image URL (KC2G refreshes roughly every few minutes).
export function mufMapUrl() {
  const bucket = Math.floor(Date.now() / 240000);   // ~4 min buckets
  return `${DATA.kc2gMufMap}?t=${bucket}`;
}
