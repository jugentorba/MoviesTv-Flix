import worker from '../../worker/index.js';

function supportedApiPath(pathname) {
  return pathname === '/api/runtime-config'
    || pathname === '/api/app-update'
    || pathname.startsWith('/api/app-update/')
    || pathname === '/api/cinemeta'
    || pathname.startsWith('/api/cinemeta/')
    || pathname === '/api/nuvio-catalog'
    || pathname.startsWith('/api/nuvio-catalog/');
}

export async function onRequest(context) {
  const url = new URL(context.request.url);
  if (!supportedApiPath(url.pathname)) {
    return new Response(
      JSON.stringify({ error: 'Not found' }),
      {
        status: 404,
        headers: {
          'content-type': 'application/json; charset=utf-8',
          'cache-control': 'no-store',
          'x-content-type-options': 'nosniff',
        },
      },
    );
  }

  return worker.fetch(context.request, context.env);
}
