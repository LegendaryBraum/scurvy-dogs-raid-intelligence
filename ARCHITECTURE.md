# Scurvy Dogs V2 architecture

The MVP is split into four product layers so a new raid tier changes configuration, not the analysis engine.

1. **Warcraft Logs adapter** (`lib/warcraft-logs.ts`) validates one or many report URLs and uses the server-side Warcraft Logs OAuth client flow when credentials are present.
2. **Normalized raid store** (`db/schema.ts`) keeps the hierarchy `Season → Raid Night → Report → Boss → Pull → Player`, plus relevant matched events and private share tokens.
3. **Configuration and scoring** (`lib/scoring.ts`, `mechanic_rules`) applies boss rules by Spell ID, event type, severity, role, difficulty, and optional conditions. Mechanics, performance, attendance, and preparation remain independent outputs.
4. **Presentation** (`app/components/RaidApp.tsx`) provides a full officer comparison, a ten-second player dashboard, an encounter rule editor, and player-only share routes.

## MVP import behavior

With `WCL_CLIENT_ID` and `WCL_CLIENT_SECRET` connected, public report metadata, fights, actors, and events matching configured Spell IDs come from Warcraft Logs. Without credentials, valid URLs run through a clearly marked demo adapter so URL parsing, normalization, D1 persistence, configuration, scoring surfaces, and private sharing can be tested end to end.

Private Warcraft Logs reports require a later user-authorization flow. The MVP intentionally supports public reports first and keeps credentials server-side.
