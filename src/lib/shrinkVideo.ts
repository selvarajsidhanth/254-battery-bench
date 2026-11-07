/* Makes a match video small enough to store for the team: trims it to the
   match and re-encodes at 720p, ~2 Mbps (about 45 MB for 3 minutes). Runs in
   the browser with WebCodecs, usually faster than real time. */

export const SHRINK_WIDTH = 1280;
const VIDEO_BPS = 2_000_000;
const AUDIO_BPS = 96_000;

export const canShrink = () => typeof window !== 'undefined' && 'VideoEncoder' in window;

export async function shrinkVideo(file: File, trim: { start: number; end: number } | null, onProgress: (p: number) => void): Promise<Blob> {
  const mb = await import('mediabunny');
  const input = new mb.Input({ source: new mb.BlobSource(file), formats: mb.ALL_FORMATS });
  const track = await input.getPrimaryVideoTrack();
  if (!track) throw new Error('No video track in that file');
  const output = new mb.Output({ format: new mb.Mp4OutputFormat({ fastStart: 'in-memory' }), target: new mb.BufferTarget() });
  const conv = await mb.Conversion.init({
    input, output,
    video: { width: Math.min(SHRINK_WIDTH, track.displayWidth), bitrate: VIDEO_BPS, forceTranscode: true },
    audio: { bitrate: AUDIO_BPS },
    trim: trim ?? undefined,
  });
  if (!conv.isValid) throw new Error('This browser can’t re-encode that video');
  conv.onProgress = (p) => onProgress(p);
  await conv.execute();
  const buf = output.target.buffer;
  if (!buf) throw new Error('Re-encoding produced nothing');
  return new Blob([buf], { type: 'video/mp4' });
}
