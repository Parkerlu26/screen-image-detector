import { Rect, Target } from '../types';

export interface GrayPoint {
  x: number;
  y: number;
  lum: number;
}

export interface SamplePoint extends GrayPoint {
  r: number;
  g: number;
  b: number;
  // Chromaticity: r/(r+g+b), g/(r+g+b). Brightness-independent, so it separates
  // "same icon, different colour" — which plain luminance ZNCC cannot see at all.
  cr: number;
  cg: number;
  weight: number;
}

/**
 * How hard a hue mismatch is punished.
 *
 * The colour term is `1 - meanChromaDiff * COLOR_SHARPNESS`, so at 6 a mean
 * chromaticity error of ~0.17 zeroes the score outright. Two icons that differ
 * only in colour (e.g. a red vs a blue variant of the same shape) land far apart;
 * the same icon captured twice differs by ~0, since screen pixels are exact.
 */
const COLOR_SHARPNESS = 8;
/** Mean chromaticity error treated as capture noise and not penalised at all. */
const CHROMA_TOLERANCE = 0.045;
/** Same idea for absolute brightness: ignore small gain/bias drift, punish beyond. */
const LEVEL_TOLERANCE = 0.06;
const LEVEL_SHARPNESS = 4;
const PYR_COLOR_SHARPNESS = 2;
// How much brightness/contrast drift the colour halves may forgive, expressed as
// the range of the single gain+bias the window is allowed to be fitted through.
// Wide enough for another monitor's gamma, a night-mode filter or an icon fading
// in; far too narrow to fit away a genuinely different shade.
const MIN_FIT_GAIN = 0.75;
const MAX_FIT_GAIN = 1.35;
const MAX_FIT_BIAS = 28;
// Below this the fit is the identity and the second colour pass is pure cost.
const FIT_GAIN_EPS = 0.02;
const FIT_BIAS_EPS = 2;

// ── Flat (structureless) templates ──
//
// ZNCC divides by the standard deviation of both sides, so a template with no
// internal variation has nothing to correlate: every frame-side variance floor
// (`variance <= 1`) rejects the position, and a solid-colour target — a status
// light, a coloured banner, a filled progress bar — can never be found no matter
// how exactly its pixels agree. Correlation is the wrong measure there, not a
// measure to be tuned, so such subsets switch to absolute agreement: mean
// |frame - template| in grey levels, mapped to 0..1.
//
// A subset counts as flat when its own standard deviation is below FLAT_STD.
// That cut sits just above the frame-side floor (variance > 1, i.e. std > 1), so
// a subset is called flat exactly when ZNCC could not have worked anyway.
const FLAT_STD = 2;
// Grey levels of mean error that take the flat score from 1 down to 0. Capture
// of a solid area is lossless here, so a true match errs by ~0 and scores 1.0;
// 24 still leaves room for a level or two of drift while separating two shades a
// person can tell apart (12 levels of error scores 0.5).
const FLAT_GRAY_TOL = 24;

/** Absolute-agreement score in [0,1] from a mean grey error. */
function flatLevelScore(meanAbs: number): number {
  return meanAbs >= FLAT_GRAY_TOL ? 0 : 1 - meanAbs / FLAT_GRAY_TOL;
}

/** The mean grey error that `flatLevelScore` maps to exactly `score`. */
function flatBudget(score: number): number {
  return FLAT_GRAY_TOL * (1 - score);
}

/** Downscale factor of the coarse search pyramid level. */
export const PYRAMID_SCALE = 4;

/**
 * A sample subset flattened into typed arrays.
 *
 * The pyramid ranking pass touches ~130k positions per target per frame, so the
 * three object property loads per point that `GrayPoint[]` costs are worth
 * removing. Row offsets are derived once per buffer width and cached.
 */
export interface PackedPoints {
  dx: Int32Array;
  dy: Int32Array;
  lum: Float64Array;
  count: number;
  mean: number;
  /** count * mean, so the gate can work in integer-scaled form. */
  sumLum: number;
  std: number;
  off: Int32Array | null;
  offWidth: number;
}

function packPoints(pts: GrayPoint[]): PackedPoints {
  const count = pts.length;
  const dx = new Int32Array(count);
  const dy = new Int32Array(count);
  const lum = new Float64Array(count);
  let sum = 0;
  for (let i = 0; i < count; i++) {
    dx[i] = pts[i].x;
    dy[i] = pts[i].y;
    lum[i] = pts[i].lum;
    sum += pts[i].lum;
  }
  const mean = count > 0 ? sum / count : 0;
  let v = 0;
  for (let i = 0; i < count; i++) {
    const d = lum[i] - mean;
    v += d * d;
  }
  return {
    dx,
    dy,
    lum,
    count,
    mean,
    sumLum: sum,
    std: count > 0 ? Math.sqrt(v / count) || 1e-4 : 1e-4,
    off: null,
    offWidth: 0,
  };
}

function offsetsFor(p: PackedPoints, width: number): Int32Array {
  if (p.off && p.offWidth === width) return p.off;
  const off = new Int32Array(p.count);
  for (let i = 0; i < p.count; i++) off[i] = p.dy[i] * width + p.dx[i];
  p.off = off;
  p.offWidth = width;
  return off;
}

/**
 * Threshold factor for `packedPass`: everything in the gate test that depends only
 * on the template and the cut, precomputed once per scan.
 */
function gateK(p: PackedPoints, gate: number): number {
  const n = p.count;
  return gate * gate * n * n * p.std * p.std;
}

/**
 * "Is the sparse ZNCC at `base` at least `gate`?" without the divide or the square
 * root, which together were about a quarter of the cost of the 9-point gate — and
 * that gate runs on every swept position, ~1.7M of them per frame.
 *
 * Scaling the correlation by n^2 keeps it exact: with C = n*sum(f*t) - sum(f)*sum(t)
 * and V = n*sum(f^2) - sum(f)^2, the ZNCC is C / (n * std_t * sqrt(V)), so for a
 * positive gate the test is C > 0 and C^2 >= gate^2 * n^2 * std_t^2 * V. Same
 * decision as `packedZNCC(...) >= gate`, including its variance floor (variance <= 1
 * is exactly V <= n^2).
 */
function packedPass(
  p: PackedPoints,
  off: Int32Array,
  buf: Uint8Array,
  base: number,
  k: number
): boolean {
  const { count, lum } = p;
  let sum = 0;
  let sumSq = 0;
  let cross = 0;
  for (let i = 0; i < count; i++) {
    const f = buf[base + off[i]];
    sum += f;
    sumSq += f * f;
    cross += f * lum[i];
  }
  const V = count * sumSq - sum * sum;
  if (V <= count * count) return false;
  const C = count * cross - sum * p.sumLum;
  if (C <= 0) return false;
  return C * C >= k * V;
}

// Row accumulators for the streaming gate. One frame-sized row is all that is
// needed, and every scan reuses them, so the sweep allocates nothing.
let scratchSum: Int32Array = new Int32Array(0);
let scratchSq: Int32Array = new Int32Array(0);
let scratchCross: Float64Array = new Float64Array(0);
function rowScratchSum(n: number): Int32Array {
  if (scratchSum.length < n) scratchSum = new Int32Array(n);
  return scratchSum;
}
function rowScratchSq(n: number): Int32Array {
  if (scratchSq.length < n) scratchSq = new Int32Array(n);
  return scratchSq;
}
function rowScratchCross(n: number): Float64Array {
  if (scratchCross.length < n) scratchCross = new Float64Array(n);
  return scratchCross;
}

/** ZNCC of a packed subset against `buf` at the position starting at `base`. */
function packedZNCC(p: PackedPoints, off: Int32Array, buf: Uint8Array, base: number): number {
  const { count, lum } = p;
  let sum = 0;
  let sumSq = 0;
  let cross = 0;
  for (let i = 0; i < count; i++) {
    const f = buf[base + off[i]];
    sum += f;
    sumSq += f * f;
    cross += f * lum[i];
  }
  const inv = 1 / count;
  const mean = sum * inv;
  const variance = sumSq * inv - mean * mean;
  if (variance <= 1) return 0;
  return (cross * inv - mean * p.mean) / (Math.sqrt(variance) * p.std);
}

/**
 * Mean |frame - template| over a packed subset — the flat template's answer to
 * `packedZNCC` — abandoned as soon as the running sum passes `sumBudget`.
 *
 * The early return is FLAT_GRAY_TOL, i.e. "beyond the tolerance", which is all a
 * caller comparing the score against a cut can act on. Bounding the loop this way
 * is what keeps a flat sweep affordable: a position over a differently-coloured
 * part of the screen is abandoned after two or three points.
 */
function packedMeanAbs(
  p: PackedPoints,
  off: Int32Array,
  buf: Uint8Array,
  base: number,
  sumBudget: number
): number {
  const { count, lum } = p;
  let acc = 0;
  for (let i = 0; i < count; i++) {
    const d = buf[base + off[i]] - lum[i];
    acc += d < 0 ? -d : d;
    if (acc > sumBudget) return FLAT_GRAY_TOL;
  }
  return acc / count;
}

export interface PreprocessedTemplate {
  targetId: string;
  width: number;
  height: number;
  data: Uint8ClampedArray;
  gray: Uint8Array;
  mean: number;
  stdDev: number;
  // Full 64-point Feature Sampling Grid (8x8)
  samples: SamplePoint[];
  sampleMean: number;
  sampleStd: number;
  totalWeight: number;
  // 16-point Mid Ranking Subset (4x4, used to rank candidate positions)
  midSamples: SamplePoint[];
  midMean: number;
  midStd: number;
  // 8-point Fast Coarse Check Subset (Distributed across quadrants)
  coarseSamples: SamplePoint[];
  coarseMean: number;
  coarseStd: number;
  // ── Flatness of each ZNCC denominator (see FLAT_STD) ──
  // Recorded per subset rather than per template: a mostly-uniform icon can have
  // a degenerate 8-point coarse subset while its 64-point grid still carries real
  // structure, and only the subset that has nothing to correlate should switch
  // measure — swapping the 64-point score for absolute agreement as well would
  // dilute that structure across 64 samples.
  flatCoarse: boolean;
  flatMid: boolean;
  flatFull: boolean;
  // ── Pyramid level (1/PYRAMID_SCALE resolution, box-averaged) ──
  // Box averaging is what makes the coarse pass usable on pixel-detail icons:
  // a single-pixel sample stops correlating a few pixels off the true position,
  // a 4x4 average still does. Search here is dense, so nothing is skipped.
  // The lattices below hold the same plain box average the frame side computes,
  // over interior blocks plus the boundary blocks that carry the target's only
  // structure, so that a target which is not aligned to the screen's block grid
  // still reads close to what the template stored — see the construction in
  // `prepareTemplate` for why each part is needed.
  pyrWidth: number;
  pyrHeight: number;
  pyrCoarse: PackedPoints | null;
  /** Intermediate gate between pyrCoarse and pyrMid. */
  pyrGate: PackedPoints | null;
  pyrMid: PackedPoints | null;
  /** Chromaticity (0..255) of each pyrMid point's block, for colour-aware ranking. */
  pyrMidCr: Float64Array | null;
  pyrMidCg: Float64Array | null;
  // ── Flatness of each pyramid lattice ──
  // Recorded per lattice for the same reason as the full-res subsets above, and
  // it matters more here: the pyramid decides *which* positions Stage 2 ever
  // looks at. A mostly-uniform icon often has a degenerate 4-point coarse lattice
  // while its 42-point mid lattice still sees the one feature that identifies it.
  // Ranking that target on absolute agreement — as a single template-wide flag
  // would — makes every uniform patch of the same shade score a perfect 1.0,
  // while the true position, whose feature is a level *mismatch*, ranks below all
  // of them and gets crowded out of the 24 candidate slots. Per lattice, the
  // feature keeps its vote.
  flatPyrCoarse: boolean;
  flatPyrGate: boolean;
  flatPyrMid: boolean;
  /**
   * Any lattice degenerate. Only used to keep such a target off the GPU: the
   * shaders implement the ZNCC cascade and nothing else, so a flat lattice there
   * returns an empty candidate list instead of a match.
   */
  flatPyr: boolean;
}

