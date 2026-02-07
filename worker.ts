/**
 * Cloudflare Worker that serves static assets and proxies
 * image requests to the Deadlock API CDN to avoid CORS issues
 * (WebGL textures require CORS-clean images).
 */

const CDN_ORIGIN = 'https://assets-bucket.deadlock-api.com';

export default {
  async fetch(request: Request, env: any): Promise<Response> {
    const url = new URL(request.url);

    // Proxy /_img-proxy/* to the Deadlock CDN with CORS headers
    if (url.pathname.startsWith('/_img-proxy/')) {
      const cdnPath = url.pathname.replace(/^\/_img-proxy/, '');
      const cdnUrl = CDN_ORIGIN + cdnPath;

      const cdnResponse = await fetch(cdnUrl, {
        headers: {
          'Accept': request.headers.get('Accept') || 'image/*',
          'User-Agent': 'DeadlockItemTrainer/1.0',
        },
      });

      if (!cdnResponse.ok) {
        return new Response('Image not found', { status: cdnResponse.status });
      }

      // Return the image with CORS headers so WebGL can use it
      const response = new Response(cdnResponse.body, {
        status: 200,
        headers: {
          'Content-Type': cdnResponse.headers.get('Content-Type') || 'image/png',
          'Cache-Control': 'public, max-age=604800',
          'Access-Control-Allow-Origin': '*',
          'Access-Control-Allow-Methods': 'GET',
        },
      });

      return response;
    }

    // For everything else, let the static assets handler serve from /dist
    return env.ASSETS.fetch(request);
  },
};
