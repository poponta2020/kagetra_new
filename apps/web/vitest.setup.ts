// Force DATABASE_URL to the test DB so that @/lib/db (top-level Pool) connects
// to postgres-test container. Tests are destructive (TRUNCATE) so this must
// never point at a dev/prod DB.
process.env.DATABASE_URL =
  process.env.TEST_DATABASE_URL ??
  'postgresql://kagetra:kagetra_dev@localhost:5434/kagetra_test'