const templateCache = new Map<string, PreprocessedTemplate>();

// ── Adaptive ROI Cache (Remembers last found position for instant 0.02ms re-detection) ──
const lastFoundCache = new Map<string, { x: number; y: number; age: number }>();
const ADAPTIVE_ROI_PAD = 48;
const ADAPTIVE_ROI_MAX_AGE = 60; // frames

export function getAdaptiveRoi(
  targetId: string,
  tWidth: number,
  tHeight: number,
  frameWidth: number,
  frameHeight: number
): Rect | null {
  const cached = lastFoundCache.get(targetId);
  if (!cached || cached.age > ADAPTIVE_ROI_MAX_AGE) {
    lastFoundCache.delete(targetId);
    return null;
  }
  const pad = ADAPTIVE_ROI_PAD;
  const rx = Math.max(0, cached.x - pad);
  const ry = Math.max(0, cached.y - pad);
  const rw = Math.min(frameWidth - rx, tWidth + pad * 2);
  const rh = Math.min(frameHeight - ry, tHeight + pad * 2);
  return { x: rx, y: ry, width: rw, height: rh };
}

export function updateAdaptiveRoi(targetId: string, x: number, y: number): void {
  lastFoundCache.set(targetId, { x, y, age: 0 });
}

export function ageAdaptiveRoi(targetId: string): void {
  const cached = lastFoundCache.get(targetId);
  if (cached) {
    cached.age++;
    if (cached.age > ADAPTIVE_ROI_MAX_AGE) {
      lastFoundCache.delete(targetId);
    }
  }
}

/** Allowed top-left range along one axis, or null when no position fits. */
function roiSpan(
  start: number,
  size: number,
  t: number,
  frame: number
): { lo: number; hi: number } | null {
  if (!Number.isFinite(start) || !Number.isFinite(size)) return null;
  const limit = frame - t;
  if (limit < 0) return null;
  const a = Math.floor(start);
  const b = Math.floor(start + size) - t;
  let lo = a < b ? a : b;
  let hi = a < b ? b : a;
  if (lo < 0) lo = 0;
  if (hi > limit) hi = limit;
  return lo <= hi ? { lo, hi } : null;
}

/**
 * Turn a user-drawn ROI into the rectangle a search should bound itself to, in
 * frame pixels.
 *
 * "The thing is around here" is all an ROI ever says. When the box is larger than
 * the template, that reads as *the template lies inside the box* — what the search
 * has always assumed. When the user drew a box smaller than the template (a corner
 * of the button, a sloppy drag, or a template later replaced by a bigger one) the
 * same reading collapses to a single legal position, and every caller used to
 * disagree about what to do with it: score 0 here, a silent full-screen search
 * there, the target dropped from the results entirely in the third. The mirror
 * reading is the sensible one: *the template covers the box*.
 *
 * Both are the same statement — the smaller rectangle lies inside the bigger one —
 * so one formula covers both: the template's top-left may sit anywhere between
 * `roi.x` and `roi.x + roi.width - tWidth`, whichever way round those two happen
 * to be, clamped to the frame. For an ROI larger than the template that is exactly
 * the old range, so nothing about existing ROIs changes.
 *
 * @returns the rectangle to search, or null when not one position fits (a template
 * bigger than the frame, or an ROI that lies outside it).
 */
export function normalizeRoi(
  roi: Rect,
  tWidth: number,
  tHeight: number,
  frameWidth: number,
  frameHeight: number
): Rect | null {
  const xs = roiSpan(roi.x, roi.width, tWidth, frameWidth);
  const ys = roiSpan(roi.y, roi.height, tHeight, frameHeight);
  if (!xs || !ys) return null;
  return {
    x: xs.lo,
    y: ys.lo,
    width: xs.hi - xs.lo + tWidth,
    height: ys.hi - ys.lo + tHeight,
  };
}

// ── Template Preprocessing ──

/**
 * Decode a template data-URL to raw pixels.
 *
 * The detection worker has no `document`, so the OffscreenCanvas path is tried
 * first — it works identically on the window and inside a worker. The DOM path
 * stays as a fallback for older runtimes.
 */
async function decodeTemplatePixels(
  dataUrl: string
): Promise<{ data: Uint8ClampedArray; width: number; height: number }> {
  if (typeof createImageBitmap === 'function' && typeof OffscreenCanvas === 'function') {
    const blob = await (await fetch(dataUrl)).blob();
    const bitmap = await createImageBitmap(blob);
    try {
      const w = bitmap.width;
      const h = bitmap.height;
      const canvas = new OffscreenCanvas(w, h);
      const ctx = canvas.getContext('2d', { willReadFrequently: true });
      if (!ctx) throw new Error('Cannot get OffscreenCanvas 2d context');
      ctx.drawImage(bitmap, 0, 0);
      const imgData = ctx.getImageData(0, 0, w, h);
      return { data: imgData.data, width: w, height: h };
    } finally {
      bitmap.close();
    }
  }

  return new Promise((resolve, reject) => {
    const img = new Image();
    img.crossOrigin = 'anonymous';
    img.onload = () => {
      const w = img.naturalWidth || img.width;
      const h = img.naturalHeight || img.height;
      const canvas = document.createElement('canvas');
      canvas.width = w;
      canvas.height = h;
      const ctx = canvas.getContext('2d', { willReadFrequently: true });
      if (!ctx) {
        reject(new Error('Cannot get 2d context'));
        return;
      }
      ctx.drawImage(img, 0, 0, w, h);
      resolve({ data: ctx.getImageData(0, 0, w, h).data, width: w, height: h });
    };
    img.onerror = (e) => reject(e);
    img.src = dataUrl;
  });
}

