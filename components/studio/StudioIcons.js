const base = { width: 16, height: 16, viewBox: '0 0 24 24', fill: 'none', stroke: 'currentColor', strokeWidth: 1.8, strokeLinecap: 'round', strokeLinejoin: 'round', 'aria-hidden': true };

export const Icon = {
  Play: (p) => <svg {...base} {...p}><path d="M8 5.5v13l10.5-6.5z" fill="currentColor" stroke="none" /></svg>,
  Pause: (p) => <svg {...base} {...p}><path d="M8 5h3v14H8zM13 5h3v14h-3z" fill="currentColor" stroke="none" /></svg>,
  Prev: (p) => <svg {...base} {...p}><path d="M6 5v14M18 6l-9 6 9 6z" fill="currentColor" /></svg>,
  Next: (p) => <svg {...base} {...p}><path d="M18 5v14M6 6l9 6-9 6z" fill="currentColor" /></svg>,
  ChevronLeft: (p) => <svg {...base} {...p}><path d="M15 6l-6 6 6 6" /></svg>,
  ChevronRight: (p) => <svg {...base} {...p}><path d="M9 6l6 6-6 6" /></svg>,
  ChevronDown: (p) => <svg {...base} {...p}><path d="M6 9l6 6 6-6" /></svg>,
  ChevronUp: (p) => <svg {...base} {...p}><path d="M6 15l6-6 6 6" /></svg>,
  Spark: (p) => <svg {...base} {...p}><path d="M12 3l1.8 5.2L19 10l-5.2 1.8L12 17l-1.8-5.2L5 10l5.2-1.8z" fill="currentColor" stroke="none" /><path d="M19 3v4M17 5h4" /></svg>,
  Check: (p) => <svg {...base} {...p}><path d="M5 12.5l4.5 4.5L19 7.5" /></svg>,
  CheckCircle: (p) => <svg {...base} {...p}><circle cx="12" cy="12" r="9" /><path d="M8 12.5l2.6 2.6L16 9.5" /></svg>,
  Coin: (p) => <svg {...base} {...p}><circle cx="12" cy="12" r="9" fill="currentColor" stroke="none" /><circle cx="12" cy="12" r="5.5" stroke="#6b4a10" /></svg>,
  Eye: (p) => <svg {...base} {...p}><path d="M2 12s3.6-7 10-7 10 7 10 7-3.6 7-10 7S2 12 2 12z" /><circle cx="12" cy="12" r="3" /></svg>,
  Camera: (p) => <svg {...base} {...p}><path d="M4 7h3l2-2.5h6L17 7h3v12H4z" /><circle cx="12" cy="13" r="3.5" /></svg>,
  Link: (p) => <svg {...base} {...p}><path d="M10 14a4.5 4.5 0 006.4 0l3-3a4.5 4.5 0 00-6.4-6.4l-1 1" /><path d="M14 10a4.5 4.5 0 00-6.4 0l-3 3a4.5 4.5 0 006.4 6.4l1-1" /></svg>,
  Wave: (p) => <svg {...base} {...p}><path d="M3 12h2M7 8v8M11 5v14M15 9v6M19 7v10M21 12h0" /></svg>,
  Sliders: (p) => <svg {...base} {...p}><path d="M4 7h10M18 7h2M4 17h4M12 17h8" /><circle cx="16" cy="7" r="2" /><circle cx="10" cy="17" r="2" /></svg>,
  Inspector: (p) => <svg {...base} {...p}><path d="M4 6h16M4 12h10M4 18h7" /><circle cx="18" cy="16" r="3" /></svg>,
  Folder: (p) => <svg {...base} {...p}><path d="M3 7h6l2 2h10v10H3z" /></svg>,
  Expand: (p) => <svg {...base} {...p}><path d="M4 9V4h5M20 9V4h-5M4 15v5h5M20 15v5h-5" /></svg>,
  Fit: (p) => <svg {...base} {...p}><rect x="4" y="6" width="16" height="12" rx="1.5" /><path d="M9 10l-2 2 2 2M15 10l2 2-2 2" /></svg>,
  More: (p) => <svg {...base} {...p}><circle cx="5" cy="12" r="1.4" fill="currentColor" /><circle cx="12" cy="12" r="1.4" fill="currentColor" /><circle cx="19" cy="12" r="1.4" fill="currentColor" /></svg>,
  Close: (p) => <svg {...base} {...p}><path d="M6 6l12 12M18 6L6 18" /></svg>,
  Plus: (p) => <svg {...base} {...p}><path d="M12 5v14M5 12h14" /></svg>,
  Ratio: (p) => <svg {...base} {...p}><rect x="3.5" y="6" width="17" height="12" rx="1.5" /></svg>,
  Sort: (p) => <svg {...base} {...p}><path d="M8 5v14M5 16l3 3 3-3M16 19V5M13 8l3-3 3 3" /></svg>,
  List: (p) => <svg {...base} {...p}><path d="M9 6h11M9 12h11M9 18h11M4 6h.01M4 12h.01M4 18h.01" /></svg>,
  Route: (p) => <svg {...base} {...p}><circle cx="6" cy="18" r="2" /><circle cx="18" cy="6" r="2" /><path d="M8 18h6a4 4 0 000-8h-4a4 4 0 010-8h6" /></svg>,
  Warning: (p) => <svg {...base} {...p}><path d="M12 3l10 18H2z" fill="currentColor" stroke="none" /><path d="M12 10v5M12 18h.01" stroke="#1a1206" /></svg>,
  Upload: (p) => <svg {...base} {...p}><path d="M12 16V4M7 9l5-5 5 5M4 20h16" /></svg>,
  Shield: (p) => <svg {...base} {...p}><path d="M12 3l8 3v6c0 5-3.5 8-8 9-4.5-1-8-4-8-9V6z" /><path d="M8.5 12l2.5 2.5 4.5-5" /></svg>,
};

export function Logo() {
  return (
    <svg width="22" height="22" viewBox="0 0 24 24" aria-hidden="true">
      <path d="M4 4l16 8-16 8z" fill="none" stroke="#e7b75f" strokeWidth="1.8" strokeLinejoin="round" />
      <path d="M8 9l6 3-6 3z" fill="#e7b75f" />
    </svg>
  );
}
