/**
 * `server-only` throws on import outside a React Server Component, which is exactly what makes it
 * useful in the app — and exactly what stops Vitest from importing a server module under test.
 * The build still enforces the boundary; this stub only lets the unit tests run.
 */
export {}