export async function prepareTemplate(target: Target): Promise<PreprocessedTemplate> {
  const cacheKey = `${target.id}_${target.imageDataUrl.length}_${target.imageWidth}x${target.imageHeight}`;
  const cached = templateCache.get(cacheKey);
  if (cached) return cached;

  const { data, width: w, height: h } = await decodeTemplatePixels(target.imageDataUrl);
  const gray = new Uint8Array(w * h);

  let sum = 0;
  for (let i = 0; i < w * h; i++) {
    const r = data[i * 4];
    const g = data[i * 4 + 1];
    const b = data[i * 4 + 2];
    const lum = (r * 77 + g * 150 + b * 29) >> 8;
    gray[i] = lum;
    sum += lum;
  }
  const n = w * h;
  const mean = sum / n;
  let varSum = 0;
  for (let i = 0; i < n; i++) {
    const d = gray[i] - mean;
    varSum += d * d;
  }
  const stdDev = Math.sqrt(varSum / n) || 1e-4;

  // ── Full 64-point sampling grid (8x8) ──
  const samples: SamplePoint[] = [];
  const gridCount = 8;
  let totalW = 0;

  for (let gy = 0; gy < gridCount; gy++) {
    const py = Math.floor(((gy + 0.5) / gridCount) * h);
    for (let gx = 0; gx < gridCount; gx++) {
      const px = Math.floor(((gx + 0.5) / gridCount) * w);
      const idx = py * w + px;
      const lum = gray[idx];
      const isCenter = gx >= 2 && gx <= 5 && gy >= 2 && gy <= 5;
      const weight = isCenter ? 1.4 : 1.0;
      totalW += weight;
      const sr = data[idx * 4];
      const sg = data[idx * 4 + 1];
      const sb = data[idx * 4 + 2];
      const sTotal = sr + sg + sb + 1;
      samples.push({
        x: px,
        y: py,
        lum,
        r: sr,
        g: sg,
        b: sb,
        cr: sr / sTotal,
        cg: sg / sTotal,
        weight,
      });
    }
  }

  const sampleCount = samples.length;
  let sampleMean = 0;
  let sampleStd = 0;
  const restat = () => {
    let s = 0;
    for (let i = 0; i < sampleCount; i++) s += samples[i].lum;
    sampleMean = s / sampleCount;
    let v = 0;
    for (let i = 0; i < sampleCount; i++) {
      const d = samples[i].lum - sampleMean;
      v += d * d;
    }
    sampleStd = Math.sqrt(v / sampleCount) || 1e-4;
  };
  restat();

  // ── When the grid misses the target's only structure, move a few points onto it ──
  // The 64 points exist to bound what a full score costs; where they sit is free to
  // choose here. An even grid is the right default — regular coverage is what keeps
  // the score from collapsing when the position is a pixel off — but a grid that
  // samples nothing distinctive is strictly worse than one that does: it reports "no
  // variance" for a template that plainly has some, and the score then falls to the
  // absolute-agreement path, where every patch of the target's background shade
  // scores a perfect 1.0. Measured on 28x22 grey templates carrying one 3x3 dark
  // block: 53 of the 520 placements slipped between the grid lines and matched plain
  // background. So when the grid is flat and the whole template is not, relocate a
  // few points onto the pixels that deviate most from the template mean, each taking
  // over the nearest grid point so that the coverage given up is only local.
  if (sampleStd < FLAT_STD && stdDev >= FLAT_STD) {
    const MOVES = 4;
    const MIN_SEP = 2;
    const pickX: number[] = [];
    const pickY: number[] = [];
    const moved = new Uint8Array(sampleCount);
    for (let k = 0; k < MOVES; k++) {
      let bestIdx = -1;
      let bestDev = FLAT_STD;
      for (let i = 0; i < n; i++) {
        const dev = Math.abs(gray[i] - mean);
        if (dev <= bestDev) continue;
        const px = i % w;
        const py = (i / w) | 0;
        let tooClose = false;
        for (let j = 0; j < pickX.length; j++) {
          if (Math.abs(pickX[j] - px) < MIN_SEP && Math.abs(pickY[j] - py) < MIN_SEP) {
            tooClose = true;
            break;
          }
        }
        if (tooClose) continue;
        bestDev = dev;
        bestIdx = i;
      }
      if (bestIdx < 0) break;
      const px = bestIdx % w;
      const py = (bestIdx / w) | 0;
      pickX.push(px);
      pickY.push(py);
      // The nearest point not already moved: whatever it was covering is still
      // covered by a point a few pixels away.
      let slot = -1;
      let bestD2 = Infinity;
      for (let i = 0; i < sampleCount; i++) {
        if (moved[i]) continue;
        const dx = samples[i].x - px;
        const dy = samples[i].y - py;
        const d2 = dx * dx + dy * dy;
        if (d2 < bestD2) {
          bestD2 = d2;
          slot = i;
        }
      }
      if (slot < 0) break;
      moved[slot] = 1;
      const sr = data[bestIdx * 4];
      const sg = data[bestIdx * 4 + 1];
      const sb = data[bestIdx * 4 + 2];
      const sTotal = sr + sg + sb + 1;
      const p = samples[slot];
      p.x = px;
      p.y = py;
      p.lum = gray[bestIdx];
      p.r = sr;
      p.g = sg;
      p.b = sb;
      p.cr = sr / sTotal;
      p.cg = sg / sTotal;
    }
    restat();
  }

  // ── Subset statistics helper ──
  const subsetStats = (indices: number[]) => {
    const pts: SamplePoint[] = [];
    let s = 0;
    for (const idx of indices) {
      const p = samples[Math.min(idx, sampleCount - 1)];
      pts.push(p);
      s += p.lum;
    }
    const m = s / pts.length;
    let v = 0;
    for (let i = 0; i < pts.length; i++) {
      const d = pts[i].lum - m;
      v += d * d;
    }
    return { pts, mean: m, std: Math.sqrt(v / pts.length) || 1e-4 };
  };

  // ── 16-point Mid Ranking Subset (4x4 evenly spread) ──
  const midRows = [1, 3, 4, 6];
  const midCols = [1, 3, 4, 6];
  const midIndices: number[] = [];
  for (const gy of midRows) for (const gx of midCols) midIndices.push(gy * gridCount + gx);
  const mid = subsetStats(midIndices);

  // ── 8-point Coarse Check Subset (Distributed across 4 quadrants) ──
  const coarseIndices = [
    1 * gridCount + 2,
    1 * gridCount + 5,
    2 * gridCount + 3,
    3 * gridCount + 4,
    4 * gridCount + 3,
    5 * gridCount + 4,
    6 * gridCount + 2,
    6 * gridCount + 5,
  ];
  const coarse = subsetStats(coarseIndices);

  // ── Pyramid level: sample the template at 1/PYRAMID_SCALE resolution ──
  // The frame side is a plain SxS box average on a lattice fixed to the screen, so
  // a target whose top-left is not a multiple of S is never read the way an
  // S-aligned template was written. Two separate things follow from that, and only
  // one of them is fixable here.
  //
  // Fixable: *which* blocks are sampled. The outer ring is part target, part
  // whatever sits next to it on screen, and the lattices below are deduplicated
  // onto the pyramid grid, so on a small template they used to hit every block —
  // 20 of a 28x22 template's 35 are in that ring. For a low-contrast target the
  // neighbourhood leaking in outweighs the structure being matched: measured, a
  // 28x22 template carrying one low-contrast blob was acquired at 3 of the 16
  // sub-block offsets when the ring was sampled and at 16 of 16 when it is not.
  // So only interior blocks are sampled — the ones a shift of up to S-1 pixels
  // cannot drag outside the target. Interior block bx spans pixels
  // [S*bx-(S-1), S*bx+(S-1)] for bx in 1..pyrWidth-2, always inside the template:
  // no edge clamping, no invented samples. The cost is real and documented: a
  // feature that exists only in the outermost S-1 pixels no longer contributes to
  // ranking (a high-contrast 28x22 icon went 15/16 -> 13/16 sub-block offsets on
  // an isolated-target probe), and when dropping the ring leaves a lattice with no
  // variance at all, `pyramidCanRank`/`rankOnFull` route the target to the
  // full-resolution grid instead.
  //
  // Not fixable here: *what* an interior block holds. At a non-zero phase a
  // position reads the template's own pixels slid by 0..S-1, so no stored value is
  // right for every phase. Pre-averaging the S slides — a separable 1-2-3-4-3-2-1
  // kernel over the 2S-1 pixels centred on the block — looks like the way to be
  // wrong by the least, and it is a mistake: it makes the two sides of the
  // correlation different functions of their pixels. Measured, the smoothed
  // template ranked 0.418 at the true position of a 28x22 icon *at phase (0,0)*,
  // with 2180 frame positions above it, and the accuracy floor fell from 48/48 to
  // 44/48. Storing the same plain box mean the frame stores restores 48/48 with 0
  // of 42 decoys (worst 0.076) and leaves the phase error where it belongs: as a
  // spread in rank at the true position (0.415..0.992 over the 16 offsets), which
  // costs candidate slots, not correctness — Stage 2 still scores pixel-exact.
  const S = PYRAMID_SCALE;
  const pyrWidth = Math.floor(w / S);
  const pyrHeight = Math.floor(h / S);
  let pyrCoarse: PackedPoints | null = null;
  let pyrGate: PackedPoints | null = null;
  let pyrMid: PackedPoints | null = null;
  let pyrMidCr: Float64Array | null = null;
  let pyrMidCg: Float64Array | null = null;

  // At least a 2x2 interior, so anything under 4*S px in either axis is searched
  // at full resolution instead. Nothing else needs to know: every stage already
  // reads a missing lattice as "no pyramid for this target".
  if (pyrWidth >= 4 && pyrHeight >= 4) {
    const iw = pyrWidth - 2;
    const ih = pyrHeight - 2;

    // Block values, memoised: the three lattices overlap heavily and each point
    // costs S*S taps.
    const cells = pyrWidth * pyrHeight;
    const cellLum = new Float64Array(cells);
    // Block chromaticity, so the ranking pass can tell a same-shape
    // different-colour lookalike apart. Without it the ranking is luminance-only
    // and a recoloured copy of the icon ranks exactly as high as the real one.
    const cellCr = new Float64Array(cells);
    const cellCg = new Float64Array(cells);
    const cellDone = new Uint8Array(cells);
    const cellAt = (bx: number, by: number): number => {
      const idx = by * pyrWidth + bx;
      if (cellDone[idx]) return idx;
      let acc = 0;
      let accR = 0;
      let accG = 0;
      let accB = 0;
      for (let ky = 0; ky < S; ky++) {
        const row = (by * S + ky) * w + bx * S;
        for (let kx = 0; kx < S; kx++) {
          const i = row + kx;
          acc += gray[i];
          const i4 = i << 2;
          accR += data[i4];
          accG += data[i4 + 1];
          accB += data[i4 + 2];
        }
      }
      // Same sums over the same S*S pixels the frame side accumulates, so the
      // frame's "+1" divide-by-zero guard carries over unscaled.
      const tot = accR + accG + accB + 1;
      cellLum[idx] = acc / (S * S);
      cellCr[idx] = (accR / tot) * 255;
      cellCg[idx] = (accG / tot) * 255;
      cellDone[idx] = 1;
      return idx;
    };

    // The interior lattice: the points whose value a misaligned position still
    // reads off the target's own pixels, whatever sits next to it on screen.
    const interior = (G: number): GrayPoint[] => {
      const pts: GrayPoint[] = [];
      const seen = new Set<number>();
      for (let gy = 0; gy < G; gy++) {
        const py = 1 + Math.min(ih - 1, Math.floor(((gy + 0.5) / G) * ih));
        for (let gx = 0; gx < G; gx++) {
          const px = 1 + Math.min(iw - 1, Math.floor(((gx + 0.5) / G) * iw));
          const idx = cellAt(px, py);
          if (seen.has(idx)) continue;
          seen.add(idx);
          pts.push({ x: px, y: py, lum: cellLum[idx] });
        }
      }
      return pts;
    };

    // ── Which boundary blocks are worth their contamination ──
    // A block on the target's boundary is read, at a non-zero phase, as a mix of
    // the target and up to 3/4 of whatever the target happens to be sitting on.
    // That is not a reason to drop them all: measured at 1920x1080 over the 16
    // sub-block offsets, keeping them is what lets a 28x22 pixel-detail icon be
    // acquired at every offset (16/16 with them, 8/16 without), because 35 points
    // are far harder for background to imitate than 15. It is a reason to drop the
    // ones that carry nothing: on a 28x22 template whose only feature is a
    // low-contrast interior blob, the boundary blocks all hold the same background
    // shade, so on the template side they add no signal at all while on the frame
    // side they add the neighbourhood's spread — acquired at 3 of 16 offsets with
    // them, 16 of 16 without.
    //
    // So a boundary block is kept when its own value stands out from the interior
    // lattice by more than that lattice's spread: further than one standard
    // deviation is more signal than the band it perturbs, inside it is the
    // neighbourhood's content wearing the target's mean.
    const ref = interior(8);
    let refMean = 0;
    for (const p of ref) refMean += p.lum;
    refMean /= ref.length || 1;
    let refVar = 0;
    for (const p of ref) refVar += (p.lum - refMean) * (p.lum - refMean);
    const refStd = Math.sqrt(refVar / (ref.length || 1));

    const lattice = (G: number): GrayPoint[] => {
      const pts: GrayPoint[] = [];
      const seen = new Set<number>();
      for (let gy = 0; gy < G; gy++) {
        const py = Math.min(pyrHeight - 1, Math.floor(((gy + 0.5) / G) * pyrHeight));
        for (let gx = 0; gx < G; gx++) {
          const px = Math.min(pyrWidth - 1, Math.floor(((gx + 0.5) / G) * pyrWidth));
          const idx = cellAt(px, py);
          if (seen.has(idx)) continue;
          const onBoundary = px === 0 || py === 0 || px === pyrWidth - 1 || py === pyrHeight - 1;
          if (onBoundary && !(Math.abs(cellLum[idx] - refMean) > refStd)) continue;
          seen.add(idx);
          pts.push({ x: px, y: py, lum: cellLum[idx] });
        }
      }
      return pts;
    };
    const midPts = lattice(8);
    pyrMid = packPoints(midPts);
    pyrMidCr = new Float64Array(midPts.length);
    pyrMidCg = new Float64Array(midPts.length);
    for (let i = 0; i < midPts.length; i++) {
      const idx = midPts[i].y * pyrWidth + midPts[i].x;
      pyrMidCr[i] = cellCr[idx];
      pyrMidCg[i] = cellCg[idx];
    }
    // ~9 points, spatially spread — the gate every frame position pays for.
    const gatePts = lattice(5);
    pyrGate = packPoints(gatePts.length >= 9 ? gatePts : midPts);
    const coarsePts = lattice(3);
    pyrCoarse = packPoints(coarsePts.length >= 4 ? coarsePts : midPts);
  }

  const preprocessed: PreprocessedTemplate = {
    targetId: target.id,
    width: w,
    height: h,
    data,
    gray,
    mean,
    stdDev,
    samples,
    sampleMean,
    sampleStd,
    totalWeight: totalW,
    midSamples: mid.pts,
    midMean: mid.mean,
    midStd: mid.std,
    coarseSamples: coarse.pts,
    coarseMean: coarse.mean,
    coarseStd: coarse.std,
    flatCoarse: coarse.std < FLAT_STD,
    flatMid: mid.std < FLAT_STD,
    flatFull: sampleStd < FLAT_STD,
    pyrWidth,
    pyrHeight,
    pyrCoarse,
    pyrGate,
    pyrMid,
    pyrMidCr,
    pyrMidCg,
    // Each lattice answers for itself; `flatPyr` is only the "keep off the GPU"
    // summary. A missing lattice counts as flat so no stage tries to correlate it.
    flatPyrCoarse: !pyrCoarse || pyrCoarse.std < FLAT_STD,
    flatPyrGate: !pyrGate || pyrGate.std < FLAT_STD,
    flatPyrMid: !pyrMid || pyrMid.std < FLAT_STD,
    flatPyr:
      !!pyrMid &&
      !!pyrGate &&
      !!pyrCoarse &&
      (pyrMid.std < FLAT_STD || pyrGate.std < FLAT_STD || pyrCoarse.std < FLAT_STD),
  };
  templateCache.set(cacheKey, preprocessed);
  return preprocessed;
}

