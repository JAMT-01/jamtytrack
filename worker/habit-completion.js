/** The 10 km movement habit grants streak credit from 8 km without claiming
 * that the full goal was reached. Other habits retain their existing rules. */
export function streakMinimumFor(habit) {
  return habit.unit === 'km' && Number(habit.targetValue) === 10 ? 8 : null;
}

export function habitCompletion(habit, value) {
  const minimum = streakMinimumFor(habit);
  // A legacy bare check-in is an explicit completion, without a measured value.
  if (minimum === null || value === null) return 'full';
  const distance = Number(value);
  if (!Number.isFinite(distance) || distance < minimum) return 'progress';
  return distance < Number(habit.targetValue) ? 'near' : 'full';
}

export function summarizeHabitEntries(habit, entries, today) {
  const byDate = new Map();
  for (const entry of entries) {
    const date = entry.doneDate;
    if (!/^\d{4}-\d{2}-\d{2}$/.test(date) || date < habit.startedOn || date > today) continue;
    const parsed = new Date(date + 'T12:00:00Z');
    if (!Number.isFinite(parsed.getTime()) || parsed.toISOString().slice(0, 10) !== date) continue;
    byDate.set(date, {date, value: entry.value === null ? null : Number(entry.value),
      completion: habitCompletion(habit, entry.value)});
  }
  const all = [...byDate.values()].sort((a, b) => b.date.localeCompare(a.date));
  const completedDates = all.filter(entry => entry.completion !== 'progress').map(entry => entry.date);
  const cutoff = new Date(today + 'T12:00:00Z');
  cutoff.setUTCDate(cutoff.getUTCDate() - 70);
  const earliest = cutoff.toISOString().slice(0, 10);
  const current = byDate.get(today);
  return {
    completedDates,
    streakMinimum: streakMinimumFor(habit),
    doneToday: !!current && current.completion !== 'progress',
    todayHasEntry: !!current,
    todayCompletion: current?.completion || 'none',
    todayValue: current?.value ?? null,
    history: completedDates.filter(date => date > earliest),
    historyEntries: all.filter(entry => entry.date > earliest),
    totalDone: completedDates.length,
    totalValue: all.reduce((sum, entry) => sum + (Number.isFinite(entry.value) && entry.value > 0 ? entry.value : 0), 0),
  };
}
