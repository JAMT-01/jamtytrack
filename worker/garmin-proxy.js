// Included verbatim in the recovered production bundle before its asset fallback.
// The app's existing password middleware runs before these routes.
async function garminProxy(c) {
  if (!c.env.GARMIN_SYNC || !c.env.GARMIN_SYNC_TOKEN) return c.json({error: 'Garmin sync is not configured yet.'}, 503);
  const incoming = c.req.raw;
  if (incoming.method !== 'GET' && incoming.method !== 'HEAD') {
    const expectedOrigin = new URL(c.env.APP_URL).origin;
    if (incoming.headers.get('origin') !== expectedOrigin) return c.json({error: 'This request must come from Jamtytrack.'}, 403);
  }
  const url = new URL(incoming.url);
  url.hostname = 'garmin.internal';
  url.pathname = url.pathname === '/garmin' ? '/' : url.pathname.replace('/api/garmin/', '/api/');
  const headers = new Headers({Authorization: 'Bearer ' + c.env.GARMIN_SYNC_TOKEN});
  if (incoming.headers.has('content-type')) headers.set('content-type', incoming.headers.get('content-type'));
  try {
    return await c.env.GARMIN_SYNC.fetch(new Request(url, {
      method: incoming.method, headers, redirect: 'manual', duplex: 'half',
      body: incoming.method === 'GET' || incoming.method === 'HEAD' ? undefined : incoming.body,
    }));
  } catch {
    return c.json({error: 'The Garmin connection service is temporarily unavailable.'}, 503);
  }
}
app.get('/garmin', garminProxy);
app.all('/api/garmin/*', garminProxy);