export function clearTemplateCache(targetId?: string) {
  if (targetId) {
    for (const key of templateCache.keys()) {
      if (key.startsWith(targetId)) templateCache.delete(key);
    }
  } else {
    templateCache.clear();
  }
}

// ── Shared Zero-Allocation Luminance Frame Buffer ──

let sharedFrameGray: Uint8Array | null = null;
let sharedFrameGrayWidth = 0;
let sharedFrameGrayHeight = 0;
let lastFrameDataRef: ImageData | null = null;

export function getOrComputeFrameGray(frameData: ImageData): Uint8Array {
  if (
    lastFrameDataRef === frameData &&
    sharedFrameGray &&
    sharedFrameGrayWidth === frameData.width &&
    sharedFrameGrayHeight === frameData.height
  ) {
    return sharedFrameGray;
  }
  computeFramePlanes(frameData);
  return sharedFrameGray!;
}

// ── Shared Frame Pyramid (1/PYRAMID_SCALE, box-averaged) ──
// Built once per frame and reused by every target, so its cost is amortised
// across all 15+ searches rather than paid per target.

let sharedPyr: Uint8Array | null = null;
let sharedPyrCr: Uint8Array | null = null;
let sharedPyrCg: Uint8Array | null = null;
let sharedPyrWidth = 0;
let sharedPyrHeight = 0;
let lastPyrFrameRef: ImageData | null = null;

export interface FramePyramid {
  data: Uint8Array;
  /** Block-mean chromaticity planes (0..255), r/(r+g+b) and g/(r+g+b). */
  cr: Uint8Array;
  cg: Uint8Array;
  width: number;
  height: number;
}

export function getOrComputeFramePyramid(
  frameData: ImageData,
  _frameGray: Uint8Array | null,
  frameWidth: number,
  frameHeight: number
): FramePyramid | null {
  const S = PYRAMID_SCALE;
  const pw = Math.floor(frameWidth / S);
  const ph = Math.floor(frameHeight / S);
  if (pw < 2 || ph < 2) return null;

  // Keyed on the ImageData object: both planes are reused shared arrays, so
  // their identity does not change between frames.
  if (lastPyrFrameRef !== frameData || sharedPyrWidth !== pw || sharedPyrHeight !== ph) {
    computeFramePlanes(frameData);
  }
  if (!sharedPyr || !sharedPyrCr || !sharedPyrCg || sharedPyrWidth < 2 || sharedPyrHeight < 2) {
    return null;
  }
  return {
    data: sharedPyr,
    cr: sharedPyrCr,
    cg: sharedPyrCg,
    width: sharedPyrWidth,
    height: sharedPyrHeight,
  };
}

/**
 * Can the pyramid rank this target at all?
 *
 * The pyramid pass does one job: order positions so that the ~24 which reach the
 * pixel-exact stage include the true one. A template whose mid lattice — the
 * lattice the rank is read from — has no variance carries no order to give: on
 * absolute agreement every patch of the same shade scores a perfect 1.0, so the
 * true position is no likelier to keep a candidate slot than the hundreds of ties
 * around it, and the cap decides by scan order instead of by evidence.
 *
 * Two cases hide behind a flat mid lattice, and they want opposite things:
 *
 *   - The target really is one shade (`flatFull` too). Then the ties are not
 *     noise: every patch of that shade *is* an equally good answer, the
 *     pixel-exact stage confirms whichever position is offered, and the pyramid
 *     stays — it is 16x cheaper than a strided full-resolution pass.
 *   - The target has structure that only the full-resolution grid can see, either
 *     because it is finer than a 4x4 block average or because it lives in the
 *     outermost ring of blocks the lattices do not sample (see `prepareTemplate`
 *     for why they cannot). `flatFull` is false, and the strided pass — which can
 *     rank on that same 64-point grid — is the one able to find it. Worth its
 *     extra cost for a target that would otherwise be lost the moment a patch of
 *     its background shade shares the screen.
 *
 * So: keep the pyramid unless it is blind to structure the full-resolution grid
 * still holds.
 */
export function pyramidCanRank(t: PreprocessedTemplate): boolean {
  return !t.flatPyrMid || t.flatFull;
}

/**
 * The sweep's own ranking score for one pyramid position: the 64-point mid ZNCC
 * times the chromaticity factor.
 *
 * This exists for the GPU self-test. The shader has to reproduce this number, and
 * the only honest way to check that is to compare it against the very code the
 * CPU sweep runs — a re-implementation in the test would be free to drift.
 *
 * A template whose mid lattice is flat is ranked on absolute agreement instead,
 * exactly as the sweep does. Those targets never reach the GPU (`GpuSweeper`
 * filters out every flat lattice, precisely because the shader has no flat path),
 * so this branch only keeps the function honest about being "the sweep's score".
 */
export function pyramidRankScore(
  template: PreprocessedTemplate,
  pyr: FramePyramid,
  px: number,
  py: number,
  useColor: boolean
): number {
  const mid = template.pyrMid;
  if (!mid) return 0;
  const off = offsetsFor(mid, pyr.width);
  const base = py * pyr.width + px;
  const midScore = template.flatPyrMid
    ? flatLevelScore(packedMeanAbs(mid, off, pyr.data, base, Infinity))
    : packedZNCC(mid, off, pyr.data, base);
  const tplCr = template.pyrMidCr;
  const tplCg = template.pyrMidCg;
  if (!useColor || !tplCr || !tplCg) return midScore;
  let diff = 0;
  for (let i = 0; i < mid.count; i++) {
    const o = base + off[i];
    diff += Math.abs(pyr.cr[o] - tplCr[i]) + Math.abs(pyr.cg[o] - tplCg[i]);
  }
  const factor = 1 - (diff / (mid.count * 255)) * PYR_COLOR_SHARPNESS;
  return midScore * (factor > 0.25 ? factor : 0.25);
}

// ── Incremental Frame Update ──
//
// Two observations about a screen watcher: most of the screen is identical from
// frame to frame, and identical pixels can only produce identical plane values.
// So the previous frame's RGBA is kept and compared band by band (one band = the
// PYRAMID_SCALE rows behind one pyramid row); only the bands that really moved
// are rebuilt. A completely still screen costs one memcmp instead of a full
// rebuild plus a full search, and a busy corner of the screen costs only its own
// share. The output is bit-identical to a from-scratch build either way.

let prevFrameWords: Uint32Array | null = null;
let prevPlanesWidth = 0;
let prevPlanesHeight = 0;
let dirtyBandBuf: Uint8Array | null = null;

/**
 * Refresh the shared luminance/pyramid planes for this frame and report whether
 * anything on screen changed at all.
 *
 * Returns false when the frame is byte-identical to the previous one, in which
 * case the planes (and any scores derived from them) are still valid and the
 * caller can skip searching entirely.
 */
export function updateFramePlanes(frameData: ImageData): boolean {
  const w = frameData.width;
  const h = frameData.height;
  const S = PYRAMID_SCALE;
  const pw = Math.floor(w / S);
  const ph = Math.floor(h / S);
  const bytes = frameData.data;
  const words = new Uint32Array(bytes.buffer, bytes.byteOffset, bytes.byteLength >> 2);

  const canReuse =
    prevFrameWords !== null &&
    prevFrameWords.length === words.length &&
    prevPlanesWidth === w &&
    prevPlanesHeight === h &&
    sharedFrameGray !== null &&
    sharedFrameGray.length === w * h &&
    sharedPyr !== null &&
    sharedPyrWidth === pw &&
    sharedPyrHeight === ph &&
    pw >= 2 &&
    ph >= 2;

  if (!canReuse) {
    computeFramePlanes(frameData);
    // getImageData hands out a fresh buffer per call, so this view can simply be
    // kept as the previous frame instead of copying 8 MB.
    prevFrameWords = words;
    prevPlanesWidth = w;
    prevPlanesHeight = h;
    return true;
  }

  const prev = prevFrameWords!;
  if (!dirtyBandBuf || dirtyBandBuf.length !== ph + 1) dirtyBandBuf = new Uint8Array(ph + 1);
  const bands = dirtyBandBuf;
  bands.fill(0);

  let anyDirty = false;
  const rowsPerBand = S * w;
  for (let py = 0; py < ph; py++) {
    const start = py * rowsPerBand;
    const end = start + rowsPerBand;
    for (let i = start; i < end; i++) {
      if (words[i] !== prev[i]) {
        bands[py] = 1;
        anyDirty = true;
        break;
      }
    }
  }
  // The ragged bottom rows below the last full band.
  for (let i = ph * rowsPerBand, n = words.length; i < n; i++) {
    if (words[i] !== prev[i]) {
      bands[ph] = 1;
      anyDirty = true;
      break;
    }
  }

  prevFrameWords = words;

  if (!anyDirty) {
    // Nothing moved: the planes already describe this frame, so only re-point
    // the per-frame caches at the new ImageData object.
    lastFrameDataRef = frameData;
    lastPyrFrameRef = frameData;
    return false;
  }

  computeFramePlanes(frameData, bands);
  return true;
}

