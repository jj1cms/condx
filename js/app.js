// CondX — app orchestration
import { APP, BANDS } from './config.js';
import { getSolar, kpLevel, sfiLevel } from './solar.js';
import { getStations, nearestStation, mufMapUrl } from './muf.js';
import { buildContext, classifyAll, STATUS } from './bands.js';
import { getSpots } from './dx.js';
import { loadSettings, saveSettings } from './store.js';
import * as notify from './notify.js';
import * as mapview from './mapview.js';
import { latLonToGrid, gridToLatLon } from './geo.js';
import { evaluatePath } from './path.js';

const $ = (s, r = document) => r.querySelector(s);
const el = (t, c, html) => { const e = document.createElement(t); if (c) e.className = c; if (html != null) e.innerHTML = html; return e; };

let settings = loadSettings();
let state = { solar: null, stations: [], stationsFresh: [], stationStatus: null, nearest: null, results: [], ctx: null };
let mapReady = false, refreshTimer = null;
let lastTarget = null;   // { input, label } of the last path evaluated

// Representative DX-region grids for the quick-target chips.
const TARGETS = [
  { label: 'ヨーロッパ', grid: 'JN18' },   // Paris
  { label: '北米東',     grid: 'FN30' },   // New York
  { label: '北米西',     grid: 'DM04' },   // Los Angeles
  { label: '南米',       grid: 'GG66' },   // São Paulo
  { label: 'アフリカ',   grid: 'KG44' },   // East/South Africa
  { label: 'オセアニア', grid: 'QF56' }    // Sydney
];

// ---------- boot ----------
function boot() {
  $('#app-version').textContent = 'v' + APP.version;
  buildSettingsForm();
  wireTabs();
  wireRefresh();
  wireTarget();
  if ('serviceWorker' in navigator) {
    navigator.serviceWorker.register('./sw.js').catch(() => {});
  }
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'visible') refreshAll();
  });
  refreshAll();
  refreshDX();
  scheduleRefresh();
}

function scheduleRefresh() {
  clearInterval(refreshTimer);
  refreshTimer = setInterval(() => { refreshAll(); refreshDX(); },
    Math.max(2, settings.refreshMin) * 60000);
}

// ---------- data ----------
async function refreshAll() {
  setStatus('updating…');
  let stationStatus = null;
  const [solar, stations] = await Promise.all([
    getSolar().catch(() => null),
    getStations()
      .then(list => { stationStatus = { ok: true, count: list.length, time: new Date() }; return list; })
      .catch(() => { stationStatus = { ok: false, time: new Date() }; return []; })
  ]);
  state.solar = solar;
  state.stations = stations;
  state.stationStatus = stationStatus;
  // Stations recent enough to plot on the map (the feed keeps stale readings).
  state.stationsFresh = stations.filter(s => s.ageMin != null && s.ageMin < 180);

  // Use a real ionosonde for the band engine only when one is both fresh and
  // close enough to represent the QTH; otherwise fall back to a local estimate
  // (which is more representative than a distant station).
  const near = stations.length ? nearestStation(stations, settings.lat, settings.lon, 90) : null;
  const useStation = near && near.distanceKm < 2500;
  state.nearest = useStation ? near : null;

  state.ctx = buildContext({
    mufd: useStation ? near.mufd : null,
    fof2: useStation ? near.fof2 : null,
    lat: settings.lat, lon: settings.lon,
    sfi: solar ? solar.sfi : null,
    kp: solar ? solar.kp : null
  });
  state.results = classifyAll(state.ctx);

  renderDashboard();
  renderStationStatus();
  if (mapReady) { mapview.updateStations(state.stationsFresh); mapview.refreshTerminator(); }
  setMufMap();

  if (settings.notify) notify.checkBandOpenings(state.results, settings.watch);
  setStatus('updated ' + fmtTime(new Date()));
}

async function refreshDX() {
  const box = $('#dx-list');
  box.setAttribute('aria-busy', 'true');
  const res = await getSpots(40);
  renderDX(res);
  box.removeAttribute('aria-busy');
}

