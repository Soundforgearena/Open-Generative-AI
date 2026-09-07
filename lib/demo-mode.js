export function isDemoModeEnabled(env = process.env) {
  return env.NODE_ENV !== 'production' && env.NEXT_PUBLIC_DEMO_MODE === 'true';
}

// Next.js only inlines statically written `process.env.X` references into the
// browser bundle. Reading them through a destructured object left
// demoModeEnabled false on the client while the server rendered it true, which
// produced a hydration mismatch and made demo mode behave inconsistently.
export const demoModeEnabled = isDemoModeEnabled({
  NODE_ENV: process.env.NODE_ENV,
  NEXT_PUBLIC_DEMO_MODE: process.env.NEXT_PUBLIC_DEMO_MODE,
});
