app.post('/api/habits/:id/check', async (c) => {
  const body = await c.req.json().catch(() => ({}));
  if (body.value != null && (
    !['number', 'string'].includes(typeof body.value) || String(body.value).trim() === '' ||
    !Number.isFinite(Number(body.value)) || Number(body.value) < 0
  )) return c.json({error: 'Enter a valid distance of zero or more.'}, 400);
  const result = await checkIn(c.env, c.req.param('id'), {
    date: body.date ? String(body.date) : undefined,
    value: body.value == null ? null : Number(body.value),
    note: body.note ? String(body.note) : '',
    source: 'app',
  });
  return result ? c.json(result.habit) : c.notFound();
});