// ---------- dashboard ----------
function renderDashboard() {
  const s = state.solar || {};
  const k = kpLevel(s.kp);
  $('#solar-cards').replaceChildren(
    card('SFI', s.sfi ?? '—', '10.7cm flux', sfiLevel(s.sfi)),
    card('SSN', s.ssn ?? '—', 'sunspot №', s.ssn >= 100 ? 'good' : s.ssn >= 50 ? 'fair' : 'warn'),
    card('K', s.kp != null ? s.kp.toFixed(1) : '—', k.label, k.level),
    card('A', s.aIndex ?? '—', 'geomag', s.aIndex == null ? 'na' : s.aIndex < 8 ? 'good' : s.aIndex < 20 ? 'fair' : 'bad')
  );
  $('#mini-stat').textContent =
    `SFI ${s.sfi ?? '–'} · K ${s.kp != null ? s.kp.toFixed(1) : '–'}`;

  // context line
  const ctx = state.ctx || {};
  const n = state.nearest;
  const dn = ctx.isGrayline ? '🌅 グレーライン' : ctx.isDay ? '☀️ 昼' : '🌙 夜';
  const mufStr = ctx.mufd != null ? ctx.mufd.toFixed(1) : '—';
  const tag = ctx.estimated ? '推定' : '実測';
  let line = `${tag} MUF(${ctx.refKm ?? 1000}km) <b>${mufStr} MHz</b>`;
  line += n
    ? ` · ${n.name} MUF(3000) ${n.mufd.toFixed(1)}` +
      (n.fof2 ? ` foF2 ${n.fof2.toFixed(1)}` : '') +
      ` · ${n.distanceKm} km · ${n.ageMin ?? '?'}分前`
    : `（太陽指数＋太陽高度ベース）`;
  $('#ctx-line').innerHTML = line + ` · ${dn}`;

  // band grid
  const grid = $('#band-grid');
  grid.replaceChildren(...state.results.map(bandRow));

  // open summary
  const open = state.results.filter(r => r.open && r.score >= 62).map(r => r.band);
  $('#open-summary').innerHTML = open.length
    ? `🟢 開けている: <b>${open.join(', ')}</b>`
    : `今は強い開放なし — low bands / 夜間を確認`;

  if (lastTarget) computeTarget(lastTarget.input, lastTarget.label);   // refresh path verdict
}

function card(label, value, sub, level) {
  return el('div', `s-card lv-${level}`,
    `<div class="s-val">${value}</div><div class="s-lab">${label}</div><div class="s-sub">${sub}</div>`);
}

function bandRow(r) {
  const st = STATUS[r.status];
  const watched = settings.watch.includes(r.band);
  const row = el('div', `band-row ${st.cls}`);
  const pct = Math.min(100, r.score);
  row.innerHTML =
    `<div class="b-id">${r.band}<small>${r.freq}</small></div>
     <div class="b-meter"><span style="width:${pct}%"></span></div>
     <div class="b-stat">${st.label}${r.note ? ` · ${r.note}` : ''}</div>
     <button class="b-watch ${watched ? 'on' : ''}" title="通知ウォッチ">${watched ? '★' : '☆'}</button>`;
  row.querySelector('.b-watch').addEventListener('click', () => toggleWatch(r.band));
  return row;
}

function toggleWatch(band) {
  const i = settings.watch.indexOf(band);
  if (i >= 0) settings.watch.splice(i, 1); else settings.watch.push(band);
  saveSettings(settings);
  notify.resetBaseline();
  renderDashboard();
  syncWatchChecks();
}

// ---------- path-to-target (does <band> reach a given location?) ----------
function wireTarget() {
  const presets = $('#tgt-presets');
  presets.replaceChildren(...TARGETS.map(t => {
    const b = el('button', 'chip', t.label);
    b.addEventListener('click', () => { $('#tgt-in').value = t.grid; computeTarget(t.grid, t.label); });
    return b;
  }));
  $('#btn-tgt').addEventListener('click', () => computeTarget($('#tgt-in').value));
  $('#tgt-in').addEventListener('keydown', e => { if (e.key === 'Enter') computeTarget($('#tgt-in').value); });
  renderTarget(null);
}

// Accept a Maidenhead grid, or "lat,lon" decimal degrees.
function parseTarget(s) {
  s = (s || '').trim();
  const ll = gridToLatLon(s);
  if (ll) return ll;
  const m = s.match(/^\s*(-?\d+(?:\.\d+)?)\s*,\s*(-?\d+(?:\.\d+)?)\s*$/);
  if (m) {
    const lat = +m[1], lon = +m[2];
    if (Math.abs(lat) <= 90 && Math.abs(lon) <= 180) return { lat, lon };
  }
  return null;
}

function computeTarget(input, label) {
  const tgt = parseTarget(input);
  if (!tgt) { lastTarget = null; renderTarget(null, null, true); return; }
  const ev = evaluatePath({
    qth: { lat: settings.lat, lon: settings.lon },
    target: tgt,
    sfi: state.solar ? state.solar.sfi : null,
    stationsFresh: state.stationsFresh
  });
  lastTarget = { input, label };
  renderTarget(ev, label || latLonToGrid(tgt.lat, tgt.lon));
}

