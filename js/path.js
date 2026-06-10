// CondX — point-to-point path MUF from great-circle geometry + the secant law.
//
// The "status" dashboard describes the ionosphere directly over the QTH only.
// This module answers the other half of the question the user actually has:
// "will <band> reach <that station>?" — which depends on the angle of incidence
// at the reflection point, i.e. the path geometry, not just the overhead MUF.
//
// Physics: for a single hop of ground range d reflecting at virtual height h',
// curved-earth geometry gives the take-off elevation Δ and the incidence angle
// φ at the layer:
//        ψ  = d / 2R                       (half-hop geocentric angle)
//        Δ  = atan2(cosψ − k, sinψ),  k = R/(R+h')
//        φ  = 90° − ψ − Δ
//        sin φ = (R/(R+h'))·cos Δ           (standard relation, for reference)
// and the path MUF follows the secant law  MUF = f_c · sec φ.
//
// For the F2 layer we don't trust an absolute sec φ (the real ionosphere isn't a
// thin mirror), so we *scale* a known midpoint MUF(3000): a 3000 km hop
// reproduces MUF(3000) exactly and other hop lengths scale by sec φ. The Es
// layer is thin, so there the secant law is applied directly to foEs.
import { BANDS } from './config.js';
import { distanceKm, midpoint, sunElevation, hopGeometry } from './geo.js';
import { estimateMuf } from './bands.js';

const R = 6371;        // Earth radius, km
const H_F2 = 300;      // default F2 virtual reflection height, km
const H_ES = 105;      // sporadic-E layer height, km

// Longest single hop (km) before the ray grazes the horizon (Δ→0); we stay at
// 92% of that so the elevation angle keeps a few usable degrees.
function maxHop(hPrime) {
  return 0.92 * (2 * R * Math.acos(R / (R + hPrime)));
}

// Fewest-hop geometry for a path of length D at reflection height h'. Fewest
// hops = lowest angle = highest MUF, which is the controlling MUF for the path.
export function pathGeometry(D, hPrime) {
  const hops = Math.max(1, Math.ceil(D / maxHop(hPrime)));
  const d = D / hops;
  return { hops, hopKm: Math.round(d), ...hopGeometry(d, hPrime) };
}

// Nearest fresh station to (lat,lon) within maxKm and maxAgeMin, optional filter.
function nearestFresh(list, lat, lon, maxAgeMin, maxKm, pred = () => true) {
  let best = null, bestD = Infinity;
  for (const s of list || []) {
    if (s.ageMin != null && s.ageMin > maxAgeMin) continue;
    if (!pred(s)) continue;
    const dist = distanceKm(lat, lon, s.lat, s.lon);
    if (dist <= maxKm && dist < bestD) { bestD = dist; best = s; }
  }
  return best ? { ...best, distanceKm: Math.round(bestD) } : null;
}

// Per-band verdict from the path MUF (and any Es MUF).
function verdict(band, pMuf, es) {
  const f = band.freq;
  const owf = 0.85 * pMuf;
  let status, label;
  if (f <= owf)        { status = 'open';     label = '開'; }
  else if (f <= pMuf)  { status = 'marginal'; label = '際どい'; }
  else                 { status = 'closed';   label = '閉'; }
  const esOpen = es != null && status === 'closed' && f <= es.muf;
  return { band: band.id, freq: f, status, label, esOpen, ratio: +(pMuf / f).toFixed(2) };
}

// Evaluate a QTH → target path. `stationsFresh` are recent ionosonde readings.
export function evaluatePath({ qth, target, sfi, stationsFresh = [], date = new Date() }) {
  const D = distanceKm(qth.lat, qth.lon, target.lat, target.lon);
  const mid = midpoint(qth.lat, qth.lon, target.lat, target.lon);

  // Midpoint MUF(3000): prefer a fresh ionosonde near the reflection region,
  // else estimate from solar flux + the sun's elevation at the midpoint.
  const near = nearestFresh(stationsFresh, mid.lat, mid.lon, 90, 2500);
  const hPrime = near?.hmf2 || H_F2;
  const muf3000 = near?.mufd ?? estimateMuf(sfi, sunElevation(date, mid.lat, mid.lon));

  const f2 = pathGeometry(D, hPrime);
  const refSec = hopGeometry(3000, hPrime).sec;             // sec φ at a 3000 km hop
  const pathMuf = +(muf3000 * f2.sec / refSec).toFixed(1);

  // Es is local and patchy, so only use a *close*, *recent* foEs reading. Try
  // near the midpoint first, then near the QTH.
  const esStn = nearestFresh(stationsFresh, mid.lat, mid.lon, 60, 1200, s => s.foes != null)
            ||  nearestFresh(stationsFresh, qth.lat, qth.lon, 60, 1200, s => s.foes != null);
  let es = null;
  if (esStn) {
    const eg = pathGeometry(D, H_ES);
    es = { ...eg, foEs: esStn.foes, muf: +(esStn.foes * eg.sec).toFixed(1),
           station: esStn.name, distanceKm: esStn.distanceKm, ageMin: esStn.ageMin };
  }

  return {
    distanceKm: Math.round(D), midpoint: mid,
    hPrime: Math.round(hPrime), muf3000: +(+muf3000).toFixed(1),
    pathMuf, f2, es, estimated: !near,
    bands: BANDS.map(b => verdict(b, pathMuf, es))
  };
}
