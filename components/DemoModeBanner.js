import { demoModeEnabled } from '@/lib/demo-mode';

export default function DemoModeBanner() {
  if (!demoModeEnabled) return null;
  return <div className="cinex-demo-banner" role="status">Demo mode — local data only</div>;
}
