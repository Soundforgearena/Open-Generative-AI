'use client';

export default function ExportSettings({ value, onChange }) {
  return <section className="cinex-shot-plan" aria-labelledby="export-settings-title"><h2 id="export-settings-title">Export settings</h2><label>Target format<select value={value} onChange={(event) => onChange(event.target.value)}><option value="youtube">YouTube 16:9 — 1920x1080</option><option value="vertical">Vertical social 9:16 — 1080x1920</option><option value="square">Square social 1:1 — 1080x1080</option><option value="preview">Preview — adaptive low-resolution draft</option></select></label><p className="cinex-form-optional">No rendered file exists in demo mode. Export becomes available after rendering. Future containers/codecs: MP4/H.264, WebM/VP9.</p><button type="button" className="cinex-auth-secondary" disabled>Export becomes available after rendering.</button></section>;
}
