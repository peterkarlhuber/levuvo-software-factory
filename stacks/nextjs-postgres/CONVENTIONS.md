# Stack conventions: nextjs-postgres

Conventions for agents working on a project built with this stack profile (`profile.json`). They are advice within the approved spec, architecture and factory policies (R1, R9). Commands, services, gates and the test interface are fixed in `profile.json`; agents do not change them.

## Structure
- Pages and layouts in `src/app/`, route handlers in `src/app/api/<name>/route.ts`.
- Components in `src/components/`, logic without UI in `src/lib/`.
- Database access only in `src/lib/db/`; schema changes only as migration files in `migrations/`; `npm run seed` applies all pending migrations first (also used by `dev`), the build never needs a database.

## UI
- Styling with Tailwind; design tokens from `docs/design-tokens.tokens.json` as CSS variables (A5).
- Every screen has exactly the route the spec names (`ui_reference.screens[].route`); visible labels as the spec names them.
- Use accessible roles and labels so tests can address elements by role and label.

## Backend
- Validate every input of a route handler or server action (Zod).
- Check authentication and authorization in every protected handler, never only in the client.
- Secrets and connection strings only from environment variables (`DATABASE_URL`).

## Tests
- Visible tests: Vitest, next to the source (`*.test.ts`), test name contains the AC ID (GB3.1).
- Hidden tests: Playwright, written by the scenario agent, run by the factory against the built app with a fresh database.
- `npm run seed` applies the migrations and creates exactly the test user from `TEST_USER` / `TEST_PASSWORD` in an empty database and nothing else. It must keep working after every feature.
