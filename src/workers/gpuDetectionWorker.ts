/// <reference lib="webworker" />
import { Rect, Target } from '../types';
import {
  clearTemplateCache,
  getOrComputeFramePyramid,
  matchTemplateInFrame,
  matchWithCandidates,
  normalizeRoi,
  prepareTemplate,
  pyramidRankScore,
  resetFrameCache,
  PreprocessedTemplate,
  SweepCandidate,
  PYRAMID_SCALE,
} from '../utils/imageMatching';
import { GpuSweeper, GpuCandidateSet, GpuSweepTarget } from '../utils/gpuSweep';

/**
 * GPU detection worker.
 *
 * Same message protocol as `detectionWorker`, but this one holds a WebGPU device
 * and does the candidate sweep — 89% of the per-frame cost — on the graphics
 * card. The CPU work left per frame is one `getImageData` plus the pixel-exact
 * refinement of a few dozen candidates per target, which is why one of these
 * replaces the whole worker pool instead of joining it.
 *
 * The refinement is the unmodified `computeFullScore`, so the similarity numbers
 * and thresholds mean exactly what they meant before; the GPU only decides where
 * to look. If anything about the device or the shaders is wrong, the worker says
 * so (`{type:'mode', gpu:false}`) and the main thread goes back to the CPU pool
 * — it never silently reports "nothing found".
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
  bandY: number;
  fullWidth: number;
  fullHeight: number;
}

type InboundMessage = TargetsMessage | FrameMessage;

interface WorkerMatch {
  targetId: string;
  score: number;
  box: Rect;
}

const post = (msg: unknown) => (self as unknown as Worker).postMessage(msg);

let specs: WorkerTargetSpec[] = [];
let algorithm: 'ncc' | 'fast_color' = 'ncc';
const prepared = new Map<string, PreprocessedTemplate>();

let canvas: OffscreenCanvas | null = null;
let ctx: OffscreenCanvasRenderingContext2D | null = null;

let sweeper: GpuSweeper | null = null;
/** Resolved once, on the first 'targets' message. */
let gpuInit: Promise<void> | null = null;
let gpuUsable = false;
let selfTestDone = false;
/** Set when the target set or the frame size changed and the GPU must be re-told. */
let targetsDirty = true;
let sweepWidth = 0;
let sweepHeight = 0;

// ── Unchanged-frame gate ──
//
// Screen capture is lossless: a motionless window arrives byte-identical, and the
// same templates over the same pixels can only produce the same scores. The CPU
// worker gets this short-circuit for free from `updateFramePlanes`, which compares
// the frame as part of rebuilding its luminance planes. This worker has no planes
// to rebuild — the sweep runs on the card and the refinement reads RGBA directly,
// which is why `matchWithCandidates` is called with a null gray plane — so the
// comparison has to stand on its own here. It is worth standing on its own: one
// pass over the frame that stops at the first differing pixel, instead of a full
// texture upload, two compute passes, a buffer map and the refinement of every
// candidate of every target.
//
// Without this, an idle screen cost the GPU path a full sweep while costing the
// CPU pool one memcmp — which also made the backend trial in App.tsx compare two
// different questions.
let prevFrameWords: Uint32Array | null = null;
let cachedResults: WorkerMatch[] = [];

/** True when this frame is byte-identical to the previous one. */
function frameUnchanged(frameData: ImageData): boolean {
  const bytes = frameData.data;
  // getImageData hands out a fresh buffer per call, so this view can simply be
  // retained as "the previous frame" instead of copying 8 MB.
  const words = new Uint32Array(bytes.buffer, bytes.byteOffset, bytes.byteLength >> 2);
  const prev = prevFrameWords;
  prevFrameWords = words;
  if (!prev || prev.length !== words.length) return false;
  for (let i = 0, n = words.length; i < n; i++) {
    if (words[i] !== prev[i]) return false;
  }
  return true;
}

/** Force the next frame to be swept (target set, frame size or device changed). */
function invalidateFrameGate(): void {
  prevFrameWords = null;
  cachedResults = [];
  resetFrameCache();
}