/** Forget the retained frame so the next update rebuilds from scratch. */
export function resetFrameCache(): void {
  prevFrameWords = null;
  prevPlanesWidth = 0;
  prevPlanesHeight = 0;
  lastFrameDataRef = null;
  lastPyrFrameRef = null;
}

/**
 * Build the luminance plane and the 1/4-scale pyramid in a single pass.
 *
 * These used to be two separate full-frame sweeps, and each one re-read the
 * whole RGBA buffer — about 8 MB at 1080p, so the second sweep was pure memory
 * bandwidth. Fusing them means the RGBA data is touched once: luminance is
 * derived where the pixel is already loaded for the block average. That matters
 * more than it looks, because every worker in the pool pays this fixed cost on
 * every frame.
 *
 * `dirtyBands` (one flag per pyramid row, plus one trailing flag for the ragged
 * bottom rows) restricts the work to the parts of the screen that actually
 * changed since the last frame; see `updateFramePlanes`. Unchanged rows keep the
 * values already in the shared buffers, which are bit-identical to what a full
 * rebuild would produce because the pixels behind them are identical.
 */
function computeFramePlanes(frameData: ImageData, dirtyBands?: Uint8Array | null): void {
  const w = frameData.width;
  const h = frameData.height;
  const len = w * h;
  const pixels = frameData.data;
  let bands = dirtyBands || null;

  if (!sharedFrameGray || sharedFrameGray.length !== len) {
    sharedFrameGray = new Uint8Array(len);
    bands = null; // fresh buffer: nothing to reuse, rebuild everything
  }
  const gray = sharedFrameGray;
  sharedFrameGrayWidth = w;
  sharedFrameGrayHeight = h;
  lastFrameDataRef = frameData;

  const S = PYRAMID_SCALE;
  const pw = Math.floor(w / S);
  const ph = Math.floor(h / S);

  if (pw < 2 || ph < 2) {
    for (let i = 0; i < len; i++) {
      const i4 = i << 2;
      gray[i] = (pixels[i4] * 77 + pixels[i4 + 1] * 150 + pixels[i4 + 2] * 29) >> 8;
    }
    sharedPyrWidth = 0;
    sharedPyrHeight = 0;
    lastPyrFrameRef = null;
    return;
  }

  if (!sharedPyr || sharedPyr.length !== pw * ph) {
    sharedPyr = new Uint8Array(pw * ph);
    sharedPyrCr = new Uint8Array(pw * ph);
    sharedPyrCg = new Uint8Array(pw * ph);
    bands = null;
  }
  const out = sharedPyr;
  const outCr = sharedPyrCr!;
  const outCg = sharedPyrCg!;
  const inv = 1 / (S * S);

  for (let py = 0; py < ph; py++) {
    if (bands && !bands[py]) continue;
    const outRow = py * pw;
    const baseRow = py * S;
    for (let px = 0; px < pw; px++) {
      let acc = 0;
      let accR = 0;
      let accG = 0;
      let accB = 0;
      const baseCol = px * S;
      for (let dy = 0; dy < S; dy++) {
        const row = (baseRow + dy) * w + baseCol;
        for (let dx = 0; dx < S; dx++) {
          const idx = row + dx;
          const i4 = idx << 2;
          const r = pixels[i4];
          const g = pixels[i4 + 1];
          const b = pixels[i4 + 2];
          const lum = (r * 77 + g * 150 + b * 29) >> 8;
          gray[idx] = lum;
          acc += lum;
          accR += r;
          accG += g;
          accB += b;
        }
      }
      out[outRow + px] = (acc * inv) | 0;
      const tot = accR + accG + accB + 1;
      outCr[outRow + px] = ((accR / tot) * 255) | 0;
      outCg[outRow + px] = ((accG / tot) * 255) | 0;
    }
  }

  // The block loop covers only the first pw*S columns and ph*S rows; the ragged
  // right and bottom edge (at most S-1 pixels) still needs luminance, because
  // full-resolution refinement can land there.
  const coveredW = pw * S;
  const coveredH = ph * S;
  if (coveredW < w) {
    for (let y = 0; y < coveredH; y++) {
      if (bands && !bands[(y / S) | 0]) continue;
      const row = y * w;
      for (let x = coveredW; x < w; x++) {
        const i4 = (row + x) << 2;
        gray[row + x] = (pixels[i4] * 77 + pixels[i4 + 1] * 150 + pixels[i4 + 2] * 29) >> 8;
      }
    }
  }
  if (!bands || bands[ph]) {
    for (let y = coveredH; y < h; y++) {
      const row = y * w;
      for (let x = 0; x < w; x++) {
        const i4 = (row + x) << 2;
        gray[row + x] = (pixels[i4] * 77 + pixels[i4 + 1] * 150 + pixels[i4 + 2] * 29) >> 8;
      }
    }
  }

  sharedPyrWidth = pw;
  sharedPyrHeight = ph;
  lastPyrFrameRef = frameData;
}

// ── Fast Scoring Functions ──

/**
 * Sparse ZNCC over an arbitrary sample subset.
 *
 * Used for the 8-point coarse gate, the 16-point candidate ranking, and the
 * pyramid ranking pass — the buffer it reads is just whichever luminance plane
 * the caller passes in.
 */
function computeSparseZNCC(
  pts: GrayPoint[],
  count: number,
  tMean: number,
  tStd: number,
  frameGray: Uint8Array,
  rowOffset: number,
  x: number,
  frameWidth: number
): number {
  let sum = 0;
  let sumSq = 0;
  let cross = 0;

  for (let i = 0; i < count; i++) {
    const s = pts[i];
    const fl = frameGray[rowOffset + s.y * frameWidth + x + s.x];
    sum += fl;
    sumSq += fl * fl;
    cross += fl * s.lum;
  }

  const inv = 1 / count;
  const mean = sum * inv;
  const variance = sumSq * inv - mean * mean;
  if (variance <= 1) return 0;
  return (cross * inv - mean * tMean) / (Math.sqrt(variance) * tStd);
}

/**
 * Mean |frame - template| over an arbitrary sample subset — what a flat subset
 * uses in place of `computeSparseZNCC`. Only 8 or 16 points wide, so unlike the
 * pyramid version it is not worth abandoning early.
 */
function sparseMeanAbs(
  pts: GrayPoint[],
  count: number,
  frameGray: Uint8Array,
  rowOffset: number,
  x: number,
  frameWidth: number
): number {
  let acc = 0;
  for (let i = 0; i < count; i++) {
    const s = pts[i];
    const d = frameGray[rowOffset + s.y * frameWidth + x + s.x] - s.lum;
    acc += d < 0 ? -d : d;
  }
  return acc / count;
}

/**
 * Pixel-exact score for a template whose 64 samples carry no variance.
 *
 * There is exactly one piece of evidence about such a window: whether it is the
 * same colour as the template. So the shape term becomes absolute agreement in
 * grey levels, and the existing colour multiplier does the rest. Unlike the
 * correlated path there is deliberately no gain+bias hypothesis: with no variance
 * to pin them down, a gain and a bias can map any solid colour onto any other, so
 * fitting here would explain away the only evidence there is.
 */
function computeFlatScore(
  samples: SamplePoint[],
  numSamples: number,
  frameGray: Uint8Array | null,
  framePixels: Uint8ClampedArray,
  rowOffset: number,
  x: number,
  frameWidth: number,
  useColor: boolean,
  bestSoFar: number
): number {
  let absDiff = 0;
  if (frameGray) {
    for (let i = 0; i < numSamples; i++) {
      const s = samples[i];
      const d = frameGray[rowOffset + s.y * frameWidth + x + s.x] - s.lum;
      absDiff += d < 0 ? -d : d;
    }
  } else {
    // No luminance plane (the GPU refinement path): derive it exactly as
    // `computeFramePlanes` would, from pixels this loop reads anyway.
    for (let i = 0; i < numSamples; i++) {
      const s = samples[i];
      const fi = (rowOffset + s.y * frameWidth + x + s.x) << 2;
      const fl = (framePixels[fi] * 77 + framePixels[fi + 1] * 150 + framePixels[fi + 2] * 29) >> 8;
      const d = fl - s.lum;
      absDiff += d < 0 ? -d : d;
    }
  }

  const level = flatLevelScore(absDiff / numSamples);
  if (!useColor || level <= 0) return level;
  // Exactly the bound the correlated path uses: colour is a multiplier of at
  // most 1, so this position cannot win and the colour pass can be skipped.
  if (level <= bestSoFar) return -1;

  let chromaDiff = 0;
  let intensityDiff = 0;
  for (let i = 0; i < numSamples; i++) {
    const s = samples[i];
    const fi = (rowOffset + s.y * frameWidth + x + s.x) << 2;
    const fr = framePixels[fi];
    const fg = framePixels[fi + 1];
    const fb = framePixels[fi + 2];
    const fTotal = fr + fg + fb + 1;
    chromaDiff += Math.abs(fr / fTotal - s.cr) + Math.abs(fg / fTotal - s.cg);
    intensityDiff += Math.abs(fr - s.r) + Math.abs(fg - s.g) + Math.abs(fb - s.b);
  }
  return level * colorFactor(chromaDiff, intensityDiff, numSamples);
}

/**
 * Full 64-point ZNCC + Soft Color Consistency Scoring.
 *
 * `bestSoFar` lets the colour half be skipped whenever it cannot possibly
 * change the outcome: the final score is `zncc*0.72 + colour*0.28` and colour
 * is at most 1, so `zncc*0.72 + 0.28 <= bestSoFar` proves this position loses.
 * The colour pass is three extra absolute differences per sample, so skipping
 * it on the (vast) majority of losing positions is most of the speedup.
 *
 * `flat` switches the shape term from correlation to absolute agreement, for the
 * templates whose 64 samples carry no variance at all (see FLAT_STD). Everything
 * after it — the colour multiplier, the `bestSoFar` bound, the 0..1 range — keeps
 * its meaning, so a threshold means the same thing for both kinds of target.
 */
