// State transition applied when the user retries a failed Studio project load.
export function retryLoad(attempt) {
  return { loadState: 'loading', loadError: '', loadAttempt: attempt + 1 };
}
