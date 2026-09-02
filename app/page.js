'use client';

import { useMemo, useState } from 'react';

const scenes = [
  { id: 1, title: 'The Empty Room', type: 'Opening', duration: 8, status: 'Approved', image: 'https://images.unsplash.com/photo-1516280440614-37939bbacd81?auto=format&fit=crop&w=900&q=80' },
  { id: 2, title: 'The Impossible Voice', type: 'Suspense', duration: 10, status: 'Needs review', image: 'https://images.unsplash.com/photo-1598488035139-bdbb2231ce04?auto=format&fit=crop&w=900&q=80' },
  { id: 3, title: 'The Hidden Room', type: 'Discovery', duration: 12, status: 'Draft', image: 'https://images.unsplash.com/photo-1485846234645-a62644f84728?auto=format&fit=crop&w=900&q=80' },
  { id: 4, title: 'Final Transmission', type: 'Climax', duration: 9, status: 'Draft', image: 'https://images.unsplash.com/photo-1519608487953-e999c86e7455?auto=format&fit=crop&w=900&q=80' },
];

const styles = ['Cinematic noir', 'Electric performance', 'Documentary realism', 'Dreamlike surreal'];

export default function Home() {
  const [activeTab, setActiveTab] = useState('Episodes');
  const [studio, setStudio] = useState('Storyboard');
  const [directorOpen, setDirectorOpen] = useState(true);
  const [maintenance, setMaintenance] = useState(false);
  const [discount, setDiscount] = useState(false);
  const [selectedScene, setSelectedScene] = useState(2);
  const [versions, setVersions] = useState({ 2: 2 });
  const [prompt, setPrompt] = useState('Make the scene more tense, keep Maya’s red jacket and the recording studio, then end with the lights cutting out.');
  const [uploadName, setUploadName] = useState('');
  const [toast, setToast] = useState('');

  const scene = scenes.find((item) => item.id === selectedScene);
  const totalDuration = useMemo(() => scenes.reduce((sum, item) => sum + item.duration, 0), []);

  function notify(message) {
    setToast(message);
    window.setTimeout(() => setToast(''), 2600);
  }

  function regenerate() {
    setVersions((current) => ({ ...current, [selectedScene]: (current[selectedScene] || 1) + 1 }));
    notify('New scene take queued for review.');
  }

  return (
    <main className="app-shell">
      <header className="topbar">
        <div className="brand"><span className="brand-mark">C</span><span>CINEXVIDEO</span></div>
        <div className="top-status"><span className="status-dot green" /> SYSTEM LIVE <span className="divider" /> EPISODE 01 / THE LAST FREQUENCY</div>
        <button className="icon-button" onClick={() => notify('Project settings opened')}>•••</button>
      </header>

      <nav className="tabs">
        {['Music Videos', 'Episodes'].map((tab) => <button key={tab} className={activeTab === tab ? 'tab active' : 'tab'} onClick={() => setActiveTab(tab)}>{tab}</button>)}
        <span className="tab-separator" />
        {['Image Studio', 'Cinema Studio', 'Admin Cockpit'].map((tab) => <button key={tab} className={studio === tab ? 'tab active' : 'tab'} onClick={() => setStudio(tab)}>{tab}</button>)}
      </nav>

      <section className="hero-row">
        <div>
          <div className="eyebrow">AI DIRECTOR / {activeTab.toUpperCase()}</div>
          <h1>{activeTab === 'Episodes' ? 'Build worlds. Direct every frame.' : 'Turn sound into moving cinema.'}</h1>
          <p>Transform a simple idea into a polished production plan, visual storyboard, generated scenes, and final export.</p>
        </div>
        <div className="hero-actions"><button className="primary" onClick={() => notify('AI Director is preparing a creative brief')}>Generate with AI Director <span>→</span></button><button className="secondary" onClick={() => notify('New project created')}>+ New Project</button></div>
      </section>

      <section className="workspace-grid">
        <aside className="panel scenes-panel"><div className="panel-heading"><span className="eyebrow">{activeTab === 'Episodes' ? 'EPISODE 01' : 'TRACK / CHORUS 01'}</span><button className="small-action" onClick={() => notify('Scene added')}>+ Add</button></div><h2>{activeTab === 'Episodes' ? 'The Last Frequency' : 'After the Silence'}</h2><div className="meta-line">{scenes.length} scenes <span>•</span> {totalDuration}s planned</div><div className="scene-list">{scenes.map((item) => <button key={item.id} className={selectedScene === item.id ? 'scene-row selected' : 'scene-row'} onClick={() => setSelectedScene(item.id)}><span className="scene-number">0{item.id}</span><span className="scene-copy"><strong>{item.title}</strong><small>{item.type} / {item.duration}s</small></span><span className={item.status === 'Approved' ? 'status-dot green' : item.status === 'Needs review' ? 'status-dot orange' : 'status-dot gray'} /></button>)}</div></aside>

        <section className="preview-column"><div className="preview-frame" style={{ backgroundImage: `linear-gradient(135deg, rgba(10,10,10,.18), rgba(10,10,10,.8)), url(${scene.image})` }}><div className="preview-top"><span className="eyebrow">STORYBOARD CINEMA MODE</span><span className="preview-watermark">CINEXVIDEO PREVIEW</span></div><div className="preview-center"><button className="play-button" onClick={() => notify('Storyboard animatic playing')}>▶</button><span>Scene 0{scene.id} / {scene.title}</span></div><div className="preview-bottom"><span>{scene.duration}.00s</span><span>VERSION {versions[scene.id] || 1}</span><span>16:9 / CINEMATIC</span></div></div><div className="timeline"><div className="timeline-head"><span className="eyebrow">TIMELINE / RIPPLE EDIT</span><span>{totalDuration}.00s</span></div><div className="timeline-track">{scenes.map((item) => <button key={item.id} className={selectedScene === item.id ? 'clip selected' : 'clip'} style={{ flex: item.duration }} onClick={() => setSelectedScene(item.id)}><span>0{item.id}</span><small>{item.title}</small></button>)}</div><div className="timeline-audio"><span>AUDIO / DIALOGUE + SCORE</span><div className="waveform">▁▃▆▃▇▅▂▆▃▅▇▂▅▃▆▂▇▅▃▆</div></div></div></section>

        <aside className="right-column"><div className="panel director-panel"><div className="panel-heading"><span className="eyebrow">AI DIRECTOR</span><button className="collapse" onClick={() => setDirectorOpen(!directorOpen)}>{directorOpen ? '−' : '+'}</button></div>{directorOpen && <><h2>Your next take starts here.</h2><textarea value={prompt} onChange={(event) => setPrompt(event.target.value)} /><div className="chip-row">{styles.map((style) => <button key={style} className="chip" onClick={() => notify(`${style} selected`)}>{style}</button>)}</div><div className="director-controls"><label>Intensity <input type="range" defaultValue="72" /></label><label>Continuity lock <span className="toggle on">ON</span></label></div><button className="primary full" onClick={regenerate}>Regenerate selected scene</button></>}</div><div className="panel references-panel"><div className="panel-heading"><span className="eyebrow">REFERENCES / OUTFITS / LOCATIONS</span><span className="status-dot green" /></div><div className="reference-grid"><div className="reference-card"><div className="reference-image">MAYA</div><small>Character / locked</small></div><div className="reference-card"><div className="reference-image red">RED JACKET</div><small>Outfit / scenes 03–06</small></div><div className="reference-card"><div className="reference-image blue">STUDIO</div><small>Location / locked</small></div></div><label className="upload-button">+ Upload reference<input type="file" accept="image/*" onChange={(event) => { setUploadName(event.target.files?.[0]?.name || ''); notify('Reference added to project library'); }} /></label>{uploadName && <small className="upload-name">{uploadName}</small>}</div></aside>
      </section>

      <section className="bottom-grid"><div className="panel status-panel"><div className="panel-heading"><span className="eyebrow">PRODUCTION STATUS</span><span className="status-dot green" /></div><div className="status-items"><span>● Storyboard ready</span><span>● Audio synced</span><span>● Continuity locked</span><span>● {versions[selectedScene] || 1} takes</span></div></div><div className="panel export-panel"><div><span className="eyebrow">EXPORT</span><h2>Choose your finish</h2><p>Watermarked export is included with your generation. Remove the watermark when you are ready for final delivery.</p></div><div className="export-actions"><button className="secondary" onClick={() => notify('Watermarked export queued')}>Export with watermark <small>Included</small></button><button className="primary" onClick={() => notify('Clean export requires credits')}>Remove watermark <small>Credits required</small></button></div></div></section>

      <section className="admin-strip"><span className="eyebrow">ADMIN COMMAND DECK</span><button className={maintenance ? 'control danger' : 'control'} onClick={() => { setMaintenance(!maintenance); notify(`Maintenance mode ${!maintenance ? 'enabled' : 'disabled'}`); }}>Maintenance {maintenance ? 'ON' : 'OFF'}</button><button className={discount ? 'control active-control' : 'control'} onClick={() => { setDiscount(!discount); notify(`Discount mode ${!discount ? 'enabled' : 'disabled'}`); }}>Discount {discount ? 'ON' : 'OFF'}</button><button className="control" onClick={() => notify('Bonus-credit panel opened')}>Grant bonus credits</button><button className="control" onClick={() => notify('User management opened')}>Manage users</button></section>

      {toast && <div className="toast">{toast}</div>}
    </main>
  );
}