function renderTarget(ev, label, invalid) {
  const r = $('#tgt-result');
  if (!ev) {
    r.innerHTML = invalid
      ? `<p class="muted small">グリッド (例 <b>JN18</b>) か「<b>緯度,経度</b>」(例 48.8,2.3) を入力してください。</p>`
      : `<p class="muted small">相手のグリッド/座標を入れると、経路距離・ホップ数・入射角から各バンドの開閉を判定します。</p>`;
    return;
  }
  const f2 = ev.f2;
  const src = ev.estimated ? '推定' : '実測';
  const esLine = ev.es
    ? ` · <span class="tgt-es">Es-MUF ${ev.es.muf}（foEs ${ev.es.foEs}, ${ev.es.station} ${ev.es.ageMin}分前）</span>`
    : '';
  const head =
    `<div class="tgt-head"><b>${escapeHtml(label || '')}</b>
       <span>${ev.distanceKm.toLocaleString()} km · ${f2.hops}ホップ · 打上げ角 ${f2.elevDeg.toFixed(0)}° · 入射角 ${f2.incDeg.toFixed(0)}°</span></div>
     <div class="tgt-sub">中点MUF(3000) ${ev.muf3000} → <b>パスMUF ${ev.pathMuf} MHz</b>
       <span class="muted">(${src}・h′${ev.hPrime}km)</span>${esLine}</div>`;
  const chips = ev.bands.map(b => {
    const v = b.esOpen ? 'Es可' : b.label;
    const cls = b.esOpen ? 'tb-es' : 'tb-' + b.status;
    return `<div class="tgt-band ${cls}"><span class="tb-id">${b.band}</span><span class="tb-v">${v}</span></div>`;
  }).join('');
  r.innerHTML = head + `<div class="tgt-bands">${chips}</div>`;
}

// ---------- map ----------
function setMufMap() { $('#muf-img').src = mufMapUrl(); }

// Explicit success/failure indicator for the (proxy-based, best-effort)
// ionosonde fetch, so the empty-map case is never ambiguous.
function renderStationStatus() {
  const el = $('#station-status');
  if (!el) return;
  const s = state.stationStatus;
  if (!s) { el.className = 'map-status load'; el.textContent = '観測点データ取得中…'; return; }
  if (!s.ok) {
    el.className = 'map-status err';
    el.textContent = `⚠️ 観測点データ取得失敗（プロキシ応答なし） · ${fmtTime(s.time)} — 推定MUFで表示中`;
    return;
  }
  const fresh = state.stationsFresh.length;
  el.className = 'map-status ok';
  el.textContent = fresh
    ? `✅ 観測点 ${s.count}点 取得（新しい: ${fresh}点） · ${fmtTime(s.time)}`
    : `✅ 取得成功（${s.count}点）だが新しい観測点なし — ドット非表示 · ${fmtTime(s.time)}`;
}

function ensureMap() {
  if (mapReady) { mapview.resize(); return; }
  const m = mapview.initMap($('#leaflet'), settings.lat, settings.lon);
  if (m) {
    mapReady = true;
    mapview.setQTH(settings.lat, settings.lon, settings.call);
    mapview.updateStations(state.stationsFresh);
    mapview.refreshTerminator();
  }
  renderStationStatus();
}

// ---------- DX ----------
function renderDX(res) {
  const box = $('#dx-list');
  if (res.error) {
    box.replaceChildren(el('div', 'dx-empty',
      `<p>DXスポットを取得できませんでした。</p>
       <p class="muted">DX Summit / プロキシが応答していません。後でもう一度お試しください。</p>
       <a class="btn" href="https://www.dxheat.com/dxc/" target="_blank" rel="noopener">DXHeat を開く ↗</a>`));
    $('#dx-meta').textContent = '';
    return;
  }
  $('#dx-meta').textContent = `${res.spots.length} spots · ${res.source}`;
  box.replaceChildren(...res.spots.map(sp => {
    const cls = sp.band ? `sp-${sp.band}` : '';
    return el('div', `dx-row ${cls}`,
      `<div class="dx-call">${sp.dx}</div>
       <div class="dx-freq">${(sp.freq / 1000).toFixed(1)}<small>${sp.band || ''}</small></div>
       <div class="dx-info">${escapeHtml(sp.comment || '')}<span class="dx-de">de ${sp.spotter || '?'} · ${shortTime(sp.time)}</span></div>`);
  }));
}

