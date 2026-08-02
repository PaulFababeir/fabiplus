import { useCallback, useEffect, useRef } from 'react';

/**
 * Hover-scrub thumbnails, generated on the fly.
 *
 * There is no ffmpeg in this app, so rather than pre-extracting a sprite sheet
 * a second, hidden <video> is seeked to the hovered timestamp and painted to a
 * canvas. Reading a local file makes that fast enough to feel live, and it
 * costs no extra dependency and nothing on disk.
 *
 * Seeks are coalesced: while one is in flight the newest requested time is
 * held and applied when it completes, so dragging across the bar cannot queue
 * hundreds of seeks.
 */
export function useScrubPreview(src: string): {
  canvasRef: React.RefObject<HTMLCanvasElement | null>;
  requestFrame: (time: number) => void;
} {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const pendingRef = useRef<number | null>(null);
  const seekingRef = useRef(false);

  useEffect(() => {
    // Never attached to the DOM; it exists purely as a frame source.
    const video = document.createElement('video');
    video.src = src;
    video.preload = 'metadata';
    video.muted = true;
    videoRef.current = video;

    const draw = (): void => {
      seekingRef.current = false;

      const canvas = canvasRef.current;
      const ctx = canvas?.getContext('2d');
      if (canvas && ctx && video.videoWidth > 0) {
        canvas.width = 320;
        canvas.height = Math.round((320 * video.videoHeight) / video.videoWidth);
        ctx.drawImage(video, 0, 0, canvas.width, canvas.height);
      }

      // Apply whatever the pointer moved to while this seek was running.
      const next = pendingRef.current;
      pendingRef.current = null;
      if (next !== null) {
        seekingRef.current = true;
        video.currentTime = next;
      }
    };

    video.addEventListener('seeked', draw);

    return () => {
      video.removeEventListener('seeked', draw);
      video.removeAttribute('src');
      video.load();
      videoRef.current = null;
      pendingRef.current = null;
      seekingRef.current = false;
    };
  }, [src]);

  const requestFrame = useCallback((time: number) => {
    const video = videoRef.current;
    if (!video || !Number.isFinite(time)) return;

    if (seekingRef.current) {
      pendingRef.current = time;
      return;
    }
    seekingRef.current = true;
    video.currentTime = time;
  }, []);

  return { canvasRef, requestFrame };
}