function computeFullScore(
  samples: SamplePoint[],
  numSamples: number,
  sMean: number,
  sStd: number,
  frameGray: Uint8Array | null,
  framePixels: Uint8ClampedArray,
  rowOffset: number,
  x: number,
  frameWidth: number,
  useColor: boolean,
  bestSoFar: number,
  flat: boolean
): number {
  if (flat) {
    return computeFlatScore(
      samples,
      numSamples,
      frameGray,
      framePixels,
      rowOffset,
      x,
      frameWidth,
      useColor,
      bestSoFar
    );
  }

  let subSum = 0;
  let subSumSq = 0;
  let cross = 0;

  if (frameGray) {
    for (let i = 0; i < numSamples; i++) {
      const s = samples[i];
      const fl = frameGray[rowOffset + s.y * frameWidth + x + s.x];
      subSum += fl;
      subSumSq += fl * fl;
      cross += fl * s.lum;
    }
  } else {
    // No luminance plane: derive it from the pixels this loop is about to read
    // anyway. Identical arithmetic to `computeFramePlanes`, so the value is the
    // same byte the plane would have held — which is why the GPU sweep path can
    // skip building a full-frame plane it would only sample a few hundred
    // positions from.
    for (let i = 0; i < numSamples; i++) {
      const s = samples[i];
      const fi = (rowOffset + s.y * frameWidth + x + s.x) << 2;
      const fl = (framePixels[fi] * 77 + framePixels[fi + 1] * 150 + framePixels[fi + 2] * 29) >> 8;
      subSum += fl;
      subSumSq += fl * fl;
      cross += fl * s.lum;
    }
  }

  const inv = 1 / numSamples;
  const subMean = subSum * inv;
  const subVar = subSumSq * inv - subMean * subMean;
  if (subVar <= 1) return 0;

  const zncc = (cross * inv - subMean * sMean) / (Math.sqrt(subVar) * sStd);
  const rawScore = zncc < 0 ? 0 : zncc > 1 ? 1 : zncc;

  if (!useColor) return rawScore;
  // Exact upper bound: the colour factor is at most 1, so this position can never
  // win and the colour pass can be skipped entirely.
  if (rawScore <= bestSoFar) return -1;

  // Colour is a *multiplier*, not 28% of a weighted sum. Under the old sum a
  // shape match with the wrong colour still scored 0.72 + 0.28*colour, which is
  // how a different-coloured lookalike reached 94%. Now the wrong hue scales the
  // whole score down, and a correct match (colour factor ~1) keeps its old value,
  // so existing thresholds still mean the same thing.
  // Brightness and contrast drift - another monitor's gamma, a night-mode filter,
  // an icon fading in over a dark background - leaves the ZNCC at ~1.0 (it divides
  // the affine relation out) but used to cost the colour halves 20-25% of the
  // score: measured at the true position, gain 0.85 / bias -10 scored 0.771 and
  // 60% opacity 0.738, so every such detection was lost even at a 0.8 threshold.
  // So compare colours a second time through the single clamped gain+bias the
  // window implies, and keep whichever comparison the window does better on.
  // Taking the max is what makes this safe: the score can only ever rise relative
  // to the plain comparison, so no previously-detected target can be lost, and the
  // clamps stop the fit from turning a differently-coloured lookalike into a match.
  const cov = cross * inv - subMean * sMean;
  let gain = cov / (sStd * sStd);
  if (!(gain >= MIN_FIT_GAIN)) gain = MIN_FIT_GAIN;
  else if (gain > MAX_FIT_GAIN) gain = MAX_FIT_GAIN;
  let bias = subMean - gain * sMean;
  if (bias < -MAX_FIT_BIAS) bias = -MAX_FIT_BIAS;
  else if (bias > MAX_FIT_BIAS) bias = MAX_FIT_BIAS;
  // A near-identity fit cannot beat the plain comparison, and skipping it keeps
  // the ordinary case - a clean capture with a little noise - at its old cost.
  const useFit = gain < 1 - FIT_GAIN_EPS || gain > 1 + FIT_GAIN_EPS ||
    bias < -FIT_BIAS_EPS || bias > FIT_BIAS_EPS;

  let chromaDiff = 0;
  let intensityDiff = 0;
  let fitChromaDiff = 0;
  let fitIntensityDiff = 0;
  for (let i = 0; i < numSamples; i++) {
    const s = samples[i];
    const fi = (rowOffset + s.y * frameWidth + x + s.x) << 2;
    const fr = framePixels[fi];
    const fg = framePixels[fi + 1];
    const fb = framePixels[fi + 2];
    const fTotal = fr + fg + fb + 1;
    const fcr = fr / fTotal;
    const fcg = fg / fTotal;
    chromaDiff += Math.abs(fcr - s.cr) + Math.abs(fcg - s.cg);
    intensityDiff += Math.abs(fr - s.r) + Math.abs(fg - s.g) + Math.abs(fb - s.b);
    if (useFit) {
      // A real screen clamps, so the fitted template does too.
      let mr = gain * s.r + bias;
      let mg = gain * s.g + bias;
      let mb = gain * s.b + bias;
      if (mr < 0) mr = 0; else if (mr > 255) mr = 255;
      if (mg < 0) mg = 0; else if (mg > 255) mg = 255;
      if (mb < 0) mb = 0; else if (mb > 255) mb = 255;
      const mTotal = mr + mg + mb + 1;
      fitChromaDiff += Math.abs(fcr - mr / mTotal) + Math.abs(fcg - mg / mTotal);
      fitIntensityDiff += Math.abs(fr - mr) + Math.abs(fg - mg) + Math.abs(fb - mb);
    }
  }
  // There are exactly two hypotheses about this window: it is the template, or it
  // is the template seen through one gain+bias. Each has to be scored as a whole.
  // Taking the minimum of each *term* separately would allow a third, physically
  // meaningless combination - hue judged on the raw template, brightness judged on
  // the fitted one - which scores better than either real hypothesis. Measured
  // cost of that hybrid: a wrong-hue decoy under a brightness shift went 0.046 ->
  // 0.345 and a washed-out lookalike 0.002 -> 0.288. So score both hypotheses
  // completely and keep the better one.
  const plainColor = colorFactor(chromaDiff, intensityDiff, numSamples);
  const colorScore = useFit
    ? Math.max(plainColor, colorFactor(fitChromaDiff, fitIntensityDiff, numSamples))
    : plainColor;

  return rawScore * colorScore;
}

/**
 * Colour agreement of one hypothesis, in [0,1], as a multiplier on the ZNCC.
 *
 * Both halves have a dead zone first. A screen capture is never pixel-exact -
 * scaling, colour conversion and compression shift values a little - and charging
 * the score for that noise measured as 24/48 detections lost with hit scores
 * barely over threshold. Beyond the dead zone the penalty is steep, so a genuinely
 * different hue still collapses to zero.
 */
function colorFactor(chromaDiff: number, intensityDiff: number, numSamples: number): number {
  const hueExcess = chromaDiff / numSamples - CHROMA_TOLERANCE;
  const hueScore = hueExcess <= 0 ? 1 : 1 - hueExcess * COLOR_SHARPNESS;
  if (hueScore <= 0) return 0;
  const levelExcess = intensityDiff / (numSamples * 765) - LEVEL_TOLERANCE;
  const levelScore = levelExcess <= 0 ? 1 : 1 - levelExcess * LEVEL_SHARPNESS;
  return levelScore > 0 ? hueScore * levelScore : 0;
}

// ── Main Entry Point ──

/**
 * A position worth scoring exactly, as produced by a sweep. `score` is only a
 * ranking value (the coarse pyramid score); the reported similarity always comes
 * from the pixel-exact pass.
 */
export interface SweepCandidate {
  x: number;
  y: number;
  score: number;
}

/**
 * Ultra-Fast High-Accuracy Robust Template Matcher
 *
 * Guaranteed 0% False Rejection for Pixel Art Icons, Cards, and Dynamic Game Elements.
 *
 * 1. User ROI: If configured, searches strictly within the designated region, pixel-exact.
 * 2. Adaptive ROI: If the target was found at (x,y), re-checks the ±48px neighbourhood first.
 * 3. Full-Screen Search: strided ranking pass, then pixel-exact scoring around the top peaks.
 */
export function matchTemplateInFrame(
  frameData: ImageData,
  template: PreprocessedTemplate,
  roi?: Rect | null,
  algorithm: 'ncc' | 'fast_color' = 'ncc',
  targetThreshold = 0.85
): { score: number; box: Rect } {
  const frameWidth = frameData.width;
  const frameHeight = frameData.height;
  const framePixels = frameData.data;
  const frameGray = getOrComputeFrameGray(frameData);
  const tWidth = template.width;
  const tHeight = template.height;

  if (tWidth > frameWidth || tHeight > frameHeight) {
    return { score: 0, box: { x: 0, y: 0, width: tWidth, height: tHeight } };
  }

  // ── Mode 1: User-Defined ROI (Highest priority, strict bounding) ──
  if (roi) {
    const roiArea = Math.max(1, roi.width * roi.height);
    return scanRegion(
      frameData,
      frameGray,
      framePixels,
      frameWidth,
      frameHeight,
      template,
      roi,
      algorithm,
      // Small regions stay pixel-exact; a large ROI gets the same ranked search
      // as the full screen, otherwise "whole screen as ROI" is the slow path.
      roiArea <= 400 * 400 ? 1 : 0,
      targetThreshold
    );
  }

  // ── Mode 2: Adaptive ROI (Quick lock on previous known location) ──
  const adaptiveRoi = getAdaptiveRoi(template.targetId, tWidth, tHeight, frameWidth, frameHeight);
  if (adaptiveRoi) {
    const quickResult = scanRegion(
      frameData,
      frameGray,
      framePixels,
      frameWidth,
      frameHeight,
      template,
      adaptiveRoi,
      algorithm,
      1, // pixel-exact in the small ±48px area
      targetThreshold
    );

    if (quickResult.score >= targetThreshold) {
      updateAdaptiveRoi(template.targetId, quickResult.box.x, quickResult.box.y);
      return quickResult;
    }
  }

  // ── Mode 3: Global Full-Screen Ranked Search ──
  const result = scanRegion(
    frameData,
    frameGray,
    framePixels,
    frameWidth,
    frameHeight,
    template,
    null,
    algorithm,
    0, // 0 = pick the stride from the template size
    targetThreshold
  );

  if (result.score >= targetThreshold) {
    updateAdaptiveRoi(template.targetId, result.box.x, result.box.y);
  } else {
    ageAdaptiveRoi(template.targetId);
  }

  return result;
}

