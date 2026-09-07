'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { getProject, updateProject, updateScene } from '@/lib/cinexvideo-client';

function projectFromResponse(result) {
  return {
    ...result.project,
    scenes: (result.scenes || []).map((scene) => ({
      id: scene.id,
      position: scene.position,
      title: scene.title || '',
      purpose: scene.purpose || '',
      prompt: scene.prompt || '',
      shotDirection: scene.shot_direction || '',
      durationSeconds: scene.duration_seconds || 8,
      status: scene.status || 'draft',
    })),
  };
}

export default function ProductionProjectEditor({ projectId }) {
  const [project, setProject] = useState(null);
  const [loading, setLoading] = useState(true);
  const [savingId, setSavingId] = useState(null);
  const [message, setMessage] = useState('');

  useEffect(() => {
    let cancelled = false;

    async function loadProject() {
      try {
        const result = await getProject(projectId);
        if (!cancelled) setProject(projectFromResponse(result));
      } catch (error) {
        if (!cancelled) setMessage(error.message || 'This project could not be loaded.');
      } finally {
        if (!cancelled) setLoading(false);
      }
    }

    loadProject();
    return () => {
      cancelled = true;
    };
  }, [projectId]);

  function updateLocalScene(sceneId, patch) {
    setProject((current) => ({
      ...current,
      scenes: current.scenes.map((scene) => scene.id === sceneId ? { ...scene, ...patch } : scene),
    }));
    setMessage('');
  }

  async function saveProjectTitle() {
    if (!project?.title?.trim()) return;
    setSavingId('project');
    setMessage('');
    try {
      await updateProject(project.id, { title: project.title });
      setMessage('Project title saved.');
    } catch (error) {
      setMessage(error.message || 'Project title could not be saved.');
    } finally {
      setSavingId(null);
    }
  }

  async function saveScene(scene) {
    setSavingId(scene.id);
    setMessage('');
    try {
      await updateScene(scene.id, {
        title: scene.title,
        prompt: scene.prompt,
        shot_direction: scene.shotDirection,
        duration_seconds: Number(scene.durationSeconds),
      });
      setMessage(`Scene ${scene.position} saved.`);
    } catch (error) {
      setMessage(error.message || `Scene ${scene.position} could not be saved.`);
    } finally {
      setSavingId(null);
    }
  }

  if (loading) return <p className="cinex-auth-required" role="status">Loading your production project...</p>;
  if (!project) {
    return (
      <div className="cinex-missing-draft">
        <p className="cinex-form-error">{message || 'This project could not be found.'}</p>
        <Link href="/dashboard" className="cinex-route-primary">Return to dashboard</Link>
      </div>
    );
  }

  return (
    <div className="cinex-editor-wrap">
      <section className="cinex-review-summary" aria-labelledby="production-project-title">
        <label className="cinex-editor-title">
          Project title
          <input
            value={project.title}
            onChange={(event) => setProject((current) => ({ ...current, title: event.target.value }))}
          />
        </label>
        <p className="cinex-shot-plan-logline">{project.logline || 'No project logline added.'}</p>
        <button
          type="button"
          className="cinex-auth-secondary"
          onClick={saveProjectTitle}
          disabled={savingId === 'project' || !project.title.trim()}
        >
          {savingId === 'project' ? 'Saving...' : 'Save project title'}
        </button>
      </section>

      <section className="cinex-shot-plan" aria-labelledby="production-scenes-title">
        <p className="cinex-shot-plan-eyebrow">Production storyboard</p>
        <h2 id="production-scenes-title">Scenes</h2>
        {project.scenes.length ? (
          <div className="cinex-scene-list">
            {project.scenes.map((scene) => (
              <article className="cinex-scene-card cinex-production-scene-editor" key={scene.id}>
                <div className="cinex-scene-card-header">
                  <strong>Scene {scene.position}</strong>
                  <span>{scene.status}</span>
                </div>
                <label>
                  Scene title
                  <input value={scene.title} onChange={(event) => updateLocalScene(scene.id, { title: event.target.value })} />
                </label>
                <label>
                  Visual prompt
                  <textarea rows={4} value={scene.prompt} onChange={(event) => updateLocalScene(scene.id, { prompt: event.target.value })} />
                </label>
                <label>
                  Shot direction
                  <textarea rows={3} value={scene.shotDirection} onChange={(event) => updateLocalScene(scene.id, { shotDirection: event.target.value })} />
                </label>
                <label>
                  Duration (seconds)
                  <input type="number" min="1" max="600" value={scene.durationSeconds} onChange={(event) => updateLocalScene(scene.id, { durationSeconds: event.target.value })} />
                </label>
                <button type="button" className="cinex-auth-secondary" onClick={() => saveScene(scene)} disabled={savingId === scene.id}>
                  {savingId === scene.id ? 'Saving...' : 'Save scene'}
                </button>
              </article>
            ))}
          </div>
        ) : (
          <p className="cinex-dashboard-empty">No scenes have been added to this project yet.</p>
        )}
      </section>
      {message && <p className="cinex-form-success" role="status">{message}</p>}
    </div>
  );
}
