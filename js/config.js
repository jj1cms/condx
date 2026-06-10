// CondX — configuration, data sources, band plan
export const APP = { name: 'CondX', version: '1.0.0' };

// All endpoints below were verified to send `Access-Control-Allow-Origin: *`
// (works directly from a static GitHub Pages origin), except DX spots which is
// best-effort and routed through a fallback CORS proxy when needed.
export const DATA = {
  kIndex:     'https://services.swpc.noaa.gov/products/noaa-planetary-k-index.json',
  flux:       'https://services.swpc.noaa.gov/products/summary/10cm-flux.json',
  solarCycle: 'https://services.swpc.noaa.gov/json/solar-cycle/observed-solar-cycle-indices.json',
  kc2gStations: 'https://prop.kc2g.com/api/stations.json',
  kc2gMufMap:   'https://prop.kc2g.com/renders/current/mufd-normal-now.svg',
  // DX spots — third-party uptime varies. Tried direct first, then via proxy.
  dxSummit:   'https://www.dxsummit.fi/api/v1/spots/',
  corsProxy:  'https://api.allorigins.win/raw?url='   // prepend + encodeURIComponent(url)
};

// Amateur HF bands + 6m, with a representative frequency (MHz) used for openness.
export const BANDS = [
  { id: '160m', freq: 1.83  },
  { id: '80m',  freq: 3.55  },
  { id: '40m',  freq: 7.05  },
  { id: '30m',  freq: 10.12 },
  { id: '20m',  freq: 14.10 },
  { id: '17m',  freq: 18.10 },
  { id: '15m',  freq: 21.10 },
  { id: '12m',  freq: 24.93 },
  { id: '10m',  freq: 28.40 },
  { id: '6m',   freq: 50.10 }
];

export const DEFAULT_SETTINGS = {
  call: 'JJ1CMS',
  lat: 35.68, lon: 139.76, grid: 'PM95uq',  // Tokyo default
  watch: ['6m', '10m'],
  refreshMin: 10,
  notify: false
};
