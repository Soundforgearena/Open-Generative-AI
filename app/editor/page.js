'use client';

import { useEffect, useMemo, useState } from 'react';

const initialScenes = [
  { id: 'scene-1', slugline: 'INT. APARTMENT — NIGHT', title: 'The call', duration: 12, action: 'Dim light cuts through the blinds. Maya pauses by the door and listens before answering her phone.', camera: '50mm · slow push-in · shallow depth of field', dialogue: 'MAYA: I said I would call you back.', sound: 'Distant traffic · refrigerator hum · phone vibration', notes: 'Hold two beats of silence before the line. Keep the room intimate and tense.' },
  { id: 'scene-2', slugline: 'EXT. ROOFTOP — DAWN', title: 'The decision', duration: 18, action: 'Wind moves across the rooftop as Maya reaches the ledge. The city begins to wake below her.', camera: '35mm handheld · wide establishing to medium close-up', dialogue: '', sound: 'Wind · distant sirens · early-morning city bed', notes: 'Let the city feel enormous. The framing should isolate Maya against the skyline.' },
  { id: 'scene-3', slugline: 'INT. CAR — MOVING — NIGHT', title: 'The escape', duration: 22, action: 'Streetlights smear across the windshield. Marcus grips the wheel, checking the rearview mirror.', camera: '85mm · locked frame · rack focus mirror to eyes', dialogue: 'MARCUS: They know where we are.', sound: 'Engine rumble · wet tires · intermittent wipers', notes: 'No score until the final three seconds. Let practical sound carry the tension.' }
];

const formatTime = (seconds) => {
  const safe = Math.max(0, Math.floor(Number(seconds) || 0));
  return `${String(Math.floor(safe / 60)).padStart(2, '0')}:${String(safe % 60).padStart(2, '0')}`;
};
const uid = () => `scene-${Date.now()}-${Math.random().toString(16).slice(2)}`;

