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

const $ = (s, r = document) => r.querySelector(s);
const el = (t, c, html) => { const e = document.createElement(t); if (c) e.className = c; if (html != null) e.innerHTML = html; return e; };

let settings = loadSettings();
let state = { solar: null, stations: [], stationsFresh: [], nearest: null, results: [], ctx: null };
let mapReady = false, refreshTimer = null;

// ---------- boot ----------
function boot() {
  $('#app-version').textContent = 'v' + APP.version;
  buildSettingsForm();
  wireTabs();
  wireRefresh();
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
  const [solar, stations] = await Promise.all([
    getSolar().catch(() => null),
    getStations().catch(() => [])
  ]);
  state.solar = solar;
  state.stations = stations;
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
  $('#ctx-line').innerHTML = n
    ? `実測MUF <b>${n.name}</b>: <b>${n.mufd.toFixed(1)} MHz</b>` +
      (n.fof2 ? ` · foF2 ${n.fof2.toFixed(1)}` : '') +
      ` · ${n.distanceKm} km · ${n.ageMin ?? '?'}分前 · ${dn}`
    : `推定MUF <b>${mufStr} MHz</b>（太陽指数＋太陽高度ベース） · ${dn}`;

  // band grid
  const grid = $('#band-grid');
  grid.replaceChildren(...state.results.map(bandRow));

  // open summary
  const open = state.results.filter(r => r.open && r.score >= 62).map(r => r.band);
  $('#open-summary').innerHTML = open.length
    ? `🟢 開けている: <b>${open.join(', ')}</b>`
    : `今は強い開放なし — low bands / 夜間を確認`;
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

// ---------- map ----------
function setMufMap() { $('#muf-img').src = mufMapUrl(); }

function ensureMap() {
  if (mapReady) { mapview.resize(); return; }
  const m = mapview.initMap($('#leaflet'), settings.lat, settings.lon);
  if (m) {
    mapReady = true;
    mapview.setQTH(settings.lat, settings.lon, settings.call);
    mapview.updateStations(state.stationsFresh);
    mapview.refreshTerminator();
  }
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
