// Preserves one idempotency key across retries of the same billable Director request.
// A definitive response invalidates the key; an ambiguous transport failure retains it.
export function createRetryIdempotencyKey() {
  let activeKey = null;

  return {
    begin(retryKey = null) {
      activeKey = retryKey || crypto.randomUUID();
      return activeKey;
    },
    current() {
      return activeKey;
    },
    retryKey() {
      return activeKey;
    },
    complete() {
      activeKey = null;
    },
  };
}
