// CondX — solar geometry + Maidenhead helpers (no dependencies)
const RAD = Math.PI / 180;

function dayOfYear(d) {
  const start = Date.UTC(d.getUTCFullYear(), 0, 0);
  const cur = Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate());
  return (cur - start) / 86400000;
}

// Sun elevation (degrees) at lat/lon for a given Date — NOAA approximation.
// lon east-positive. > 0 ≈ daytime, < -6 ≈ night, in between ≈ twilight/grayline.
export function sunElevation(date, lat, lon) {
  const doy = dayOfYear(date);
  const hour = date.getUTCHours() + date.getUTCMinutes() / 60 + date.getUTCSeconds() / 3600;
  const g = (2 * Math.PI / 365) * (doy - 1 + (hour - 12) / 24);
  const decl = 0.006918 - 0.399912 * Math.cos(g) + 0.070257 * Math.sin(g)
    - 0.006758 * Math.cos(2 * g) + 0.000907 * Math.sin(2 * g)
    - 0.002697 * Math.cos(3 * g) + 0.00148 * Math.sin(3 * g);
  const eqtime = 229.18 * (0.000075 + 0.001868 * Math.cos(g) - 0.032077 * Math.sin(g)
    - 0.014615 * Math.cos(2 * g) - 0.040849 * Math.sin(2 * g));
  const tst = hour * 60 + eqtime + 4 * lon;        // true solar time, minutes
  const ha = (tst / 4 - 180) * RAD;                 // hour angle
  const latr = lat * RAD;
  const cosZen = Math.sin(latr) * Math.sin(decl) +
    Math.cos(latr) * Math.cos(decl) * Math.cos(ha);
  const zen = Math.acos(Math.min(1, Math.max(-1, cosZen)));
  return 90 - zen / RAD;
}

// Great-circle distance (km) between two points.
export function distanceKm(lat1, lon1, lat2, lon2) {
  const dLat = (lat2 - lat1) * RAD;
  const dLon = (lon2 - lon1) * RAD;
  const a = Math.sin(dLat / 2) ** 2 +
    Math.cos(lat1 * RAD) * Math.cos(lat2 * RAD) * Math.sin(dLon / 2) ** 2;
  return 6371 * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

// Great-circle midpoint between two points -> {lat, lon}. Used to read the MUF
// at the controlling reflection region of a path (its midpoint).
export function midpoint(lat1, lon1, lat2, lon2) {
  const p1 = lat1 * RAD, p2 = lat2 * RAD, dl = (lon2 - lon1) * RAD;
  const bx = Math.cos(p2) * Math.cos(dl), by = Math.cos(p2) * Math.sin(dl);
  const pm = Math.atan2(Math.sin(p1) + Math.sin(p2),
    Math.sqrt((Math.cos(p1) + bx) ** 2 + by ** 2));
  const lm = lon1 * RAD + Math.atan2(by, Math.cos(p1) + bx);
  return { lat: pm / RAD, lon: ((lm / RAD + 540) % 360) - 180 };
}

// Single-hop secant-law geometry: ground range d (km), virtual reflection height
// h' (km). Curved-earth: ψ=d/2R, Δ=atan2(cosψ−R/(R+h'),sinψ), φ=90°−ψ−Δ.
// Returns take-off elevation Δ, incidence angle φ and sec φ. Shared by the path
// engine and the band-grid reference-distance scaling.
export function hopGeometry(d, hPrime) {
  const R = 6371;
  const psi = d / (2 * R);
  const k = R / (R + hPrime);
  const elev = Math.atan2(Math.cos(psi) - k, Math.sin(psi));   // Δ (rad)
  const inc = Math.PI / 2 - psi - elev;                        // φ (rad)
  return { elevDeg: elev / RAD, incDeg: inc / RAD, sec: 1 / Math.cos(inc) };
}

// Factor that converts a MUF(3000) value to MUF(refKm): M(ref)/M(3000). The
// ratio cancels the real-world obliquity correction baked into MUF(3000), so it
// applies equally to measured and estimated MUF. ~0.57 for ref=1000km.
export function mufScale3000(refKm, hPrime = 300) {
  return hopGeometry(refKm, hPrime).sec / hopGeometry(3000, hPrime).sec;
}

// Maidenhead grid -> {lat, lon} (centre of square). Returns null if invalid.
export function gridToLatLon(grid) {
  grid = (grid || '').trim().toUpperCase();
  if (!/^[A-R]{2}[0-9]{2}([A-X]{2})?$/.test(grid)) return null;
  let lon = (grid.charCodeAt(0) - 65) * 20 - 180;
  let lat = (grid.charCodeAt(1) - 65) * 10 - 90;
  lon += (+grid[2]) * 2;
  lat += (+grid[3]) * 1;
  if (grid.length >= 6) {
    lon += (grid.charCodeAt(4) - 65) * (2 / 24) + (1 / 24);
    lat += (grid.charCodeAt(5) - 65) * (1 / 24) + (0.5 / 24);
  } else { lon += 1; lat += 0.5; }
  return { lat, lon };
}

// {lat, lon} -> 6-char Maidenhead grid.
export function latLonToGrid(lat, lon) {
  lon += 180; lat += 90;
  const A = Math.floor(lon / 20), B = Math.floor(lat / 10);
  const C = Math.floor((lon % 20) / 2), D = Math.floor(lat % 10);
  const e = Math.floor((lon % 2) * 12), f = Math.floor((lat % 1) * 24);
  return String.fromCharCode(65 + A) + String.fromCharCode(65 + B) + C + D +
    String.fromCharCode(97 + e) + String.fromCharCode(97 + f);
}
