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
  // ── Pyramid level (1/PYRAMID_SCALE resolution, box-averaged) ──
  // Box averaging is what makes the coarse pass usable on pixel-detail icons:
  // a single-pixel sample stops correlating a few pixels off the true position,
  // a 4x4 average still does. Search here is dense, so nothing is skipped.
  pyrWidth: number;
  pyrHeight: number;
  pyrCoarse: PackedPoints | null;
  /** Intermediate gate between pyrCoarse and pyrMid. */
  pyrGate: PackedPoints | null;
  pyrMid: PackedPoints | null;
  /** Chromaticity (0..255) of each pyrMid point's block, for colour-aware ranking. */
  pyrMidCr: Float64Array | null;
  pyrMidCg: Float64Array | null;
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
  let sSum = 0;
  let totalW = 0;

  for (let gy = 0; gy < gridCount; gy++) {
    const py = Math.floor(((gy + 0.5) / gridCount) * h);
    for (let gx = 0; gx < gridCount; gx++) {
      const px = Math.floor(((gx + 0.5) / gridCount) * w);
      const idx = py * w + px;
      const lum = gray[idx];
      const isCenter = gx >= 2 && gx <= 5 && gy >= 2 && gy <= 5;
      const weight = isCenter ? 1.4 : 1.0;
      sSum += lum;
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
  const sampleMean = sSum / sampleCount;
  let sVarSum = 0;
  for (let i = 0; i < sampleCount; i++) {
    const d = samples[i].lum - sampleMean;
    sVarSum += d * d;
  }
  const sampleStd = Math.sqrt(sVarSum / sampleCount) || 1e-4;

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

  // ── Pyramid level: box-average the template down by PYRAMID_SCALE ──
  // Blocks are aligned to the same lattice the frame pyramid uses, so a template
  // whose top-left lands on a multiple of PYRAMID_SCALE correlates exactly, and
  // the intermediate phases degrade smoothly instead of falling off a cliff.
  const S = PYRAMID_SCALE;
  const pyrWidth = Math.floor(w / S);
  const pyrHeight = Math.floor(h / S);
  let pyrCoarse: PackedPoints | null = null;
  let pyrGate: PackedPoints | null = null;
  let pyrMid: PackedPoints | null = null;
  let pyrMidCr: Float64Array | null = null;
  let pyrMidCg: Float64Array | null = null;

  if (pyrWidth >= 2 && pyrHeight >= 2) {
    const pyr = new Uint8Array(pyrWidth * pyrHeight);
    // Block-mean chromaticity, so the ranking pass can tell a same-shape
    // different-colour lookalike apart. Without it the ranking is luminance-only
    // and a recoloured copy of the icon ranks exactly as high as the real one.
    const pyrCr = new Uint8Array(pyrWidth * pyrHeight);
    const pyrCg = new Uint8Array(pyrWidth * pyrHeight);
    const inv = 1 / (S * S);
    for (let py = 0; py < pyrHeight; py++) {
      for (let px = 0; px < pyrWidth; px++) {
        let acc = 0;
        let accR = 0;
        let accG = 0;
        let accB = 0;
        for (let dy = 0; dy < S; dy++) {
          const row = (py * S + dy) * w + px * S;
          for (let dx = 0; dx < S; dx++) {
            acc += gray[row + dx];
            const i4 = (row + dx) << 2;
            accR += data[i4];
            accG += data[i4 + 1];
            accB += data[i4 + 2];
          }
        }
        const idx = py * pyrWidth + px;
        pyr[idx] = Math.round(acc * inv);
        const tot = accR + accG + accB + 1;
        pyrCr[idx] = Math.round((accR / tot) * 255);
        pyrCg[idx] = Math.round((accG / tot) * 255);
      }
    }

    const lattice = (G: number): GrayPoint[] => {
      const pts: GrayPoint[] = [];
      const seen = new Set<number>();
      for (let gy = 0; gy < G; gy++) {
        const py = Math.min(pyrHeight - 1, Math.floor(((gy + 0.5) / G) * pyrHeight));
        for (let gx = 0; gx < G; gx++) {
          const px = Math.min(pyrWidth - 1, Math.floor(((gx + 0.5) / G) * pyrWidth));
          const idx = py * pyrWidth + px;
          if (seen.has(idx)) continue;
          seen.add(idx);
          pts.push({ x: px, y: py, lum: pyr[idx] });
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
      pyrMidCr[i] = pyrCr[idx];
      pyrMidCg[i] = pyrCg[idx];
    }
    // ~9 points, spatially spread — the gate every frame position pays for.
    const gatePts = lattice(5);
    pyrGate = packPoints(gatePts.length >= 9 ? gatePts : lattice(8));
    const coarsePts = lattice(3);
    pyrCoarse = packPoints(coarsePts.length >= 4 ? coarsePts : lattice(8));
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
    pyrWidth,
    pyrHeight,
    pyrCoarse,
    pyrGate,
    pyrMid,
    pyrMidCr,
    pyrMidCg,
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
 * The sweep's own ranking score for one pyramid position: the 64-point mid ZNCC
 * times the chromaticity factor.
 *
 * This exists for the GPU self-test. The shader has to reproduce this number, and
 * the only honest way to check that is to compare it against the very code the
 * CPU sweep runs — a re-implementation in the test would be free to drift.
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
  const midScore = packedZNCC(mid, off, pyr.data, base);
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
 * Full 64-point ZNCC + Soft Color Consistency Scoring.
 *
 * `bestSoFar` lets the colour half be skipped whenever it cannot possibly
 * change the outcome: the final score is `zncc*0.72 + colour*0.28` and colour
 * is at most 1, so `zncc*0.72 + 0.28 <= bestSoFar` proves this position loses.
 * The colour pass is three extra absolute differences per sample, so skipping
 * it on the (vast) majority of losing positions is most of the speedup.
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
  bestSoFar: number
): number {
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

  // Both halves have a dead zone first. A screen capture is never pixel-exact -
  // scaling, colour conversion and compression shift values a little - and
  // charging the score for that noise measured as 24/48 detections lost with hit
  // scores barely over threshold. Beyond the dead zone the penalty is steep, so a
  // genuinely different hue still collapses to zero.
  const meanChroma = chromaDiff / numSamples;
  const hueExcess = meanChroma - CHROMA_TOLERANCE;
  const hueScore = hueExcess <= 0 ? 1 : 1 - hueExcess * COLOR_SHARPNESS;
  if (hueScore <= 0) return 0;
  const meanIntensity = intensityDiff / (numSamples * 765);
  const levelExcess = meanIntensity - LEVEL_TOLERANCE;
  const levelScore = levelExcess <= 0 ? 1 : 1 - levelExcess * LEVEL_SHARPNESS;
  const colorScore = hueScore * (levelScore > 0 ? levelScore : 0);

  return rawScore * colorScore;
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
    minX = Math.max(0, Math.min(frameWidth - tWidth, Math.floor(roi.x)));
    minY = Math.max(0, Math.min(frameHeight - tHeight, Math.floor(roi.y)));
    maxX = Math.max(minX, Math.min(frameWidth - tWidth, Math.floor(roi.x + roi.width - tWidth)));
    maxY = Math.max(minY, Math.min(frameHeight - tHeight, Math.floor(roi.y + roi.height - tHeight)));
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
      bestScore
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
        if (
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
  // single-pixel sample grid does.
  const S = PYRAMID_SCALE;
  const pyrCoarse = template.pyrCoarse;
  const pyrGate = template.pyrGate;
  const pyrMid = template.pyrMid;
  const pyr =
    !presetCandidates &&
    pyrCoarse &&
    pyrGate &&
    pyrMid &&
    template.pyrWidth >= 2 &&
    template.pyrHeight >= 2
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

    // Ranking a position used to jump straight from the 9-point gate to the
    // 64-point mid score, and the ~10% of positions that pass the gate made that
    // 64-point pass the single most expensive stage of the sweep. A 25-point
    // intermediate gate rejects most of them for a third of the work.
    const gateOff = offsetsFor(pyrGate, pw);
    const gate2Cut = midGate * 0.85;
    // The 9-point gate runs on every position (~2M/frame across 15 targets), so
    // everything after it must stay rare. Positions that clear it used to jump
    // straight to the 64-point mid score; a 25-point intermediate gate throws
    // out 90% of them for a third of the work.
    for (let py = pMinY; py <= pMaxY; py++) {
      const row = py * pw;
      for (let px = pMinX; px <= pMaxX; px++) {
        const base = row + px;
        if (packedZNCC(pyrCoarse, coarseOff, buf, base) < coarseGate) continue;
        if (packedZNCC(pyrGate, gateOff, buf, base) < gate2Cut) continue;
        const midScore = packedZNCC(pyrMid, midOff, buf, base);
        if (midScore < midGate) continue;
        // Rank on shape *and* hue. A luminance-only rank lets recoloured
        // lookalikes tie with the real icon and crowd the candidate list, which
        // measured as 3/48 lost detections once decoys were in the frame.
        offer(px * S, py * S, useColor ? midScore * pyrChroma(base) : midScore);
      }
    }
  } else if (frameGray) {
    for (let y = minY; y <= maxY; y += step) {
      const rowOffset = y * frameWidth;
      for (let x = minX; x <= maxX; x += step) {
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

        const midScore = computeSparseZNCC(
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
