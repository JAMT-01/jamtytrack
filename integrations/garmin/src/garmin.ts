/** Personal Garmin Connect adapter. Protocol reference: python-garminconnect (MIT).
 * Uses ordinary fetch, a single login flow, and never retries a login rejection,
 * CAPTCHA, or rate limit using another identity or transport.
 */
const SSO = 'https://sso.garmin.com';
const API = 'https://connectapi.garmin.com';
const TOKEN = 'https://diauth.garmin.com/di-oauth2-service/oauth/token';
const SERVICE = 'https://mobile.integration.garmin.com/gcm/ios';
const CLIENT = 'GARMIN_CONNECT_MOBILE_ANDROID_DI_2025Q2';
const LOGIN_QUERY = new URLSearchParams({clientId: 'GCM_IOS_DARK', locale: 'en-US', service: SERVICE});
const LOGIN_HEADERS = {
  'User-Agent': 'Mozilla/5.0 (iPhone; CPU iPhone OS 18_7 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Mobile/15E148',
  'Accept': 'application/json', 'Content-Type': 'application/json', 'Origin': SSO,
};
const API_HEADERS = {
  'User-Agent': 'GCM-Android-5.23',
  'X-Garmin-Client-Platform': 'Android', 'X-GCExperience': 'GC5',
  'Accept': 'application/json',
};
export type Session = {accessToken: string; refreshToken: string; clientId: string; expiresAt: number};
export type Pending = {cookies: Record<string, string>; method: string; expiresAt: number};
/** A recorded walk or run. The existing name is retained for import helpers. */
export type Walk = {id: string; startedAt: string; day: string; distanceMeters: number};
const DISTANCE_ACTIVITY_TYPES = new Set([
  'walking', 'running', 'street_running', 'track_running', 'trail_running',
  'treadmill_running', 'indoor_running', 'ultra_run', 'virtual_run', 'obstacle_run',
]);
export class GarminError extends Error {
  constructor(public code: string, message: string, public status = 502, public retryAt?: number) {super(message);}
}
export function object(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : {};
}
async function boundedText(response: Response): Promise<string> {
  if (!response.body) return '';
  const reader = response.body.getReader();
  const decoder = new TextDecoder(); let text = ''; let size = 0;
  while (true) {
    const {done, value} = await reader.read();
    if (done) return text + decoder.decode();
    size += value.length;
    if (size > 2_000_000) {await reader.cancel(); throw new GarminError('response_too_large', 'Garmin returned an unexpectedly large response.');}
    text += decoder.decode(value, {stream: true});
  }
}
export class GarminClient {
  constructor(private send: typeof fetch = fetch) {}
  private async request(url: string, init: RequestInit = {}): Promise<{data: unknown; cookies: Record<string, string>}> {
    let response: Response;
    const send = this.send;
    try {response = await send(url, {...init, redirect: 'manual', signal: AbortSignal.timeout(25_000)});}
    catch {throw new GarminError('network', 'Garmin could not be reached. Try again later.');}
    // Never include upstream bodies, headers, tickets, or URLs in errors/logs.
    if (response.status === 429) {await response.body?.cancel(); throw new GarminError('rate_limited', 'Garmin returned a rate-limit response. Jamtytrack has paused retries for one hour.', 429);}
    if (response.status === 403) {await response.body?.cancel(); throw new GarminError('blocked', 'Garmin rejected this connection from Cloudflare. Automatic sync is not connected.', 502);}
    if (response.status === 401) {await response.body?.cancel(); throw new GarminError('reconnect', 'Garmin needs you to reconnect.', 401);}
    if (!response.ok) {await response.body?.cancel(); throw new GarminError('upstream', `Garmin returned HTTP ${response.status}. Try again later.`);}
    const cookies: Record<string, string> = {};
    for (const cookie of response.headers.getSetCookie()) {
      const first = cookie.split(';')[0]; const equal = first.indexOf('=');
      if (equal > 0) cookies[first.slice(0, equal)] = first.slice(equal + 1);
    }
    let data: unknown;
    try {data = JSON.parse(await boundedText(response));}
    catch (e) {if (e instanceof GarminError) throw e; throw new GarminError('challenge', 'Garmin returned a browser challenge. This connection cannot proceed automatically.');}
    return {data, cookies};
  }
  private tokens(data: unknown, previous?: Session): Session {
    const row = object(data);
    if (typeof row.access_token !== 'string' || !(typeof row.refresh_token === 'string' || previous?.refreshToken)) {
      throw new GarminError('token_exchange', 'Garmin did not issue a renewable session.');
    }
    const seconds = Number(row.expires_in);
    return {accessToken: row.access_token, refreshToken: typeof row.refresh_token === 'string' ? row.refresh_token : previous!.refreshToken,
      clientId: previous?.clientId || CLIENT, expiresAt: Date.now() + (Number.isFinite(seconds) && seconds > 0 ? seconds : 3600) * 1000};
  }
  private async finishLogin(data: unknown, cookies: Record<string, string>): Promise<{session: Session} | {pending: Pending}> {
    const row = object(data); const result = object(row.responseStatus).type;
    if (result === 'MFA_REQUIRED') return {pending: {cookies, method: String(object(row.customerMfaInfo).mfaLastMethodUsed || 'email'), expiresAt: Date.now() + 600_000}};
    if (result === 'INVALID_USERNAME_PASSWORD') throw new GarminError('credentials', 'Garmin did not accept that email or password.', 400);
    if (result === 'CAPTCHA_REQUIRED') throw new GarminError('challenge', 'Garmin requires a browser challenge. Sign-in from this Worker is unavailable.');
    if (String(object(row.error)['status-code']) === '429') throw new GarminError('rate_limited', 'Garmin returned a rate-limit response. Jamtytrack has paused retries for one hour.', 429);
    if (result !== 'SUCCESSFUL' || typeof row.serviceTicketId !== 'string') throw new GarminError('authentication', 'Garmin could not complete sign-in. Check your account or verification code.', 400);
    const exchanged = await this.request(TOKEN, {method: 'POST', headers: {...API_HEADERS,
      'Authorization': 'Basic ' + btoa(CLIENT + ':'), 'Content-Type': 'application/x-www-form-urlencoded'},
      body: new URLSearchParams({client_id: CLIENT, service_ticket: row.serviceTicketId,
        grant_type: API + '/di-oauth2-service/oauth/grant/service_ticket', service_url: SERVICE})});
    return {session: this.tokens(exchanged.data)};
  }
  async login(email: string, password: string) {
    const result = await this.request(SSO + '/mobile/api/login?' + LOGIN_QUERY, {
      method: 'POST', headers: LOGIN_HEADERS, body: JSON.stringify({username: email, password, rememberMe: true, captchaToken: ''}),
    });
    return this.finishLogin(result.data, result.cookies);
  }
  async verify(pending: Pending, code: string) {
    if (pending.expiresAt < Date.now()) throw new GarminError('expired', 'The verification session expired. Sign in again.', 400);
    const result = await this.request(SSO + '/mobile/api/mfa/verifyCode?' + LOGIN_QUERY, {
      method: 'POST', headers: {...LOGIN_HEADERS, Cookie: Object.entries(pending.cookies).map(([k,v]) => k + '=' + v).join('; ')},
      body: JSON.stringify({mfaMethod: pending.method, mfaVerificationCode: code, rememberMyBrowser: true, reconsentList: [], mfaSetup: false}),
    });
    return this.finishLogin(result.data, {...pending.cookies, ...result.cookies});
  }
  async refresh(session: Session): Promise<Session> {
    const result = await this.request(TOKEN, {method: 'POST', headers: {...API_HEADERS,
      Authorization: 'Basic ' + btoa(session.clientId + ':'), 'Content-Type': 'application/x-www-form-urlencoded'},
      body: new URLSearchParams({grant_type: 'refresh_token', client_id: session.clientId, refresh_token: session.refreshToken})});
    return this.tokens(result.data, session);
  }
  async activities(session: Session, startDay: string, endDay: string): Promise<unknown[]> {
    const rows: unknown[] = [];
    // A bounded window and complete pagination prevent truncated data from
    // being mistaken for deleted activities. Fail without changing the diary.
    for (let page = 0; page < 8; page++) {
      const query = new URLSearchParams({startDate: startDay, endDate: endDay, start: String(page * 50), limit: '50'});
      const {data} = await this.request(API + '/activitylist-service/activities/search/activities?' + query,
        {headers: {...API_HEADERS, Authorization: 'Bearer ' + session.accessToken}});
      if (!Array.isArray(data)) throw new GarminError('activities_shape', 'Garmin returned an unexpected activity list. Your diary was not changed.');
      rows.push(...data);
      if (data.length < 50) return rows;
    }
    throw new GarminError('too_many_activities', 'Garmin returned too many activities for this sync window. Your diary was not changed.');
  }
  async probe(): Promise<{reachable: boolean; status: number; error?:string}> {
    let response: Response;
    const send = this.send;
    try {response = await send(SSO + '/mobile/sso/en_US/sign-in?' + LOGIN_QUERY, {redirect: 'manual', signal: AbortSignal.timeout(20_000)});}
    catch (error) {return {reachable: false, status: 0,error:error instanceof Error ? error.name+': '+error.message.slice(0,120) : 'network'};}
    await response.body?.cancel();
    return {reachable: response.status >= 200 && response.status < 400, status: response.status};
  }
}
export function localDate(time: Date, timezone: string): string {
  return new Intl.DateTimeFormat('en-CA', {timeZone: timezone, year: 'numeric', month: '2-digit', day: '2-digit'}).format(time);
}
export function offsetDay(day: string, offset: number): string {
  const time = new Date(day + 'T12:00:00Z'); time.setUTCDate(time.getUTCDate() + offset); return time.toISOString().slice(0,10);
}
export function normalizeWalks(rows: unknown[], timezone: string, startDay: string, endDay: string): Walk[] {
  const unique = new Map<string, Walk>();
  for (const input of rows) {
    const row = object(input);
    if (!DISTANCE_ACTIVITY_TYPES.has(String(object(row.activityType).typeKey))) continue;
    const id = String(row.activityId ?? ''); const meters = Number(row.distance);
    const rawTime = typeof row.startTimeGMT === 'string' ? row.startTimeGMT.replace(' ', 'T') : '';
    const time = new Date(rawTime && !/(Z|[+-]\d\d:\d\d)$/.test(rawTime) ? rawTime + 'Z' : rawTime);
    if (!/^\d+$/.test(id) || !Number.isFinite(meters) || meters < 0 || !Number.isFinite(time.getTime())) {
      throw new GarminError('invalid_walk', 'A Garmin walk or run is missing a valid date or distance. Your diary was not changed.');
    }
    const day = localDate(time, timezone);
    if (day >= startDay && day <= endDay) unique.set(id, {id, startedAt: time.toISOString(), day, distanceMeters: meters});
  }
  return [...unique.values()];
}
