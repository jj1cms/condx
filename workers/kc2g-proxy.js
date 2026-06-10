// CondX — minimal CORS proxy for KC2G ionosonde data (Cloudflare Worker).
//
// prop.kc2g.com/api/stations.json serves no Access-Control-Allow-Origin header,
// so the browser cannot read it directly. This Worker fetches that ONE upstream
// server-side and re-serves it with permissive CORS + a short edge cache.
// It is deliberately NOT an open proxy: the upstream URL is hard-coded.
//
// Deploy: see condx/README.md ("Cloudflare Worker でプロキシ").

const UPSTREAM = 'https://prop.kc2g.com/api/stations.json';
const CACHE_SECONDS = 120;

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, OPTIONS',
  'Access-Control-Max-Age': '86400',
};

export default {
  async fetch(request) {
    if (request.method === 'OPTIONS') {
      return new Response(null, { status: 204, headers: CORS });
    }
    if (request.method !== 'GET') {
      return new Response('Method Not Allowed', { status: 405, headers: CORS });
    }

    try {
      const upstream = await fetch(UPSTREAM, {
        cf: { cacheTtl: CACHE_SECONDS, cacheEverything: true },
        headers: { 'Accept': 'application/json' },
      });
      const body = await upstream.text();
      return new Response(body, {
        status: upstream.status,
        headers: {
          ...CORS,
          'Content-Type': 'application/json; charset=utf-8',
          'Cache-Control': `public, max-age=${CACHE_SECONDS}`,
        },
      });
    } catch (err) {
      return new Response(JSON.stringify({ error: 'upstream-fetch-failed' }), {
        status: 502,
        headers: { ...CORS, 'Content-Type': 'application/json; charset=utf-8' },
      });
    }
  },
};
