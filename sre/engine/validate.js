import { execa } from 'execa';

const COMMANDS = [
  ['lint', 'npm', ['run', 'lint']],
  ['tests', 'npm', ['npm', 'test']],
  ['build', 'npm', ['run', 'build']],
];

export async function validateRepair({ incident, previewUrl }) {
  const reports = [];

  for (const [name, command, args] of COMMANDS) {
    const result = await execa(command, args, {
      reject: false,
      timeout: 10 * 60 * 1000,
      env: { ...process.env, CI: 'true', SRE_VALIDATION: 'true' },
    });

    reports.push({
      name,
      command: `${command} ${args.join(' ')}`,
      exitCode: result.exitCode,
      stdout: redact(result.stdout),
      stderr: redact(result.stderr),
    });

    if (result.exitCode !== 0) {
      return { ok: false, stage: name, summary: `${name} failed`, reports };
    }
  }

  const smoke = await runSmokeChecks({ previewUrl, incident });
  reports.push({ name: 'preview-smoke', ...smoke });

  return {
    ok: smoke.ok,
    stage: smoke.ok ? 'complete' : 'preview-smoke',
    summary: smoke.ok ? 'All validation gates passed' : 'Preview smoke checks failed',
    reports,
  };
}

async function runSmokeChecks({ previewUrl, incident }) {
  if (!previewUrl) return { ok: false, reason: 'Preview URL was not provided' };

  const paths = new Set(['/', '/auth', '/pricing', '/health', incident?.route]);
  for (const path of paths) {
    if (!path) continue;
    try {
      const response = await fetch(`${previewUrl}${path}`, {
        signal: AbortSignal.timeout(20_000),
        redirect: 'manual',
      });
      if (response.status >= 500) return { ok: false, reason: `${path} returned ${response.status}` };
    } catch (error) {
      return { ok: false, reason: `${path} failed: ${error.message}` };
    }
  }
  return { ok: true };
}

export function redact(value = '') {
  return String(value)
    .replace(/Bearer\s+[A-Za-z0-9._-]+/gi, 'Bearer [REDACTED]')
    .replace(/\b(sk|pk)_(live|test)_[A-Za-z0-9]+/g, '[STRIPE_KEY_REDACTED]')
    .replace(/(OPENAI_API_KEY|SUPABASE_SERVICE_ROLE_KEY|CRON_SECRET)=\S+/g, '$1=[REDACTED]');
}
