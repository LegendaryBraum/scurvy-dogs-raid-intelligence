# Scurvy Dogs Raid Intelligence

An internal raid-analysis MVP built around a simple promise: a player should understand the most important takeaways from a pull in about ten seconds.

## MVP capabilities

- Accepts one or multiple full-run Warcraft Logs report URLs and previews the raid contents before saving.
- Stores the hierarchy `Season → Raid Night → Report → Boss → Pull → Player` in D1.
- Keeps encounter rules separate from the generic analysis engine.
- Reads any specific Wipefest boss pull, identifies its imported encounter automatically, and opens a human-reviewed calibration wizard with exact Spell IDs, event types, difficulty, role filters, severity bands, and transparent point caps.
- Shows every imported raid boss on one configuration board with separate calibration status, rule counts, saved pulls, and a dedicated rule workspace.
- Lets officers edit, duplicate, pause, and restore encounter rules without deleting their history.
- Scores Mechanics, DPS/HPS Performance, Attendance, and Preparation independently.
- Lets officers pause any score module across player, officer, and private views without deleting stored data.
- Gives officers a full-roster comparison without inventing one opaque overall score.
- Gives players a single dashboard with player, boss, and pull selectors updating in place.
- Creates expiring player-only links with anonymous raid-average context and no teammate detail.

Mechanics scoring starts at 100 for every pull. Only enabled penalty rules subtract points: `points per match × counted matches`, limited by the rule's optional per-pull cap and clamped at 0. Severity is a readable label, while successful interrupts/dispels and raid context are evidence-only. Wipefest percentiles are displayed for comparison and never converted into penalty points.

## Local setup

```bash
npm install
npm run dev
```

Add Warcraft Logs server credentials to a local `.env` using `.env.example` as the template. Public and unlisted reports are read by the server-side importer; the secret is never sent to the browser. Without credentials, the verified Aug 21 snapshot remains available and the live import endpoint returns a clear connection-required message instead of substituting demo data.

## Verification

```bash
npm run build
node --test tests/rendered-html.test.mjs
npm run db:generate
```

See `ARCHITECTURE.md` for the system boundaries and first-slice tradeoffs.
