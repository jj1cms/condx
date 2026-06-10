// CondX — world map (Leaflet). Dark tiles + grayline terminator + my QTH +
// ionosonde stations coloured by MUF. Leaflet (global `L`) is loaded from CDN.
let map = null, stationLayer = null, qthMarker = null, terminator = null;

// MUF -> colour (low = red, high = green): mirrors the band-status palette.
function mufColor(muf) {
  if (muf == null) return '#64748b';
  if (muf >= 28) return '#22c55e';   // 10m+ open
  if (muf >= 21) return '#84cc16';
  if (muf >= 14) return '#eab308';   // 20m
  if (muf >= 10) return '#f59e0b';
  if (muf >= 7)  return '#f97316';   // 40m
  return '#ef4444';                  // low
}

export function initMap(el, lat, lon) {
  if (typeof L === 'undefined') return null;
  if (map) return map;
  map = L.map(el, { worldCopyJump: true, attributionControl: true })
    .setView([lat, lon], 2);
  L.tileLayer('https://{s}.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}{r}.png', {
    attribution: '© OpenStreetMap, © CARTO',
    subdomains: 'abcd', maxZoom: 7, minZoom: 1
  }).addTo(map);

  if (typeof L.terminator === 'function') {
    terminator = L.terminator({ fillOpacity: 0.32, color: '#000', fillColor: '#000', weight: 1 });
    terminator.addTo(map);
  }
  stationLayer = L.layerGroup().addTo(map);
  // re-measure after the tab becomes visible
  setTimeout(() => map.invalidateSize(), 200);
  return map;
}

export function setQTH(lat, lon, label) {
  if (!map) return;
  if (qthMarker) map.removeLayer(qthMarker);
  qthMarker = L.marker([lat, lon], {
    icon: L.divIcon({ className: 'qth-icon', html: '📍', iconSize: [24, 24] })
  }).addTo(map).bindPopup(`<b>${label || 'My QTH'}</b>`);
  map.setView([lat, lon], map.getZoom() < 2 ? 2 : map.getZoom());
}

export function updateStations(stations) {
  if (!map || !stationLayer) return;
  stationLayer.clearLayers();
  for (const s of stations) {
    const c = L.circleMarker([s.lat, s.lon], {
      radius: 5, color: '#0b1220', weight: 1,
      fillColor: mufColor(s.mufd), fillOpacity: 0.9
    });
    c.bindPopup(
      `<b>${s.name}</b><br>MUF: ${s.mufd?.toFixed(1)} MHz` +
      (s.fof2 ? `<br>foF2: ${s.fof2.toFixed(1)} MHz` : '') +
      (s.ageMin != null ? `<br><span style="opacity:.7">${s.ageMin} min ago</span>` : '')
    );
    c.addTo(stationLayer);
  }
}

export function refreshTerminator() {
  if (terminator && typeof terminator.setTime === 'function') terminator.setTime();
}

export function resize() { if (map) map.invalidateSize(); }