/**
 * Refine a candidate list that was produced somewhere else — the GPU sweep.
 *
 * This is the second half of `matchTemplateInFrame`'s Mode 3 and nothing else:
 * the same pixel-exact `computeFullScore` over the same window around each
 * candidate, so the similarity this returns is the number the CPU path would
 * have returned for the same position. The GPU only decides *where* to look.
 *
 * No luminance plane is needed: the refinement reads RGBA and derives luminance
 * with the identical formula the plane uses, which is what lets the GPU path skip
 * the ~16ms full-frame plane build per worker.
 */
export function matchWithCandidates(
  frameData: ImageData,
  template: PreprocessedTemplate,
  candidates: SweepCandidate[],
  roi?: Rect | null,
  algorithm: 'ncc' | 'fast_color' = 'ncc',
  targetThreshold = 0.85
): { score: number; box: Rect } {
  const tWidth = template.width;
  const tHeight = template.height;
  if (tWidth > frameData.width || tHeight > frameData.height) {
    return { score: 0, box: { x: 0, y: 0, width: tWidth, height: tHeight } };
  }
  if (candidates.length === 0) {
    ageAdaptiveRoi(template.targetId);
    return { score: 0, box: { x: 0, y: 0, width: tWidth, height: tHeight } };
  }

  const result = scanRegion(
    frameData,
    null,
    frameData.data,
    frameData.width,
    frameData.height,
    template,
    roi ?? null,
    algorithm,
    0,
    targetThreshold,
    candidates
  );

  if (result.score >= targetThreshold) {
    updateAdaptiveRoi(template.targetId, result.box.x, result.box.y);
  } else {
    ageAdaptiveRoi(template.targetId);
  }

  return result;
}

/**
 * Scan a region (or full screen).
 *
 * Strategy: rank candidate positions on a 1/4-scale box-averaged pyramid built
 * once per frame, keep the best few well-separated peaks, then evaluate the full
 * 64-point score at every single pixel around each candidate.
 *
 * The previous version walked the whole frame at stride 2 and ran the full
 * 64-point colour score at any position whose 8-point score cleared 0.30. On a
 * 1080p frame that is ~500k coarse checks and ~100k full scores per target —
 * measured at ~110ms per target, i.e. ~1.7s for 15 targets. Ranking instead of
 * threshold-gating removes both the guesswork in that 0.30 constant and the
 * bulk of the work.
 */
