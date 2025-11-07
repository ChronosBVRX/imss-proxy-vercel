export const config = { runtime: 'edge' };

const ORIGIN = 'https://rh.imss.gob.mx';
const BASE   = '/TarjetonDigital';

const HOP = ['connection','keep-alive','proxy-authenticate','proxy-authorization','te','trailer','transfer-encoding','upgrade'];

export default async function handler(req: Request) {
  try {
    const inUrl = new URL(req.url);
    // Mapea /api/ -> /TarjetonDigital/
    const path = inUrl.pathname.replace(/^\/api/, '') || '/';
    const withBase = (BASE + (path === '/' ? '/' : path)).replace(/\/+$/,'/') + inUrl.search;
    const target = new URL(withBase, ORIGIN);

    // Copia/limpia headers
    const inHeaders = new Headers(req.headers);
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

    const init: RequestInit = {
      method: req.method,
      headers: inHeaders,
      redirect: 'follow',
      body: (req.method === 'GET' || req.method === 'HEAD') ? undefined : await req.arrayBuffer()
    };

    const upstream = await fetch(target.toString(), init);

    // Ajusta headers de salida para permitir iframe
    const out = new Headers(upstream.headers);
    ['content-security-policy','x-frame-options','frame-ancestors','report-to','nel','x-xss-protection'].forEach(h => out.delete(h));
    out.set('Cache-Control', 'no-store');
    out.set('Access-Control-Allow-Origin', '*');

    // Reescritura básica de Set-Cookie (para que el navegador acepte cookies en tu dominio de Vercel)
    const setCookie = upstream.headers.get('set-cookie');
    if (setCookie) {
      const host = new URL(req.url).hostname;
      out.set('set-cookie', setCookie.replace(/; *Domain=[^;]+/gi, `; Domain=${host}`));
    }

    const buf = await upstream.arrayBuffer();
    return new Response(buf, { status: upstream.status, headers: out });
  } catch (e:any) {
    return new Response(`Proxy error: ${e?.message || e}`, { status: 502 });
  }
}
