// Included in the recovered main bundle; list all for lifetime XP, then apply
// the existing archive filter to the cards returned to the caller.
app.get('/api/habits', async (c) => {
  const settings = await getSettings(c.env);
  const today = dateInTimeZone(new Date(), String(settings.timezone));
  const all = await listHabits(c.env, true);
  return c.json({
    habits: c.req.query('archived') === '1' ? all : all.filter(habit => !habit.archived),
    today,
    rewards: journeyRewards(all, today),
  });
});
