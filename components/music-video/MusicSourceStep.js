'use client';

import { useEffect, useRef, useState } from 'react';
import { DEMO_TRACKS } from '@/lib/music-video-demo';

const ACCEPT = 'audio/mpeg,audio/wav,audio/mp4,audio/aac,audio/ogg,audio/flac';
const MAX_BYTES = 60 * 1024 * 1024;

/** Reads real duration from the selected file without uploading anything. */
function readAudioDuration(objectUrl) {
  return new Promise((resolve, reject) => {
    const audio = new Audio();
    audio.preload = 'metadata';
    audio.onloadedmetadata = () => resolve(Number.isFinite(audio.duration) ? Math.round(audio.duration) : null);
    audio.onerror = () => reject(new Error('That audio file could not be read.'));
    audio.src = objectUrl;
  });
}

export default function MusicSourceStep({ trackId, onTrackChange, rights, onRightsChange }) {
  const objectUrlRef = useRef(null);
  const [uploadName, setUploadName] = useState('');
  const [uploadUrl, setUploadUrl] = useState('');
  const [error, setError] = useState('');
  const [reading, setReading] = useState(false);

  useEffect(() => () => {
    if (objectUrlRef.current) URL.revokeObjectURL(objectUrlRef.current);
  }, []);

  async function handleFile(event) {
    const file = event.target.files?.[0];
    setError('');
    if (!file) return;

    if (file.size > MAX_BYTES) {
      setError('That track is larger than the 60 MB limit.');
      event.target.value = '';
      return;
    }
    if (file.type && !ACCEPT.split(',').includes(file.type)) {
      setError('Please choose an MP3, WAV, M4A, AAC, OGG or FLAC file.');
      event.target.value = '';
      return;
    }

    setReading(true);
    if (objectUrlRef.current) URL.revokeObjectURL(objectUrlRef.current);
    const objectUrl = URL.createObjectURL(file);
    objectUrlRef.current = objectUrl;

    try {
      const duration = await readAudioDuration(objectUrl);
      if (!duration) throw new Error('That audio file could not be read.');
      setUploadName(file.name);
      setUploadUrl(objectUrl);
      onTrackChange({
        id: 'uploaded-track',
        title: file.name.replace(/\.[^.]+$/, ''),
        duration,
        bpm: DEMO_TRACKS[0]?.bpm || 120,
        uploaded: true,
      });
    } catch (readError) {
      setError(readError.message || 'That audio file could not be read.');
      event.target.value = '';
    } finally {
      setReading(false);
    }
  }

  function chooseDemoTrack(event) {
    const track = DEMO_TRACKS.find((item) => item.id === event.target.value);
    if (!track) return;
    setUploadName('');
    setUploadUrl('');
    onTrackChange(track);
  }

  return (
    <section className="cinex-music-source-options" aria-labelledby="music-source-title">
      <h2 id="music-source-title">Step 1: Music</h2>

      <label>
        Demo track profile
        <select value={trackId} onChange={chooseDemoTrack}>
          {DEMO_TRACKS.map((track) => (
            <option key={track.id} value={track.id}>
              {track.title} · {track.duration}s · {track.bpm} BPM
            </option>
          ))}
        </select>
        <span className="cinex-form-optional">Demo track profile — no audio file is processed.</span>
      </label>

      <label>
        Upload MP3, WAV, M4A, AAC, OGG or FLAC
        <input type="file" accept={ACCEPT} onChange={handleFile} disabled={reading} />
        <span className="cinex-form-optional">
          Your file stays on this device and is used to read the real track length. Up to 60 MB.
        </span>
      </label>

      {reading && <p className="cinex-form-success" role="status">Reading track length...</p>}
      {error && <p className="cinex-form-error" role="alert">{error}</p>}

      {uploadName && uploadUrl && (
        <div className="cinex-music-upload-preview">
          <strong>{uploadName}</strong>
          <audio controls preload="metadata" src={uploadUrl}>
            Your browser cannot play this audio file.
          </audio>
        </div>
      )}

      <label className="cinex-check-row">
        <input type="checkbox" checked={rights} onChange={(event) => onRightsChange(event.target.checked)} />{' '}
        I own this music or have permission to use it.
      </label>
    </section>
  );
}
