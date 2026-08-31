/// <reference lib="webworker" />
import { Rect, Target } from '../types';
import {
  clearTemplateCache,
  matchTemplateInFrame,
  prepareTemplate,
  resetFrameCache,
  updateFramePlanes,
  PreprocessedTemplate,
} from '../utils/imageMatching';

/**
 * Detection worker.
 *
 * The main thread was previously doing `drawImage` + `getImageData` + template
 * matching for every target inside the UI thread, which is what made the app
 * stutter once more than a handful of targets were enabled. Here the whole
 * pixel pipeline runs off-thread: the main thread only hands over an
 * ImageBitmap (a zero-copy transfer) and receives a small array of scores.
 */

interface WorkerTargetSpec {
  id: string;
  imageDataUrl: string;
  imageWidth: number;
  imageHeight: number;
  threshold: number;
  normalizedRoi?: Rect | null;
}

interface TargetsMessage {
  type: 'targets';
  targets: WorkerTargetSpec[];
  algorithm: 'ncc' | 'fast_color';
}

interface FrameMessage {
  type: 'frame';
  frameId: number;
  bitmap: ImageBitmap;
  /** Where this band starts in the full frame; boxes are shifted back by it. */
  bandY: number;
  /** Full frame size, so normalised ROIs still resolve to the same pixels. */
  fullWidth: number;
  fullHeight: number;
}

type InboundMessage = TargetsMessage | FrameMessage;

export interface WorkerMatch {
  targetId: string;
  score: number;
  box: Rect;
}

let specs: WorkerTargetSpec[] = [];
let algorithm: 'ncc' | 'fast_color' = 'ncc';
const prepared = new Map<string, PreprocessedTemplate>();

let canvas: OffscreenCanvas | null = null;
let ctx: OffscreenCanvasRenderingContext2D | null = null;

// ── Unchanged-frame gate ──
//
// Screen capture is lossless: when nothing on screen moved, the frame arrives
// byte-identical to the previous one, and template matching on identical pixels
// can only produce identical scores. So instead of rebuilding the luminance
// plane + pyramid and re-searching every target (tens of milliseconds per
// worker, on every core, forever), the worker replays its cached scores.
//
// `updateFramePlanes` does the comparison as part of preparing the frame: it
// checks every channel, rebuilds only the bands of the frame that moved, and
// tells us whether anything moved at all.
let cachedResults: WorkerMatch[] = [];

/** Force the next frame to be scanned (target set or frame size changed). */
function invalidateFrameGate(): void {
  resetFrameCache();
  cachedResults = [];
}

function ensureCanvas(w: number, h: number): OffscreenCanvasRenderingContext2D | null {
  if (!canvas || canvas.width !== w || canvas.height !== h) {
    canvas = new OffscreenCanvas(w, h);
    ctx = canvas.getContext('2d', { willReadFrequently: true });
    invalidateFrameGate();
  }
  return ctx;
}

async function syncTemplates(): Promise<void> {
  const liveIds = new Set(specs.map((s) => s.id));
  for (const id of [...prepared.keys()]) {
    if (!liveIds.has(id)) {
      prepared.delete(id);
      clearTemplateCache(id);
    }
  }
  await Promise.all(
    specs.map(async (spec) => {
      if (prepared.has(spec.id)) return;
      try {
        prepared.set(
          spec.id,
          await prepareTemplate({
            id: spec.id,
            imageDataUrl: spec.imageDataUrl,
            imageWidth: spec.imageWidth,
            imageHeight: spec.imageHeight,
          } as Target)
        );
      } catch {
        // A broken template must not take the whole worker down.
      }
    })
  );
}

self.onmessage = async (event: MessageEvent<InboundMessage>) => {
  const msg = event.data;

  if (msg.type === 'targets') {
    specs = msg.targets;
    algorithm = msg.algorithm;
    // Drop templates whose source image changed so they get re-decoded.
    for (const spec of specs) {
      const p = prepared.get(spec.id);
      if (p && (p.width !== spec.imageWidth || p.height !== spec.imageHeight)) {
        prepared.delete(spec.id);
        clearTemplateCache(spec.id);
      }
    }
    await syncTemplates();
    invalidateFrameGate();
    (self as unknown as Worker).postMessage({ type: 'ready', count: prepared.size });
    return;
  }

  if (msg.type !== 'frame') return;

  const bitmap = msg.bitmap;
  const w = bitmap.width;
  const h = bitmap.height;
  const bandY = msg.bandY || 0;
  const fullW = msg.fullWidth || w;
  const fullH = msg.fullHeight || h;
  let results: WorkerMatch[] = [];
  let unchanged = false;

  try {
    const c = ensureCanvas(w, h);
    if (c) {
      c.drawImage(bitmap, 0, 0);
      const frameData = c.getImageData(0, 0, w, h);

      // Templates are prepared lazily in case a frame arrives before the
      // matching 'targets' message has been fully processed.
      await syncTemplates();

      if (!updateFramePlanes(frameData)) {
        // Pixel-identical frame: replay the previous scores instead of redoing
        // the same arithmetic. The main thread still receives a normal result
        // message, so cooldowns, sounds and automation behave exactly as if the
        // frame had been searched.
        unchanged = true;
        results = cachedResults;
      } else {
        for (const spec of specs) {
          const template = prepared.get(spec.id);
          if (!template) continue;
          let roi: Rect | null = null;
          if (spec.normalizedRoi) {
            // Resolve against the full frame, then move into band coordinates and
            // clip. A band that no longer overlaps the ROI has nothing to do.
            const rx = spec.normalizedRoi.x * fullW;
            const ry = spec.normalizedRoi.y * fullH - bandY;
            const rw = spec.normalizedRoi.width * fullW;
            const rh = spec.normalizedRoi.height * fullH;
            const top = Math.max(0, ry);
            const bottom = Math.min(h, ry + rh);
            if (bottom - top < template.height) continue;
            roi = { x: rx, y: top, width: rw, height: bottom - top };
          }
          try {
            const { score, box } = matchTemplateInFrame(
              frameData,
              template,
              roi,
              algorithm,
              spec.threshold
            );
            results.push({
              targetId: spec.id,
              score,
              box: { ...box, y: box.y + bandY },
            });
          } catch {
            // Skip this target for this frame only.
          }
        }
        cachedResults = results;
      }
    }
  } finally {
    bitmap.close();
  }

  (self as unknown as Worker).postMessage({
    type: 'result',
    frameId: msg.frameId,
    width: fullW,
    height: fullH,
    unchanged,
    results,
  });
};