// ---------- settings ----------
function buildSettingsForm() {
  $('#set-call').value = settings.call;
  $('#set-grid').value = settings.grid || latLonToGrid(settings.lat, settings.lon);
  $('#set-lat').value = settings.lat;
  $('#set-lon').value = settings.lon;
  $('#set-refresh').value = settings.refreshMin;

  const watchBox = $('#watch-boxes');
  watchBox.replaceChildren(...BANDS.map(b => {
    const id = 'w-' + b.id;
    const lab = el('label', 'chk');
    lab.innerHTML = `<input type="checkbox" id="${id}" ${settings.watch.includes(b.id) ? 'checked' : ''}><span>${b.id}</span>`;
    lab.querySelector('input').addEventListener('change', e => {
      const i = settings.watch.indexOf(b.id);
      if (e.target.checked && i < 0) settings.watch.push(b.id);
      if (!e.target.checked && i >= 0) settings.watch.splice(i, 1);
      saveSettings(settings); notify.resetBaseline(); renderDashboard();
    });
    return lab;
  }));

  $('#set-grid').addEventListener('change', e => {
    const ll = gridToLatLon(e.target.value);
    if (ll) { $('#set-lat').value = ll.lat.toFixed(2); $('#set-lon').value = ll.lon.toFixed(2); }
  });
  $('#set-lat').addEventListener('change', syncGridFromLatLon);
  $('#set-lon').addEventListener('change', syncGridFromLatLon);

  $('#btn-geo').addEventListener('click', useGeolocation);
  $('#btn-save').addEventListener('click', applySettings);
  $('#btn-notify').addEventListener('click', enableNotify);
  reflectNotifyBtn();
}

function syncGridFromLatLon() {
  const lat = parseFloat($('#set-lat').value), lon = parseFloat($('#set-lon').value);
  if (Number.isFinite(lat) && Number.isFinite(lon)) $('#set-grid').value = latLonToGrid(lat, lon);
}

function applySettings() {
  settings.call = $('#set-call').value.trim().toUpperCase() || settings.call;
  settings.grid = $('#set-grid').value.trim().toUpperCase();
  settings.lat = parseFloat($('#set-lat').value);
  settings.lon = parseFloat($('#set-lon').value);
  settings.refreshMin = Math.max(2, parseInt($('#set-refresh').value, 10) || 10);
  saveSettings(settings);
  notify.toast('設定を保存しました');
  if (mapReady) mapview.setQTH(settings.lat, settings.lon, settings.call);
  scheduleRefresh();
  refreshAll();
  switchTab('dash');
}

function useGeolocation() {
  if (!navigator.geolocation) return notify.toast('位置情報が使えません');
  navigator.geolocation.getCurrentPosition(p => {
    $('#set-lat').value = p.coords.latitude.toFixed(2);
    $('#set-lon').value = p.coords.longitude.toFixed(2);
    syncGridFromLatLon();
    notify.toast('現在地を取得しました');
  }, () => notify.toast('位置情報を取得できませんでした'));
}

async function enableNotify() {
  const res = await notify.requestPermission();
  if (res === 'granted') { settings.notify = true; saveSettings(settings); notify.toast('通知を有効化しました'); }
  else if (res === 'unsupported') notify.toast('この環境は通知に未対応です');
  else notify.toast('通知が許可されませんでした');
  reflectNotifyBtn();
}

function reflectNotifyBtn() {
  const b = $('#btn-notify');
  if (!notify.supported()) { b.textContent = '通知: 非対応'; b.disabled = true; return; }
  const granted = Notification.permission === 'granted' && settings.notify;
  b.textContent = granted ? '通知: 有効 ✓' : '通知を有効化';
  b.classList.toggle('on', granted);
}

function syncWatchChecks() {
  BANDS.forEach(b => { const c = $('#w-' + b.id); if (c) c.checked = settings.watch.includes(b.id); });
}

// ---------- ui plumbing ----------
function wireTabs() {
  document.querySelectorAll('.tabbar button').forEach(btn =>
    btn.addEventListener('click', () => switchTab(btn.dataset.tab)));
}
function switchTab(tab) {
  document.querySelectorAll('.view').forEach(v => v.classList.toggle('active', v.id === 'view-' + tab));
  document.querySelectorAll('.tabbar button').forEach(b => b.classList.toggle('active', b.dataset.tab === tab));
  if (tab === 'map') ensureMap();
}
function wireRefresh() {
  $('#btn-refresh').addEventListener('click', () => { refreshAll(); refreshDX(); });
  $('#btn-dx-refresh')?.addEventListener('click', refreshDX);
}
function setStatus(t) { $('#status').textContent = t; }

// ---------- helpers ----------
function fmtTime(d) { return d.toLocaleTimeString('ja-JP', { hour: '2-digit', minute: '2-digit' }); }
function shortTime(t) {
  if (!t) return '';
  const d = new Date(t);
  return Number.isNaN(d.getTime()) ? String(t).slice(11, 16) : fmtTime(d);
}
function escapeHtml(s) { return s.replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c])); }

window.condxSwitchTab = switchTab;   // used by map "open MUF" link
boot();
