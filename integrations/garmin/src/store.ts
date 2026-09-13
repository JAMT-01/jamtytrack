import {GarminError, localDate, offsetDay} from './garmin.ts';
import type {Walk} from './garmin.ts';
export type Connection = {
  session_cipher: string | null; pending_cipher: string | null; enabled: number;
  since_day: string | null; last_sync_at: string | null; last_attempt_at: string | null;
  last_error: string | null; error_code: string | null; cooldown_until: number;
  auth_window: number; auth_count: number; lease_owner: string | null; lease_until: number;
};
export async function connection(db: D1Database): Promise<Connection> {
  const row = await db.prepare('SELECT * FROM garmin_connection WHERE id=1').first<Connection>();
  if (!row) throw new GarminError('setup', 'The Garmin integration has not been initialized.', 503);
  return row;
}
export async function config(db: D1Database, habitId: string) {
  const habit = await db.prepare('SELECT id,name,target_value,unit,archived FROM habits WHERE id=?').bind(habitId)
    .first<{id:string;name:string;target_value:number;unit:string;archived:number}>();
  if (!habit || habit.archived || habit.unit !== 'km' || !(habit.target_value > 0)) {
    throw new GarminError('habit_config', 'The linked walking habit must be active with a target in km.', 400);
  }
  const settings = await db.prepare('SELECT timezone FROM settings LIMIT 1').first<{timezone:string}>();
  const timezone = settings?.timezone || 'America/Buenos_Aires';
  return {habit, timezone, today: localDate(new Date(), timezone)};
}
export async function locked<T>(db: D1Database, action: () => Promise<T>): Promise<T> {
  const owner = crypto.randomUUID(); const now = Date.now();
  const claim = await db.prepare('UPDATE garmin_connection SET lease_owner=?,lease_until=? WHERE id=1 AND lease_until<?')
    .bind(owner, now + 600_000, now).run();
  if (!claim.meta.changes) throw new GarminError('busy', 'A Garmin connection or sync is already running. Try again shortly.', 409);
  try {return await action();}
  finally {await db.prepare('UPDATE garmin_connection SET lease_owner=NULL,lease_until=0 WHERE id=1 AND lease_owner=?').bind(owner).run();}
}
export async function allowAttempt(db: D1Database, authentication: boolean) {
  const row = await connection(db); const now = Date.now();
  if (row.cooldown_until > now) throw new GarminError('cooldown', 'Jamtytrack is waiting before contacting Garmin again.', 429, row.cooldown_until);
  if (authentication) {
    const recent = row.auth_window > now - 900_000;
    if (recent && row.auth_count >= 5) throw new GarminError('login_limit', 'Five sign-in attempts have been made. Wait 15 minutes before trying again.', 429);
    await db.prepare('UPDATE garmin_connection SET auth_window=?,auth_count=?,last_attempt_at=? WHERE id=1')
      .bind(recent ? row.auth_window : now, recent ? row.auth_count + 1 : 1, new Date().toISOString()).run();
  }
}
export function syncStart(row: Connection, today: string, timezone: string): string {
  const last = row.last_sync_at ? localDate(new Date(row.last_sync_at),timezone) : today;
  const earliest = [last, offsetDay(today,-7)].sort()[0];
  return [row.since_day || today, earliest].sort()[1];
}
/** Reconcile only auto-owned check-ins. Partial distances stay in the import
 * table because any habit_entries row counts as a completed day in the app.
 * All statements commit together, including replacements and deletions.
 */
export async function reconcile(db: D1Database, habitId: string, walks: Walk[], start: string, end: string, targetKm: number) {
  if (!(targetKm > 0) || !Number.isFinite(targetKm)) throw new Error('Invalid target');
  const statements = [db.prepare('DELETE FROM garmin_activities WHERE day>=? AND day<=?').bind(start,end)];
  for (const walk of walks) statements.push(db.prepare(`INSERT INTO garmin_activities(activity_id,started_at,day,distance_meters)
    VALUES(?,?,?,?) ON CONFLICT(activity_id) DO UPDATE SET started_at=excluded.started_at,day=excluded.day,distance_meters=excluded.distance_meters`)
    .bind(walk.id,walk.startedAt,walk.day,walk.distanceMeters));
  statements.push(db.prepare(`INSERT OR IGNORE INTO garmin_habit_days(habit_id,day)
    SELECT ?,day FROM garmin_activities WHERE day>=? AND day<=? GROUP BY day`).bind(habitId,start,end));
  // An app/Telegram edit or a manually removed auto check-in remains an override.
  statements.push(db.prepare(`UPDATE garmin_habit_days SET suppressed=1 WHERE habit_id=? AND day>=? AND day<=?
    AND entry_id IS NOT NULL AND NOT EXISTS(SELECT 1 FROM habit_entries e WHERE e.id=entry_id AND e.source='garmin')`).bind(habitId,start,end));
  statements.push(db.prepare(`DELETE FROM habit_entries WHERE habit_id=? AND done_date>=? AND done_date<=? AND source='garmin'
    AND id IN (SELECT entry_id FROM garmin_habit_days WHERE habit_id=? AND suppressed=0)
    AND COALESCE((SELECT SUM(distance_meters) FROM garmin_activities WHERE day=habit_entries.done_date),0) < ?`)
    .bind(habitId,start,end,habitId,targetKm*1000));
  statements.push(db.prepare(`INSERT INTO habit_entries(id,habit_id,done_date,value,note,source,logged_at)
    SELECT 'garmin:' || d.habit_id || ':' || d.day,d.habit_id,d.day,SUM(a.distance_meters)/1000.0,
      'Synced recorded walks from Garmin','garmin',?
    FROM garmin_habit_days d JOIN garmin_activities a ON a.day=d.day
    WHERE d.habit_id=? AND d.day>=? AND d.day<=? AND d.suppressed=0 GROUP BY d.day
    HAVING SUM(a.distance_meters)>=?
    ON CONFLICT(habit_id,done_date) DO UPDATE SET value=excluded.value,logged_at=excluded.logged_at
    WHERE habit_entries.source='garmin' AND habit_entries.id=excluded.id`)
    .bind(new Date().toISOString(),habitId,start,end,targetKm*1000));
  statements.push(db.prepare(`UPDATE garmin_habit_days SET entry_id=(SELECT id FROM habit_entries e
    WHERE e.habit_id=garmin_habit_days.habit_id AND e.done_date=day AND e.source='garmin')
    WHERE habit_id=? AND day>=? AND day<=? AND suppressed=0`).bind(habitId,start,end));
  statements.push(db.prepare(`UPDATE garmin_connection SET last_sync_at=?,last_error=NULL,error_code=NULL,cooldown_until=0 WHERE id=1`)
    .bind(new Date().toISOString()));
  await db.batch(statements);
}