export default function EditorPage() {
  const [scenes, setScenes] = useState(initialScenes);
  const [selectedId, setSelectedId] = useState(initialScenes[0].id);
  const [playhead, setPlayhead] = useState(0);
  const [playing, setPlaying] = useState(false);
  const [savedAt, setSavedAt] = useState(null);

  useEffect(() => {
    try {
      const saved = window.localStorage.getItem('cinex-editor-draft-v1');
      if (saved) {
        const parsed = JSON.parse(saved);
        if (Array.isArray(parsed.scenes) && parsed.scenes.length) {
          setScenes(parsed.scenes);
          setSelectedId(parsed.selectedId || parsed.scenes[0].id);
        }
      }
    } catch (_) {}
  }, []);

  useEffect(() => {
    if (!playing) return undefined;
    const interval = window.setInterval(() => {
      setPlayhead((current) => {
        const currentScene = scenes.find((item) => item.id === selectedId);
        const duration = currentScene?.duration || 1;
        if (current + 0.25 >= duration) {
          const index = scenes.findIndex((item) => item.id === selectedId);
          const next = scenes[(index + 1) % scenes.length];
          if (next) setSelectedId(next.id);
          return 0;
        }
        return current + 0.25;
      });
    }, 250);
    return () => window.clearInterval(interval);
  }, [playing, scenes, selectedId]);

  const selectedIndex = Math.max(0, scenes.findIndex((item) => item.id === selectedId));
  const scene = scenes[selectedIndex] || scenes[0];
  const totalDuration = useMemo(() => scenes.reduce((sum, item) => sum + Number(item.duration || 0), 0), [scenes]);
  const sceneProgress = scene?.duration ? Math.min(100, (playhead / scene.duration) * 100) : 0;

  const selectScene = (id) => { setSelectedId(id); setPlayhead(0); setPlaying(false); };
  const updateScene = (field, value) => setScenes((current) => current.map((item) => item.id === selectedId ? { ...item, [field]: field === 'duration' ? Math.max(1, Number(value) || 1) : value } : item));
  const saveDraft = () => {
    try { window.localStorage.setItem('cinex-editor-draft-v1', JSON.stringify({ scenes, selectedId })); setSavedAt(new Date()); } catch (_) {}
  };
  const addScene = () => {
    const next = { id: uid(), slugline: 'NEW SCENE', title: 'Untitled scene', duration: 8, action: 'Describe the visible action for this scene.', camera: 'Camera direction', dialogue: '', sound: '', notes: '' };
    setScenes((current) => [...current, next]);
    selectScene(next.id);
  };
  const duplicateScene = () => {
    if (!scene) return;
    const copy = { ...scene, id: uid(), title: `${scene.title} copy` };
    setScenes((current) => {
      const position = current.findIndex((item) => item.id === selectedId);
      return [...current.slice(0, position + 1), copy, ...current.slice(position + 1)];
    });
    selectScene(copy.id);
  };

  return (
    <main className="min-h-screen bg-slate-950 text-slate-100">
      <header className="sticky top-0 z-20 flex min-h-16 items-center gap-3 border-b border-white/10 bg-slate-950/90 px-4 backdrop-blur md:px-6">
        <a href="/dashboard" className="flex items-center gap-2 text-sm font-semibold tracking-tight text-white" aria-label="Back to dashboard"><span className="grid h-8 w-8 place-items-center rounded-lg bg-gradient-to-br from-orange-400 to-orange-700 text-sm font-black text-slate-950">C</span><span className="hidden sm:inline">Cinex Video</span></a>
        <div className="min-w-0 border-l border-white/10 pl-3 text-sm text-slate-400"><span className="hidden sm:inline">Production workspace / </span><strong className="font-semibold text-slate-100">Untitled episode</strong></div>
        <div className="ml-auto flex items-center gap-2">{savedAt && <span className="hidden text-xs text-emerald-400 md:inline">Saved {savedAt.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}</span>}<button onClick={saveDraft} className="rounded-lg border border-white/15 px-3 py-2 text-xs font-semibold text-slate-100 transition hover:border-orange-400/70 hover:bg-white/5">Save draft</button><button onClick={() => setPlaying(true)} className="rounded-lg bg-orange-500 px-3 py-2 text-xs font-bold text-slate-950 transition hover:bg-orange-400">Render preview</button></div>
      </header>
      <div className="grid min-h-[calc(100vh-4rem)] grid-cols-1 gap-3 p-3 xl:grid-cols-[270px_minmax(0,1fr)_330px] xl:grid-rows-[minmax(0,1fr)_235px] xl:p-4">
        <section className="overflow-hidden rounded-2xl border border-white/10 bg-slate-900/75 shadow-2xl shadow-black/20 xl:row-span-2">
          <div className="flex items-center justify-between border-b border-white/10 px-4 py-3"><div><p className="text-xs font-bold uppercase tracking-[0.16em] text-slate-400">Scenes</p><p className="mt-0.5 text-xs text-slate-500">{scenes.length} scenes · {formatTime(totalDuration)}</p></div><button onClick={addScene} className="rounded-md border border-orange-400/40 px-2 py-1 text-xs font-bold text-orange-300 hover:bg-orange-400/10">+ Add</button></div>
          <div className="max-h-[320px] space-y-2 overflow-y-auto p-3 xl:max-h-[calc(100vh-150px)]">{scenes.map((item, index) => <button key={item.id} onClick={() => selectScene(item.id)} className={`w-full rounded-xl border p-3 text-left transition ${item.id === selectedId ? 'border-orange-400 bg-orange-400/10 shadow-[0_0_0_1px_rgba(251,146,60,.18)]' : 'border-white/10 bg-slate-950/45 hover:border-orange-300/45 hover:bg-white/[.03]'}`}><div className="flex items-start gap-3"><span className="grid h-7 w-7 shrink-0 place-items-center rounded-md border border-orange-400/35 bg-orange-400/10 font-mono text-xs font-bold text-orange-300">{index + 1}</span><span className="min-w-0 flex-1"><span className="block truncate text-xs font-bold text-slate-100">{item.slugline}</span><span className="mt-1 block truncate text-xs text-slate-400">{item.title}</span></span><span className="font-mono text-xs text-slate-500">{formatTime(item.duration)}</span></div></button>)}</div>
        </section>
        <section className="flex min-h-[420px] flex-col overflow-hidden rounded-2xl border border-white/10 bg-slate-900/75 shadow-2xl shadow-black/20">
          <div className="flex items-center justify-between border-b border-white/10 px-4 py-3"><p className="text-xs font-bold uppercase tracking-[0.16em] text-slate-400">Preview</p><span className="font-mono text-xs text-slate-500">{formatTime(playhead)} / {formatTime(scene?.duration)}</span></div>
          <div className="relative m-4 flex flex-1 items-center justify-center overflow-hidden rounded-xl border border-white/10 bg-[radial-gradient(circle_at_50%_0%,rgba(249,115,22,.18),transparent_45%),linear-gradient(135deg,#111827,#030712)]"><div className="absolute inset-0 opacity-30" style={{ backgroundImage: 'linear-gradient(rgba(255,255,255,.04) 1px, transparent 1px), linear-gradient(90deg, rgba(255,255,255,.04) 1px, transparent 1px)', backgroundSize: '32px 32px' }} /><div className="relative max-w-xl px-6 text-center"><p className="font-mono text-xs uppercase tracking-[0.2em] text-orange-300">Scene {selectedIndex + 1}</p><h1 className="mt-3 text-xl font-black tracking-tight text-white sm:text-3xl">{scene?.slugline}</h1><p className="mx-auto mt-4 max-w-lg text-sm leading-7 text-slate-300">{scene?.action}</p><div className="mt-7 flex flex-wrap justify-center gap-2"><span className="rounded-full border border-white/15 bg-black/20 px-3 py-1 text-xs text-slate-300">🎥 {scene?.camera}</span><span className="rounded-full border border-white/15 bg-black/20 px-3 py-1 text-xs text-slate-300">🔊 {scene?.sound || 'No sound notes'}</span></div></div><div className="absolute bottom-4 left-4 right-4 h-1 overflow-hidden rounded-full bg-white/10"><div className="h-full bg-orange-400 transition-[width] duration-200" style={{ width: `${sceneProgress}%` }} /></div></div>
        </section>
        <section className="overflow-hidden rounded-2xl border border-white/10 bg-slate-900/75 shadow-2xl shadow-black/20">
          <div className="flex items-center justify-between border-b border-white/10 px-4 py-3"><p className="text-xs font-bold uppercase tracking-[0.16em] text-slate-400">Inspector</p><button onClick={duplicateScene} className="text-xs font-semibold text-orange-300 hover:text-orange-200">Duplicate scene</button></div>
          <div className="grid max-h-[520px] gap-4 overflow-y-auto p-4"><Field label="Scene title" value={scene?.title} onChange={(value) => updateScene('title', value)} /><Field label="Slugline" value={scene?.slugline} onChange={(value) => updateScene('slugline', value)} /><div className="grid grid-cols-[1fr_100px] gap-3"><Field label="Camera" value={scene?.camera} onChange={(value) => updateScene('camera', value)} /><Field label="Duration (sec)" type="number" value={scene?.duration} onChange={(value) => updateScene('duration', value)} /></div><Field label="Action" multiline value={scene?.action} onChange={(value) => updateScene('action', value)} /><Field label="Dialogue" multiline value={scene?.dialogue} onChange={(value) => updateScene('dialogue', value)} /><Field label="Sound" value={scene?.sound} onChange={(value) => updateScene('sound', value)} /><Field label="Director notes" multiline value={scene?.notes} onChange={(value) => updateScene('notes', value)} /></div>
        </section>
        <section className="overflow-hidden rounded-2xl border border-white/10 bg-slate-900/75 shadow-2xl shadow-black/20 xl:col-start-2 xl:col-end-4">
          <div className="flex items-center justify-between border-b border-white/10 px-4 py-3"><p className="text-xs font-bold uppercase tracking-[0.16em] text-slate-400">Timeline</p><span className="font-mono text-xs text-slate-500">Total {formatTime(totalDuration)}</span></div>
          <div className="space-y-3 overflow-x-auto p-4">{['VIDEO A', 'VIDEO B', 'AUDIO'].map((track, trackIndex) => <div key={track} className="grid min-w-[680px] grid-cols-[78px_1fr] items-center gap-3"><span className="rounded-md border border-white/10 bg-slate-950/60 px-2 py-1.5 text-center font-mono text-[10px] font-bold tracking-wide text-slate-400">{track}</span><div className="relative h-9 rounded-lg border border-white/10 bg-slate-950/55 p-1.5">{trackIndex === 0 && scenes.map((item) => <button key={item.id} onClick={() => selectScene(item.id)} className={`mr-1 inline-flex h-6 items-center rounded px-2 text-[10px] font-bold transition ${item.id === selectedId ? 'bg-orange-400 text-slate-950' : 'bg-slate-700 text-slate-200 hover:bg-slate-600'}`} style={{ width: `${Math.max(10, (item.duration / Math.max(totalDuration, 1)) * 100)}%` }}>{item.title}</button>)}{trackIndex === 2 && <div className="h-6 rounded bg-gradient-to-r from-orange-500/20 via-sky-400/20 to-orange-500/20" />}</div></div>)}</div>
          <div className="flex items-center gap-2 border-t border-white/10 px-4 py-3"><button onClick={() => { setPlaying(false); setPlayhead(0); }} className="rounded-md border border-white/15 px-3 py-1.5 text-sm hover:bg-white/5">⏹</button><button onClick={() => setPlaying((value) => !value)} className="rounded-md bg-orange-500 px-3 py-1.5 text-sm font-bold text-slate-950 hover:bg-orange-400">{playing ? '⏸ Pause' : '▶ Play'}</button><button onClick={() => { const next = scenes[(selectedIndex + 1) % scenes.length]; if (next) selectScene(next.id); }} className="rounded-md border border-white/15 px-3 py-1.5 text-sm hover:bg-white/5">⏭</button><input aria-label="Scrub current scene" type="range" min="0" max={scene?.duration || 1} step="0.1" value={playhead} onChange={(event) => setPlayhead(Number(event.target.value))} className="ml-2 h-1 flex-1 accent-orange-400" /></div>
        </section>
      </div>
    </main>
  );
}

function Field({ label, value, onChange, multiline = false, type = 'text' }) {
  const shared = { value: value ?? '', onChange: (event) => onChange(event.target.value), className: 'w-full rounded-lg border border-white/10 bg-slate-950/70 px-3 py-2 text-sm text-slate-100 outline-none placeholder:text-slate-600 focus:border-orange-400/70' };
  return <label className="grid gap-1.5 text-xs font-semibold text-slate-400"><span>{label}</span>{multiline ? <textarea {...shared} rows={3} /> : <input {...shared} type={type} />}</label>;
}