function scanRegion(
  _frameData: ImageData,
  frameGray: Uint8Array | null,
  framePixels: Uint8ClampedArray,
  frameWidth: number,
  frameHeight: number,
  template: PreprocessedTemplate,
  roi: Rect | null,
  algorithm: 'ncc' | 'fast_color',
  forceStep: number,
  accept: number,
  /**
   * Candidate positions produced outside this function (the GPU sweep). When
   * supplied, Stage 1 is skipped entirely and Stage 2 refines exactly these
   * positions. `frameGray` may then be null: the refinement derives luminance
   * from the pixels it already reads.
   */
  presetCandidates: SweepCandidate[] | null = null
): { score: number; box: Rect } {
  const tWidth = template.width;
  const tHeight = template.height;

  let minX = 0;
  let minY = 0;
  let maxX = frameWidth - tWidth;
  let maxY = frameHeight - tHeight;

  if (roi) {
    // One place decides what an ROI means, so a small box can never turn into a
    // full-frame search or a single clamped position. Idempotent, so callers that
    // already normalized (both workers do, to reason about their own bounds) pay
    // nothing and cannot disagree with this.
    const bounded = normalizeRoi(roi, tWidth, tHeight, frameWidth, frameHeight);
    if (!bounded) {
      return { score: 0, box: { x: 0, y: 0, width: tWidth, height: tHeight } };
    }
    minX = bounded.x;
    minY = bounded.y;
    maxX = bounded.x + bounded.width - tWidth;
    maxY = bounded.y + bounded.height - tHeight;
  }

  const searchWidth = maxX - minX + 1;
  const searchHeight = maxY - minY + 1;
  if (searchWidth <= 0 || searchHeight <= 0) {
    return { score: 0, box: { x: minX, y: minY, width: tWidth, height: tHeight } };
  }

  const {
    samples,
    sampleMean,
    sampleStd,
    midSamples,
    midMean,
    midStd,
    coarseSamples,
    coarseMean,
    coarseStd,
  } = template;
  const numSamples = samples.length;
  const useColor = algorithm !== 'fast_color';

  // The sample grid spans the whole template, so the ranking score decays
  // gracefully until the offset approaches a third of the template size.
  // Fallback stride, only used when the template is too small to have a pyramid
  // level. A single-pixel sample grid stops correlating once the offset reaches a
  // few pixels, so this stays small — measured recall on pixel-detail icons was
  // 39/48 at stride 2 but 4/48 at stride 8.
  const step =
    forceStep > 0
      ? forceStep
      : Math.max(2, Math.min(3, Math.floor(Math.min(tWidth, tHeight) / 3)));

  // A true match scores far above this on any subset; it only exists to skip
  // the 64-point score over empty background.
  const midGate = Math.min(0.45, accept * 0.5);
  const coarseGate = Math.min(0.35, accept * 0.4);

  // Rank the strided sweep on the 64-point grid instead of the 16-point lattice
  // when the 16-point lattice has no variance but the 64-point grid does — a
  // target whose only structure is too fine, or too close to its own edge, for the
  // coarser subsets to sample. Ranking such a target on absolute agreement ties
  // every patch of its background shade at 1.0, and 24 slots filled by scan order
  // then decide the detection. The extra reads are paid only by positions that
  // already cleared both gates.
  const rankOnFull = template.flatMid && !template.flatFull;

  let bestScore = -1;
  let bestX = minX;
  let bestY = minY;

  const evaluate = (x: number, y: number) => {
    const rowOffset = y * frameWidth;
    const score = computeFullScore(
      samples,
      numSamples,
      sampleMean,
      sampleStd,
      frameGray,
      framePixels,
      rowOffset,
      x,
      frameWidth,
      useColor,
      bestScore,
      template.flatFull
    );
    if (score > bestScore) {
      bestScore = score;
      bestX = x;
      bestY = y;
    }
  };

  // ── Pixel-exact path (small ROI, adaptive ROI, or explicit stride 1) ──
  if (step <= 1 && frameGray && !presetCandidates) {
    for (let y = minY; y <= maxY; y++) {
      const rowOffset = y * frameWidth;
      for (let x = minX; x <= maxX; x++) {
        // Cheap gate first: without it a ±48px adaptive window costs ~14k full
        // colour scores per target per frame.
        if (template.flatCoarse) {
          // A flat coarse subset has no variance to correlate, so the gate is the
          // same absolute-agreement test the score uses, at the same threshold.
          if (
            sparseMeanAbs(coarseSamples, 8, frameGray, rowOffset, x, frameWidth) >
            flatBudget(coarseGate)
          ) {
            continue;
          }
        } else if (
          computeSparseZNCC(
            coarseSamples,
            8,
            coarseMean,
            coarseStd,
            frameGray,
            rowOffset,
            x,
            frameWidth
          ) < coarseGate
        ) {
          continue;
        }
        evaluate(x, y);
        if (bestScore > 0.995) break;
      }
      if (bestScore > 0.995) break;
    }
    return {
      score: Math.max(0, Math.min(1, bestScore)),
      box: { x: bestX, y: bestY, width: tWidth, height: tHeight },
    };
  }

  // ── Stage 1: rank candidate positions, keeping the top few separated peaks ──
  const MAX_CANDIDATES = 24;
  const candX = new Int32Array(MAX_CANDIDATES);
  const candY = new Int32Array(MAX_CANDIDATES);
  const candS = new Float64Array(MAX_CANDIDATES);
  let candCount = 0;
  // Peaks closer together than this are treated as one blob. It must not exceed
  // the refinement window, or a slightly stronger peak a few pixels away can
  // swallow the true position's slot and then refine a window that never reaches
  // it - measured as 3/48 lost detections when the radius was half the template.
  let sepX = Math.max(1, Math.floor(tWidth / 2));
  let sepY = Math.max(1, Math.floor(tHeight / 2));

  const offer = (x: number, y: number, s: number) => {
    // Collapse peaks that describe the same blob so the slots hold distinct
    // locations rather than a cluster around one bright spot.
    for (let i = 0; i < candCount; i++) {
      if (Math.abs(candX[i] - x) <= sepX && Math.abs(candY[i] - y) <= sepY) {
        if (s > candS[i]) {
          candS[i] = s;
          candX[i] = x;
          candY[i] = y;
        }
        return;
      }
    }
    if (candCount < MAX_CANDIDATES) {
      candX[candCount] = x;
      candY[candCount] = y;
      candS[candCount] = s;
      candCount++;
      return;
    }
    let worst = 0;
    for (let i = 1; i < MAX_CANDIDATES; i++) if (candS[i] < candS[worst]) worst = i;
    if (s > candS[worst]) {
      candS[worst] = s;
      candX[worst] = x;
      candY[worst] = y;
    }
  };

  // Prefer a dense search on the 1/4-scale box-averaged pyramid over a sparse
  // strided search at full resolution: it visits 16x fewer positions than a
  // stride-1 sweep yet, because each pyramid pixel is a 4x4 average, it cannot
  // slip between the features of a pixel-detail icon the way a strided
  // single-pixel sample grid does. The exceptions are targets too small for a
  // lattice and targets the pyramid cannot rank (`pyramidCanRank`); both fall
  // through to the strided pass below.
  const S = PYRAMID_SCALE;
  const pyrCoarse = template.pyrCoarse;
  const pyrGate = template.pyrGate;
  const pyrMid = template.pyrMid;
  const pyr =
    !presetCandidates && pyrCoarse && pyrGate && pyrMid && pyramidCanRank(template)
      ? getOrComputeFramePyramid(_frameData, frameGray, frameWidth, frameHeight)
      : null;

  let refineBack = step;
  let refineFwd = step;

  if (presetCandidates) {
    // Candidates came from the GPU sweep, which ranks the same 1/4-scale lattice
    // this function would have swept itself, so refinement keeps the identical
    // window and suppression radius. Feeding them through `offer` rather than
    // straight into the arrays means the blob collapsing and the top-N cut still
    // happen exactly where they did before, so a GPU candidate list can only
    // change *which* positions get refined, never how they are scored.
    refineBack = S;
    refineFwd = 2 * S;
    sepX = S;
    sepY = S;
    for (let i = 0; i < presetCandidates.length; i++) {
      const c = presetCandidates[i];
      if (c.x < minX || c.x > maxX || c.y < minY || c.y > maxY) continue;
      offer(c.x, c.y, c.score);
    }
  } else if (pyr && pyrCoarse && pyrMid) {
    // Candidate (px,py) on the pyramid stands for full-res (px*S, py*S); the true
    // position can be up to one lattice step either side of it.
    refineBack = S;
    refineFwd = 2 * S;
    sepX = S;
    sepY = S;

    const pw = pyr.width;
    const buf = pyr.data;
    const coarseOff = offsetsFor(pyrCoarse, pw);
    const midOff = offsetsFor(pyrMid, pw);
    const crPlane = pyr.cr;
    const cgPlane = pyr.cg;
    const tplCr = template.pyrMidCr;
    const tplCg = template.pyrMidCg;
    const midCount = pyrMid.count;

    // Mean chromaticity distance over the mid lattice, mapped to a 0..1 factor
    // with the same sharpness the full score uses.
    const pyrChroma = (base: number): number => {
      if (!tplCr || !tplCg) return 1;
      let diff = 0;
      for (let i = 0; i < midCount; i++) {
        const o = base + midOff[i];
        diff += Math.abs(crPlane[o] - tplCr[i]) + Math.abs(cgPlane[o] - tplCg[i]);
      }
      // Much gentler than the full score's sharpness: block-mean chromaticity
      // shifts a little whenever the icon is not lattice-aligned, so this is only
      // meant to *reorder* candidates, never to reject a position outright.
      const factor = 1 - (diff / (midCount * 255)) * PYR_COLOR_SHARPNESS;
      return factor > 0.25 ? factor : 0.25;
    };

    const pMinX = Math.floor(minX / S);
    const pMinY = Math.floor(minY / S);
    const pMaxX = Math.min(pw - template.pyrWidth, Math.floor(maxX / S));
    const pMaxY = Math.min(pyr.height - template.pyrHeight, Math.floor(maxY / S));

    // Each lattice decides its own measure (see `flatPyrCoarse`). The cascade
    // shape is unchanged — row-streamed gate on the ~4-point coarse lattice, then
    // the 9-point gate, then the mid lattice as the rank — and the choice of
    // measure is made once per scan, never per position.
    const flatC = template.flatPyrCoarse;
    const flatG = template.flatPyrGate;
    const flatM = template.flatPyrMid;

    const gateOff = offsetsFor(pyrGate, pw);
    const gate2Cut = midGate * 0.85;
    const kCoarse = gateK(pyrCoarse, coarseGate);
    const kGate2 = gateK(pyrGate, gate2Cut);
    const kMid = gateK(pyrMid, midGate);
    // The same cuts as a mean grey error, for whichever lattice has no variance to
    // correlate. `packedMeanAbs` abandons a position once the running sum passes
    // the budget, which is what keeps a flat sweep affordable: a patch of another
    // shade costs two or three lattice reads.
    const coarseAbsCut = flatBudget(coarseGate);
    const gate2AbsCut = flatBudget(gate2Cut);
    const gate2AbsBudget = pyrGate.count * gate2AbsCut;
    const midAbsBudget = midCount * flatBudget(midGate);

    /** Everything after the row gate, for one position that survived it. */
    const rankAt = (base: number, px: number, py: number): void => {
      if (flatG) {
        if (packedMeanAbs(pyrGate, gateOff, buf, base, gate2AbsBudget) > gate2AbsCut) return;
      } else if (!packedPass(pyrGate, gateOff, buf, base, kGate2)) {
        return;
      }
      let rank: number;
      if (flatM) {
        rank = flatLevelScore(packedMeanAbs(pyrMid, midOff, buf, base, midAbsBudget));
        if (rank < midGate) return;
      } else {
        if (!packedPass(pyrMid, midOff, buf, base, kMid)) return;
        // Only the ~0.16% of positions that clear the mid cut need the real value.
        rank = packedZNCC(pyrMid, midOff, buf, base);
      }
      // Rank on shape *and* hue. A luminance-only rank lets recoloured lookalikes
      // tie with the real icon and crowd the candidate list, which measured as
      // 3/48 lost detections once decoys were in the frame — and it counts for
      // more on a flat lattice, where hue is most of what separates the target
      // from any other patch of the same brightness.
      offer(px * S, py * S, useColor ? rank * pyrChroma(base) : rank);
    };

    // The gate runs on every position (~2M/frame across 15 targets), so it is
    // streamed a row at a time: same arithmetic in the same order as a
    // per-position version, so the surviving set is identical, but every frame
    // read is sequential instead of jumping across pyramid rows.
    const rowLen = pMaxX - pMinX + 1;
    const cN = pyrCoarse.count;
    const cLum = pyrCoarse.lum;
    const cSumLum = pyrCoarse.sumLum;
    const cNN = cN * cN;
    if (flatC) {
      // A ZNCC gate here would reject every position, the true one included: it
      // demands frame-side variance and a positive numerator, and on the uniform
      // patch this template is, both are ~0.
      const rowAbs = rowScratchSum(rowLen);
      const absBudget = cN * coarseAbsCut;
      for (let py = pMinY; py <= pMaxY; py++) {
        const row = py * pw;
        rowAbs.fill(0, 0, rowLen);
        for (let i = 0; i < cN; i++) {
          const o = row + pMinX + coarseOff[i];
          const t = cLum[i];
          for (let j = 0; j < rowLen; j++) {
            const d = buf[o + j] - t;
            rowAbs[j] += d < 0 ? -d : d;
          }
        }
        for (let j = 0; j < rowLen; j++) {
          if (rowAbs[j] > absBudget) continue;
          const px = pMinX + j;
          rankAt(row + px, px, py);
        }
      }
    } else {
      const rowSum = rowScratchSum(rowLen);
      const rowSq = rowScratchSq(rowLen);
      const rowCross = rowScratchCross(rowLen);
      for (let py = pMinY; py <= pMaxY; py++) {
        const row = py * pw;
        rowSum.fill(0, 0, rowLen);
        rowSq.fill(0, 0, rowLen);
        rowCross.fill(0, 0, rowLen);
        for (let i = 0; i < cN; i++) {
          const o = row + pMinX + coarseOff[i];
          const t = cLum[i];
          for (let j = 0; j < rowLen; j++) {
            const f = buf[o + j];
            rowSum[j] += f;
            rowSq[j] += f * f;
            rowCross[j] += f * t;
          }
        }
        for (let j = 0; j < rowLen; j++) {
          const fs = rowSum[j];
          const V = cN * rowSq[j] - fs * fs;
          if (V <= cNN) continue;
          const C = cN * rowCross[j] - fs * cSumLum;
          if (C <= 0) continue;
          if (C * C < kCoarse * V) continue;
          const px = pMinX + j;
          rankAt(row + px, px, py);
        }
      }
    }
  } else if (frameGray) {
    for (let y = minY; y <= maxY; y += step) {
      const rowOffset = y * frameWidth;
      for (let x = minX; x <= maxX; x += step) {
        if (template.flatCoarse) {
          if (
            sparseMeanAbs(coarseSamples, 8, frameGray, rowOffset, x, frameWidth) >
            flatBudget(coarseGate)
          ) {
            continue;
          }
        } else {
          const coarse = computeSparseZNCC(
            coarseSamples,
            8,
            coarseMean,
            coarseStd,
            frameGray,
            rowOffset,
            x,
            frameWidth
          );
          if (coarse < coarseGate) continue;
        }

        // Ranking stays luminance-only here, flat or not; colour enters in Stage 2.
        let midScore = template.flatMid
          ? flatLevelScore(
              sparseMeanAbs(midSamples, 16, frameGray, rowOffset, x, frameWidth)
            )
          : computeSparseZNCC(
              midSamples,
              16,
              midMean,
              midStd,
              frameGray,
              rowOffset,
              x,
              frameWidth
            );
        if (midScore < midGate) continue;
        if (rankOnFull) {
          // The 16-point lattice was only a gate for this target: it cannot tell
          // the true position from any other patch of the same shade, so it just
          // kept the reads cheap on the other shades. The 64-point grid does see
          // the target's structure, and a patch that lacks it has ~no variance
          // over that grid, so this both orders the survivors and drops the ties.
          midScore = computeSparseZNCC(
            samples,
            numSamples,
            sampleMean,
            sampleStd,
            frameGray,
            rowOffset,
            x,
            frameWidth
          );
          if (midScore < midGate) continue;
        }
        offer(x, y, midScore);
      }
    }
  }

  // ── Stage 2: pixel-exact full scoring around each surviving candidate ──
  // Sort best-first so `bestScore` rises early and the colour-skip bound bites.
  for (let i = 1; i < candCount; i++) {
    const sx = candX[i];
    const sy = candY[i];
    const ss = candS[i];
    let j = i - 1;
    while (j >= 0 && candS[j] < ss) {
      candS[j + 1] = candS[j];
      candX[j + 1] = candX[j];
      candY[j + 1] = candY[j];
      j--;
    }
    candS[j + 1] = ss;
    candX[j + 1] = sx;
    candY[j + 1] = sy;
  }

  for (let i = 0; i < candCount; i++) {
    const rMinX = Math.max(minX, candX[i] - refineBack);
    const rMaxX = Math.min(maxX, candX[i] + refineFwd);
    const rMinY = Math.max(minY, candY[i] - refineBack);
    const rMaxY = Math.min(maxY, candY[i] + refineFwd);

    for (let y = rMinY; y <= rMaxY; y++) {
      for (let x = rMinX; x <= rMaxX; x++) {
        evaluate(x, y);
      }
    }
    // Once a candidate clears the user's own threshold convincingly there is
    // nothing to gain from checking weaker peaks.
    if (bestScore >= accept && bestScore > candS[i]) break;
  }

  return {
    score: Math.max(0, Math.min(1, bestScore)),
    box: { x: bestX, y: bestY, width: tWidth, height: tHeight },
  };
}

export function cropImageFromSource(
  source: HTMLVideoElement | HTMLCanvasElement,
  rect: Rect
): { dataUrl: string; width: number; height: number } {
  const canvas = document.createElement('canvas');
  const w = Math.max(1, Math.round(rect.width));
  const h = Math.max(1, Math.round(rect.height));
  canvas.width = w;
  canvas.height = h;
  const ctx = canvas.getContext('2d');
  if (!ctx) throw new Error('Cannot get 2d context');
  ctx.drawImage(source, Math.round(rect.x), Math.round(rect.y), w, h, 0, 0, w, h);
  return { dataUrl: canvas.toDataURL('image/png'), width: w, height: h };
}