function giveUpOnGpu(reason: string): void {
  if (!gpuUsable && selfTestDone) return;
  gpuUsable = false;
  selfTestDone = true;
  sweeper?.destroy();
  sweeper = null;
  post({ type: 'mode', gpu: false, reason });
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

/** The user's ROI in full-frame pixels, or null for a full-screen search. */
function resolveRoi(
  spec: WorkerTargetSpec,
  template: PreprocessedTemplate,
  w: number,
  h: number
): Rect | null {
  if (!spec.normalizedRoi) return null;
  const r = spec.normalizedRoi;
  const rect = { x: r.x * w, y: r.y * h, width: r.width * w, height: r.height * h };
  // An ROI smaller than the template used to return null here, which means "no
  // ROI" — a full-screen sweep, so the target could be reported anywhere on
  // screen precisely because the user had restricted it to a small area.
  // `normalizeRoi` reads that box the other way round (the template covers it) and
  // only returns null when no position fits in the frame at all, i.e. the template
  // is bigger than the screen — and then both matchers score 0 anyway.
  return normalizeRoi(rect, template.width, template.height, w, h);
}

function decodeCandidates(set: GpuCandidateSet): SweepCandidate[] {
  const words = set.packed;
  // The score half of each pair is the f32 bit pattern the shader wrote.
  const scores = new Float32Array(words.buffer, words.byteOffset, words.length);
  const out: SweepCandidate[] = new Array(set.count);
  for (let i = 0; i < set.count; i++) {
    const xy = words[i * 2];
    out[i] = {
      x: (xy & 0xffff) * PYRAMID_SCALE,
      y: (xy >>> 16) * PYRAMID_SCALE,
      score: scores[i * 2 + 1],
    };
  }
  return out;
}

/** Push the current target set (and ROIs, which depend on frame size) to the GPU. */
function syncGpuTargets(w: number, h: number): void {
  if (!sweeper) return;
  const list: GpuSweepTarget[] = [];
  for (const spec of specs) {
    const template = prepared.get(spec.id);
    if (!template) continue;
    list.push({
      id: spec.id,
      template,
      threshold: spec.threshold,
      roi: resolveRoi(spec, template, w, h),
    });
  }
  sweeper.setTargets(list, algorithm !== 'fast_color');
  targetsDirty = false;
  sweepWidth = w;
  sweepHeight = h;
}

/**
 * Prove the GPU is doing the CPU's arithmetic before anything depends on it.
 *
 * Two checks: the pyramid plane it built must match the one `computeFramePlanes`
 * builds from the same frame, and the score it reported for its own best
 * candidate must match `pyramidRankScore` at that position. The tolerances are
 * there because the frame reaches the GPU through `copyExternalImageToTexture`
 * and the CPU through a 2D canvas, and the two colour conversions of a video
 * frame can differ by a level or two — a broken shader misses by far more than
 * that, since wrong indexing collapses the correlation entirely.
 *
 * @returns null when the GPU passed, otherwise the reason it did not.
 */
function selfTest(frameData: ImageData, sets: GpuCandidateSet[], planes: {
  pyr: Uint8Array;
  cr: Uint8Array;
  cg: Uint8Array;
  width: number;
  height: number;
} | null): string | null {
  if (!planes) return 'plane readback failed';
  const cpu = getOrComputeFramePyramid(frameData, null, frameData.width, frameData.height);
  if (!cpu) return 'cpu pyramid unavailable';
  if (cpu.width !== planes.width || cpu.height !== planes.height) {
    return `plane size ${planes.width}x${planes.height} vs cpu ${cpu.width}x${cpu.height}`;
  }
  const n = cpu.width * cpu.height;
  let sum = 0;
  let max = 0;
  for (let i = 0; i < n; i++) {
    const d = Math.abs(planes.pyr[i] - cpu.data[i]);
    sum += d;
    if (d > max) max = d;
  }
  const mean = sum / Math.max(1, n);
  if (mean > 3 || max > 32) {
    return `pyramid differs (mean ${mean.toFixed(2)}, max ${max})`;
  }

  const useColor = algorithm !== 'fast_color';
  let checked = 0;
  for (const set of sets) {
    if (checked >= 4) break;
    if (set.count === 0) continue;
    const template = prepared.get(set.targetId);
    if (!template) continue;
    const cands = decodeCandidates(set);
    let best = cands[0];
    for (const c of cands) if (c.score > best.score) best = c;
    const ref = pyramidRankScore(
      template,
      cpu,
      best.x / PYRAMID_SCALE,
      best.y / PYRAMID_SCALE,
      useColor
    );
    if (Math.abs(ref - best.score) > 0.15) {
      return `score mismatch on ${set.targetId}: gpu ${best.score.toFixed(3)} cpu ${ref.toFixed(3)}`;
    }
    checked++;
  }
  return null;
}

/** The plain CPU path, used before the GPU is ready and after it fails. */
function cpuMatch(frameData: ImageData, w: number, h: number): WorkerMatch[] {
  const results: WorkerMatch[] = [];
  for (const spec of specs) {
    const template = prepared.get(spec.id);
    if (!template) continue;
    try {
      const { score, box } = matchTemplateInFrame(
        frameData,
        template,
        resolveRoi(spec, template, w, h),
        algorithm,
        spec.threshold
      );
      results.push({ targetId: spec.id, score, box });
    } catch {
      // Skip this target for this frame only.
    }
  }
  return results;
}

self.onmessage = async (event: MessageEvent<InboundMessage>) => {
  const msg = event.data;

  if (msg.type === 'targets') {
    specs = msg.targets;
    algorithm = msg.algorithm;
    for (const spec of specs) {
      const p = prepared.get(spec.id);
      if (p && (p.width !== spec.imageWidth || p.height !== spec.imageHeight)) {
        prepared.delete(spec.id);
        clearTemplateCache(spec.id);
      }
    }
    await syncTemplates();
    invalidateFrameGate();
    targetsDirty = true;
    if (!gpuInit) {
      gpuInit = (async () => {
        sweeper = await GpuSweeper.create();
        gpuUsable = !!sweeper;
        if (!sweeper) giveUpOnGpu('no webgpu device');
      })();
    }
    post({ type: 'ready', count: prepared.size });
    return;
  }

  if (msg.type !== 'frame') return;

  const bitmap = msg.bitmap;
  const w = bitmap.width;
  const h = bitmap.height;
  let results: WorkerMatch[] = [];
  let unchanged = false;

  try {
    const c = ensureCanvas(w, h);
    if (c) {
      await syncTemplates();
      if (gpuInit) await gpuInit;
      if (sweeper?.lost) giveUpOnGpu('device lost');

      // The frame is read back and compared before any GPU work is issued. The
      // previous order issued the sweep first so that `getImageData` overlapped
      // with the card, but that overlap is only worth having on a frame that has
      // to be searched: it bought a few milliseconds on those and paid a full
      // sweep on every idle frame, and a watched window is idle most of the time.
      c.drawImage(bitmap, 0, 0);
      const frameData = c.getImageData(0, 0, w, h);

      if (frameUnchanged(frameData)) {
        // Nothing moved. Replay the previous scores: the main thread still gets an
        // ordinary result message, so cooldowns, sounds and automation behave
        // exactly as if the frame had been searched — which it effectively was.
        unchanged = true;
        results = cachedResults;
      } else {
        if (sweeper && gpuUsable && (targetsDirty || w !== sweepWidth || h !== sweepHeight)) {
          syncGpuTargets(w, h);
        }

        const sweeping = !!(sweeper && gpuUsable);
        const sets = sweeping ? await sweeper!.sweep(bitmap, w, h) : null;

        if (sweeping && !sets) {
          giveUpOnGpu('sweep failed');
        }

        if (sets) {
          // An empty target list means the planes were never dispatched, so there
          // is nothing to compare the readback against yet.
          if (!selfTestDone && sets.length > 0) {
            const planes = await sweeper!.readPlanes();
            const failure = selfTest(frameData, sets, planes);
            if (failure) {
              giveUpOnGpu(failure);
            } else {
              selfTestDone = true;
              post({ type: 'mode', gpu: true, targets: sets.length });
            }
          }
        }

        if (sets && gpuUsable) {
          const byId = new Map(sets.map((s) => [s.targetId, s]));
          let overflowed = 0;
          for (const spec of specs) {
            const template = prepared.get(spec.id);
            if (!template) continue;
            const roi = resolveRoi(spec, template, w, h);
            const set = byId.get(spec.id);
            try {
              // A target with no pyramid level (a template under 8px) never reaches
              // the GPU, so it keeps the ordinary CPU search. So does a target whose
              // candidate list overflowed: the kernel appends in dispatch order and
              // drops everything past the cap, so the dropped positions are not the
              // low-ranking ones and the true peak can be among them. Redoing that
              // one target on the CPU costs ~10 ms on the frame it happens and is
              // the only way the result stays the same as if the cap were infinite.
              const usable = set && !set.overflow ? set : null;
              const { score, box } = usable
                ? matchWithCandidates(
                    frameData,
                    template,
                    decodeCandidates(usable),
                    roi,
                    algorithm,
                    spec.threshold
                  )
                : matchTemplateInFrame(frameData, template, roi, algorithm, spec.threshold);
              if (set?.overflow) overflowed++;
              results.push({ targetId: spec.id, score, box });
            } catch {
              // Skip this target for this frame only.
            }
          }
          if (overflowed > 0) post({ type: 'overflow', count: overflowed });
        } else {
          results = cpuMatch(frameData, w, h);
        }

        cachedResults = results;
      }
    }
  } catch {
    // Never leave the main thread waiting for a frame that will not come, and
    // never let a half-finished frame become the gate's reference: whatever state
    // the caches are in, the next frame is searched from scratch.
    invalidateFrameGate();
    unchanged = false;
    results = [];
  } finally {
    bitmap.close();
  }

  post({
    type: 'result',
    frameId: msg.frameId,
    width: msg.fullWidth || w,
    height: msg.fullHeight || h,
    unchanged,
    results,
  });
};
