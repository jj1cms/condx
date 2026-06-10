// CondX — NOAA SWPC solar indices (SFI, SSN, K, A)
import { DATA } from './config.js';

async function getJSON(url) {
  const r = await fetch(url, { cache: 'no-store' });
  if (!r.ok) throw new Error(`${url} -> ${r.status}`);
  return r.json();
}

// Planetary K-index product. This endpoint returns an array of OBJECTS
// ({time_tag, Kp, a_running, station_count}); older SWPC products use an
// array-of-arrays with a header row — handle both shapes defensively.
async function getKp() {
  const rows = await getJSON(DATA.kIndex);
  let data;
  if (Array.isArray(rows[0])) {
    data = rows.slice(1).map(r => ({ time: r[0], kp: +r[1], a: +r[2] }));
  } else {
    data = rows.map(r => ({ time: r.time_tag, kp: +(r.Kp ?? r.kp), a: +(r.a_running ?? r.a) }));
  }
  data = data.filter(d => Number.isFinite(d.kp));
  const last = data[data.length - 1];
  const series = data.slice(-8).map(d => d.kp);   // last ~24h for a sparkline
  return { kp: last.kp, aIndex: last.a, kpTime: last.time, kpSeries: series };
}

// 10.7 cm radio flux summary: [{ flux, time_tag }].
async function getFlux() {
  const d = await getJSON(DATA.flux);
  const row = Array.isArray(d) ? d[0] : d;
  return { sfi: +row.flux, sfiTime: row.time_tag };
}

// Observed solar-cycle indices (monthly) -> latest sunspot number.
async function getSsn() {
  const arr = await getJSON(DATA.solarCycle);
  const last = arr[arr.length - 1];
  const ssn = last.observed_swpc_ssn ?? last.ssn;
  return { ssn: Math.round(ssn), ssnMonth: last['time-tag'] };
}

// Combined fetch — each source degrades independently.
export async function getSolar() {
  const out = { sfi: null, ssn: null, kp: null, aIndex: null, kpSeries: [], updated: new Date() };
  const results = await Promise.allSettled([getFlux(), getSsn(), getKp()]);
  for (const r of results) if (r.status === 'fulfilled') Object.assign(out, r.value);
  return out;
}

// Qualitative label/level for the geomagnetic K index.
export function kpLevel(kp) {
  if (kp == null) return { label: '—', level: 'na' };
  if (kp < 3) return { label: 'Quiet',    level: 'good' };
  if (kp < 4) return { label: 'Unsettled', level: 'fair' };
  if (kp < 5) return { label: 'Active',   level: 'warn' };
  if (kp < 6) return { label: 'Storm G1', level: 'bad' };
  if (kp < 7) return { label: 'Storm G2', level: 'bad' };
  return { label: 'Storm G3+', level: 'bad' };
}

// SFI gives a rough sense of how high the bands can go.
export function sfiLevel(sfi) {
  if (sfi == null) return 'na';
  if (sfi >= 150) return 'good';
  if (sfi >= 100) return 'fair';
  if (sfi >= 80)  return 'warn';
  return 'bad';
}
