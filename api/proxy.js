// api/proxy.js — Vercel Serverless (Node 18)
// Forzamos runtime Node y regiones alternativas.
export const config = {
  runtime: 'nodejs18.x',
  regions: ['sfo1','iad1','cle1'] // prueba otras si hace falta
};

const ORIGIN = 'https://rh.imss.gob.mx';
const BASE   = '/TarjetonDigital';

const HOP = ['connection','keep-alive','proxy-authenticate','proxy-authorization','te','trailer','transfer-encoding','upgrade'];

function cleanInboundHeaders(req) {
  const inHeaders = new Headers();
  for (const [k,v] of Object.entries(req.headers || {})) inHeaders.set(k, String(v));
  HOP.forEach(h => inHeaders.delete(h));
  inHeaders.set('Host', 'rh.imss.gob.mx');
  inHeaders.set('Origin', ORIGIN);
  inHeaders.set('Referer', ORIGIN + BASE + '/');
  inHeaders.set('User-Agent', 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0 Safari/537.36');
  inHeaders.set('Accept', 'text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,*/*;q=0.8');
  inHeaders.set('Accept-Language', 'es-MX,es;q=0.9');
  inHeaders.set('Sec-Fetch-Site', 'same-origin');
  inHeaders.set('Sec-Fetch-Mode', 'navigate');
  inHeaders.set('Sec-Fetch-Dest', 'document');
  return inHeaders;
}

function sanitizeOutboundHeaders(up) {
  const out = new Headers(up.headers);
  ['content-security-policy','x-frame-options','frame-ancestors','report-to','nel','x-xss-protection'].forEach(h => out.delete(h));
  out.set('Cache-Control', 'no-store');
  out.set('Access-Control-Allow-Origin', '*');
  return out;
}

export default async function handler(req, res) {
  try {
    const inUrl = new URL(req.url, `https://${req.headers.host}`);
    const rel   = inUrl.pathname.replace(/^\/api\/proxy\/?/, '/') || '/';
    const withBase = (BASE + (rel === '/' ? '/' : rel)).replace(/\/+$/,'/') + inUrl.search;
    const target = new URL(withBase, ORIGIN);

    const method = req.method || 'GET';
    const headers = cleanInboundHeaders(req);

    let body;
    if (method !== 'GET' && method !== 'HEAD') {
      body = await new Promise((resolve, reject) => {
        const chunks = [];
        req.on('data', (c) => chunks.push(c));
        req.on('end', () => resolve(Buffer.concat(chunks)));
        req.on('error', reject);
      });
    }

    // Hacemos fetch desde Node (diferente egress que Edge)
    const upstream = await fetch(target, {
      method,
      headers,
      body,
      redirect: 'follow',
      // timeouts modestos para evitar sockets colgados
      signal: AbortSignal.timeout(25000)
    });

    const outHeaders = sanitizeOutboundHeaders(upstream);
    // Re-map de Set-Cookie Domain -> dominio de Vercel (si procede)
    const setCookie = upstream.headers.get('set-cookie');
    if (setCookie) {
      const host = req.headers.host;
      outHeaders.set('set-cookie', setCookie.replace(/; *Domain=[^;]+/gi, `; Domain=${host}`));
    }

    // Leemos buffer y respondemos
    const buf = Buffer.from(await upstream.arrayBuffer());
    res.status(upstream.status);
    for (const [k,v] of outHeaders.entries()) res.setHeader(k, v);
    res.end(buf);

  } catch (e) {
    res.status(502).send(`Proxy error: ${e?.message || e}`);
  }
}
