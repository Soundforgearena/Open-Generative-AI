export function isDemoModeEnabled(env = process.env) {
  return env.NODE_ENV !== 'production' && env.NEXT_PUBLIC_DEMO_MODE === 'true';
}

export const demoModeEnabled = isDemoModeEnabled();
