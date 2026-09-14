# Habit momentum

Jamtytrack turns saved habit completions into visible progress on Today and Habits. Existing history and qualifying Garmin imports count automatically. No reward records or database migrations are needed.

## Rules

- Each unique completed habit/date earns 10 XP. Every 100 XP advances a level. Archived habits retain their earned XP; undoing or deleting a completion recalculates the total.
- Streaks become **On fire** at 3 days, **Super streak** at 7, and **Legendary streak** at 30. Additional milestones are 14, 60, 100 and 365 days. Yesterday's streak remains current until today ends, allowing time to complete today's habit.
- The daily ring fills as active habits are completed. Completing all of them earns the Perfect day celebration.
- The weekly quest counts distinct Monday–Sunday dates with at least one completed active habit. Its target is five days, reduced when the earliest active habit starts late in the week.
- The trophy shelf includes historical streak records, lifetime completion milestones and distance milestones for habits measured in km. Ordinary missed days do not remove earned trophies or XP.
- Celebrations follow saved progress, respect reduced motion, and dismiss automatically. A local XP high-water mark suppresses replay; it never awards points.
- For the 10 km movement habit, **8–under 10 km** earns streak credit and the same daily XP, with a pale orange ≈ marker and the actual distance. **10 km or more** is the full orange goal. Shorter manual distances remain visible as progress without completing the habit. Moving from near-goal to full updates the same entry without extra XP.
- Habits includes a distance form for today's total and calendar day details. Recorded Garmin walks and runs use the same 8 km minimum; manual entries and explicit import overrides remain authoritative. Other habit targets retain their existing rules.
- Calories, body weight and meal quantities do not earn XP.

## Inspiration

[Duolingo's streak research](https://blog.duolingo.com/improving-the-streak/) informed clear milestones and progress toward the next milestone. [Duolingo achievement badges](https://blog.duolingo.com/achievement-badges/) informed the trophy shelf. [Apple Fitness rings and awards](https://www.apple.com/watch/close-your-rings/) informed the daily completion ring and celebrations. The implementation uses Jamtytrack's own design and habit data.

## Maintaining the recovered app

The deployed app is the recovered `dist/worker.js` bundle. Do not replace it with a wholesale source-app build: that would discard preserved application features and assets.

- Reward rules live in `worker/habit-rewards.js`, with distance classification in `worker/habit-completion.js`. Read and check-in routes live in `worker/habits-read-route.js` and `worker/habits-check-route.js`. The sync script also compiles the canonical habit reader and Telegram completion functions into the recovered bundle.
- The readable client source is `worker/habits-client.js`. `worker/habits-assets.ts` contains its generated string wrapper.
- Run `node tools/sync-habit-rewards.mjs`, then `node tools/sync-habits-ui.mjs` to update only these sections of the recovered bundle.
- Run `node --test tools/habit-completion.test.mjs tools/habit-rewards.test.mjs tools/habit-telegram.test.mjs tools/login-route.test.mjs tools/garmin-gateway.test.mjs` for distance boundaries and authenticated bundle route regressions. Run the connector's tests and type checks from `integrations/garmin`.
- Deploy the main Worker while retaining its assets, inherited secrets and existing resource bindings. Deploy the Garmin connector for changes to recorded activity types or automatic completion thresholds.

The UI was checked with sample data on desktop and a 390px phone viewport, including the seventh consecutive day, Perfect day, the weekly quest, trophy shelf, and undo/recheck without duplicate XP.
