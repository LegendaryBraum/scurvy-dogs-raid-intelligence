# Scurvy Dogs Raid Intelligence

An internal raid-analysis MVP built around a simple promise: a player should understand the most important takeaways from a pull in about ten seconds.

## MVP capabilities

- Accepts one or multiple Warcraft Logs report URLs.
- Stores the hierarchy `Season → Raid Night → Report → Boss → Pull → Player` in D1.
- Keeps encounter rules separate from the generic analysis engine.
- Scores Mechanics, DPS/HPS Performance, Attendance, and Preparation independently.
- Gives officers a full-roster comparison without inventing one opaque overall score.
- Gives players a single dashboard with player, boss, and pull selectors updating in place.
- Creates expiring player-only links with anonymous raid-average context and no teammate detail.

## Local setup

```bash
npm install
npm run dev
```

Add Warcraft Logs server credentials to a local `.env` using `.env.example` as the template. Public reports are imported live when credentials are present. Without credentials, valid report URLs use the clearly marked demo adapter so the full persistence and privacy flow remains testable.

## Verification

```bash
npm run build
node --test tests/rendered-html.test.mjs
npm run db:generate
```

See `ARCHITECTURE.md` for the system boundaries and first-slice tradeoffs.
