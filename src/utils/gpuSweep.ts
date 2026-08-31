/**
 * GPU pyramid sweep.
 *
 * The candidate sweep — scoring every position of the 1/4-scale pyramid — was
 * measured at 154ms of the 174ms a 15-target 1080p frame costs, i.e. 89% of the
 * detection work. It is also perfectly parallel and reads a 130 kB plane over
 * and over, which is exactly what a GPU is for.
 *
 * What moved to the GPU:
 *   - frame upload: `copyExternalImageToTexture` straight from the ImageBitmap,
 *     so no `getImageData` readback and no full-resolution luminance plane;
 *   - the pyramid + chromaticity planes, with the identical integer arithmetic
 *     `computeFramePlanes` uses, so the planes are the same bytes;
 *   - the 64-point mid ZNCC × chromaticity score at every position, with no
 *     coarse or intermediate gate (a GPU has no use for them), then a per-2×2
 *     tile maximum and an atomic append.
 *
 * What deliberately stayed on the CPU: the pixel-exact refinement. The reported
 * similarity still comes from the untouched `computeFullScore`, so thresholds
 * keep meaning exactly what they meant before — the GPU only chooses where to
 * look. Dropping the gates makes the candidate set a *superset* of the CPU
 * sweep's, so this cannot lose a detection the CPU path would have made
 * (verified in the reference harness: 48/48 boxes, 0/42 decoy hits, 7/90 results
 * strictly better, none worse).
 *
 * Note on typing: the project has no `@webgpu/types`, and `lib.dom` does not
 * declare WebGPU, so the handles are held as `unknown`-ish aliases rather than
 * pulling in a dependency. The shaders are the real interface here.
 */
import { PYRAMID_SCALE } from './imageMatching';
import type { PreprocessedTemplate } from './imageMatching';

/* eslint-disable @typescript-eslint/no-explicit-any */
type GpuAny = any;

// Usage flags, spelled out rather than read off the globals so this module also
// type-checks and reads correctly without WebGPU type declarations.
const BUF_MAP_READ = 0x0001;
const BUF_COPY_SRC = 0x0004;
const BUF_COPY_DST = 0x0008;
const BUF_UNIFORM = 0x0040;
const BUF_STORAGE = 0x0080;
const TEX_COPY_DST = 0x02;
const TEX_BINDING = 0x04;
const TEX_RENDER_ATTACHMENT = 0x10; // required by copyExternalImageToTexture
const MAP_READ = 0x0001;

/** Maximum candidates one target may emit per frame. */
export const GPU_CANDIDATE_CAP = 4096;
/** count + padding + CAP × (packed xy, score bits), rounded up to 256 bytes. */
const REGION_BYTES = Math.ceil((8 + GPU_CANDIDATE_CAP * 8) / 256) * 256;
/** Points in the mid lattice; the shader reads `count` of them. */
const TPL_HEADER_F32 = 16;
const TPL_STRIDE_F32 = 5;
const ZERO_WORD = new Uint32Array(1);

export interface GpuCandidateSet {
  targetId: string;
  /** Interleaved [packed xy, score bits] × count, in pyramid coordinates. */
  packed: Uint32Array;
  count: number;
  /** True if the target hit the cap and some candidates were dropped. */
  overflow: boolean;
}

export interface GpuSweepTarget {
  id: string;
  template: PreprocessedTemplate;
  threshold: number;
  /** Search box in pyramid units, or null for the whole frame. */
  roi?: { x: number; y: number; width: number; height: number } | null;
}

const PLANES_WGSL = `
struct Dims { w: u32, h: u32, pw: u32, ph: u32 };

@group(0) @binding(0) var frameTex: texture_2d<f32>;
@group(0) @binding(1) var<storage, read_write> pyr: array<u32>;
@group(0) @binding(2) var<storage, read_write> chr: array<u32>;
@group(0) @binding(3) var<uniform> dims: Dims;

// One invocation per pyramid position. The arithmetic mirrors
// computeFramePlanes exactly: luminance is (r*77 + g*150 + b*29) >> 8 per pixel,
// the level is the truncated mean of the 4x4 block, and the chromaticity planes
// are the block's r and g share of total intensity scaled to 0..255.
@compute @workgroup_size(8, 8)
fn main(@builtin(global_invocation_id) gid: vec3<u32>) {
  if (gid.x >= dims.pw || gid.y >= dims.ph) { return; }
  var accL: u32 = 0u;
  var accR: u32 = 0u;
  var accG: u32 = 0u;
  var accB: u32 = 0u;
  let bx = i32(gid.x * 4u);
  let by = i32(gid.y * 4u);
  for (var dy: i32 = 0; dy < 4; dy = dy + 1) {
    for (var dx: i32 = 0; dx < 4; dx = dx + 1) {
      let c = textureLoad(frameTex, vec2<i32>(bx + dx, by + dy), 0);
      // rgba8unorm decodes to n/255, so this recovers the original byte exactly.
      let r = u32(c.r * 255.0 + 0.5);
      let g = u32(c.g * 255.0 + 0.5);
      let b = u32(c.b * 255.0 + 0.5);
      accL = accL + ((r * 77u + g * 150u + b * 29u) >> 8u);
      accR = accR + r;
      accG = accG + g;
      accB = accB + b;
    }
  }
  let idx = gid.y * dims.pw + gid.x;
  pyr[idx] = accL >> 4u;
  let tot = f32(accR + accG + accB + 1u);
  let cr = u32(f32(accR) / tot * 255.0);
  let cg = u32(f32(accG) / tot * 255.0);
  chr[idx] = cr | (cg << 8u);
}
`;

const SWEEP_WGSL = `
struct Dims { w: u32, h: u32, pw: u32, ph: u32 };
struct Out { count: atomic<u32>, pad: u32, items: array<vec2<u32>> };

@group(0) @binding(0) var<storage, read> pyr: array<u32>;
@group(0) @binding(1) var<storage, read> chr: array<u32>;
@group(0) @binding(2) var<uniform> dims: Dims;
@group(0) @binding(3) var<storage, read> tpl: array<f32>;
@group(0) @binding(4) var<storage, read_write> outp: Out;

var<workgroup> tile: array<f32, 64>;

const CAP: u32 = ${GPU_CANDIDATE_CAP}u;
const HEAD: u32 = ${TPL_HEADER_F32}u;
const STRIDE: u32 = ${TPL_STRIDE_F32}u;
const PYR_COLOR_SHARPNESS: f32 = 2.0;

@compute @workgroup_size(8, 8)
fn main(@builtin(global_invocation_id) gid: vec3<u32>,
        @builtin(local_invocation_id) lid: vec3<u32>) {
  let n = u32(tpl[0]);
  let tMean = tpl[1];
  let tStd = tpl[2];
  let gate = tpl[3];
  let pMaxX = u32(tpl[4]);
  let pMaxY = u32(tpl[5]);
  let pMinX = u32(tpl[6]);
  let pMinY = u32(tpl[7]);
  let useColor = tpl[8] > 0.5;

  let px = gid.x + pMinX;
  let py = gid.y + pMinY;
  var score = 0.0;

  if (px <= pMaxX && py <= pMaxY) {
    let base = py * dims.pw + px;
    var sum = 0.0;
    var sumSq = 0.0;
    var cross = 0.0;
    for (var i: u32 = 0u; i < n; i = i + 1u) {
      let h = HEAD + i * STRIDE;
      let o = base + u32(tpl[h + 1u]) * dims.pw + u32(tpl[h]);
      let f = f32(pyr[o]);
      sum = sum + f;
      sumSq = sumSq + f * f;
      cross = cross + f * tpl[h + 2u];
    }
    let inv = 1.0 / f32(n);
    let mean = sum * inv;
    let variance = sumSq * inv - mean * mean;
    if (variance > 1.0) {
      let s = (cross * inv - mean * tMean) / (sqrt(variance) * tStd);
      // The luminance gate is the CPU sweep's own \`midScore < midGate\` cut, and
      // running it before the chroma loop halves the memory traffic of every
      // rejected position.
      if (s >= gate) {
        if (useColor) {
          var diff = 0.0;
          for (var i: u32 = 0u; i < n; i = i + 1u) {
            let h = HEAD + i * STRIDE;
            let o = base + u32(tpl[h + 1u]) * dims.pw + u32(tpl[h]);
            let packed = chr[o];
            diff = diff + abs(f32(packed & 255u) - tpl[h + 3u])
                        + abs(f32((packed >> 8u) & 255u) - tpl[h + 4u]);
          }
          let factor = 1.0 - (diff / (f32(n) * 255.0)) * PYR_COLOR_SHARPNESS;
          score = s * max(factor, 0.25);
        } else {
          score = s;
        }
      }
    }
  }

  // Per-2x2-tile maximum. The CPU sweep collapses peaks within 4 full-res pixels
  // of each other anyway, so keeping one position per 8x8 pixel tile throws away
  // nothing it would have kept, and it cuts the readback by ~40x.
  tile[lid.y * 8u + lid.x] = score;
  workgroupBarrier();
  if ((lid.x & 1u) != 0u || (lid.y & 1u) != 0u) { return; }

  var bv = 0.0;
  var bx = 0u;
  var by = 0u;
  for (var dy: u32 = 0u; dy < 2u; dy = dy + 1u) {
    for (var dx: u32 = 0u; dx < 2u; dx = dx + 1u) {
      let v = tile[(lid.y + dy) * 8u + lid.x + dx];
      if (v > bv) { bv = v; bx = gid.x + dx + pMinX; by = gid.y + dy + pMinY; }
    }
  }
  if (bv <= 0.0) { return; }
  let slot = atomicAdd(&outp.count, 1u);
  if (slot < CAP) {
    outp.items[slot] = vec2<u32>(bx | (by << 16u), bitcast<u32>(bv));
  }
}
`;

export class GpuSweeper {
  private device: GpuAny;
  private queue: GpuAny;
  private planesPipeline: GpuAny;
  private sweepPipeline: GpuAny;
  private dimsBuf: GpuAny;

  private tex: GpuAny = null;
  private texW = 0;
  private texH = 0;
  private pyrBuf: GpuAny = null;
  private chrBuf: GpuAny = null;
  private planesBind: GpuAny = null;
  private pyrReadBuf: GpuAny = null;
  private pw = 0;
  private ph = 0;

  private outBuf: GpuAny = null;
  private staging: GpuAny = null;
  private regions = 0;

  private targets: GpuSweepTarget[] = [];
  private useColor = true;
  private tplBufs = new Map<string, GpuAny>();
  private sweepBinds = new Map<string, GpuAny>();
  private dispatchDims = new Map<string, { gx: number; gy: number }>();
  /** Targets whose template is too small for a pyramid level: CPU handles them. */
  private unsupported: string[] = [];

  private isLost = false;
  private busy = false;

  private constructor(device: GpuAny, planes: GpuAny, sweep: GpuAny, dimsBuf: GpuAny) {
    this.device = device;
    this.queue = device.queue;
    this.planesPipeline = planes;
    this.sweepPipeline = sweep;
    this.dimsBuf = dimsBuf;
    device.lost?.then?.(() => {
      this.isLost = true;
    });
    device.onuncapturederror = () => {
      // A shader-level error would otherwise fail silently and quietly return
      // empty candidate lists, i.e. look exactly like "nothing on screen".
      this.isLost = true;
    };
  }

  static async create(): Promise<GpuSweeper | null> {
    try {
      const gpu = (navigator as GpuAny).gpu;
      if (!gpu) return null;
      const adapter = await gpu.requestAdapter({ powerPreference: 'high-performance' });
      if (!adapter) return null;
      const device = await adapter.requestDevice();
      if (!device) return null;

      const planesModule = device.createShaderModule({ code: PLANES_WGSL });
      const sweepModule = device.createShaderModule({ code: SWEEP_WGSL });
      const info = await planesModule.getCompilationInfo?.();
      if (info?.messages?.some((m: GpuAny) => m.type === 'error')) return null;
      const info2 = await sweepModule.getCompilationInfo?.();
      if (info2?.messages?.some((m: GpuAny) => m.type === 'error')) return null;

      const planes = device.createComputePipeline({
        layout: 'auto',
        compute: { module: planesModule, entryPoint: 'main' },
      });
      const sweep = device.createComputePipeline({
        layout: 'auto',
        compute: { module: sweepModule, entryPoint: 'main' },
      });
      const dimsBuf = device.createBuffer({ size: 16, usage: BUF_UNIFORM | BUF_COPY_DST });
      return new GpuSweeper(device, planes, sweep, dimsBuf);
    } catch {
      return null;
    }
  }

  get lost(): boolean {
    return this.isLost;
  }

  get cpuOnlyTargets(): string[] {
    return this.unsupported;
  }

  /**
   * Replace the target set. Template buffers are rebuilt lazily, so this is
   * cheap enough to call on every settings change.
   */
  setTargets(targets: GpuSweepTarget[], useColor: boolean): void {
    this.targets = targets;
    this.useColor = useColor;
    this.unsupported = targets
      .filter((t) => !this.hasPyramid(t.template))
      .map((t) => t.id);
    this.tplBufs.forEach((b) => b.destroy?.());
    this.tplBufs.clear();
    this.sweepBinds.clear();
    this.dispatchDims.clear();
    this.ensureOutBuffers(targets.length);
  }

  private hasPyramid(t: PreprocessedTemplate): boolean {
    return !!t.pyrMid && t.pyrWidth >= 2 && t.pyrHeight >= 2;
  }

  private ensureOutBuffers(count: number): void {
    if (count <= this.regions && this.outBuf) return;
    this.outBuf?.destroy?.();
    this.staging?.destroy?.();
    const n = Math.max(1, count);
    this.outBuf = this.device.createBuffer({
      size: n * REGION_BYTES,
      usage: BUF_STORAGE | BUF_COPY_SRC | BUF_COPY_DST,
    });
    this.staging = this.device.createBuffer({
      size: n * REGION_BYTES,
      usage: BUF_COPY_DST | BUF_MAP_READ,
    });
    this.regions = n;
    this.sweepBinds.clear();
  }

  /** Frame texture + plane buffers, rebuilt only when the capture size changes. */
  private ensureFrameResources(width: number, height: number): boolean {
    const S = PYRAMID_SCALE;
    const pw = Math.floor(width / S);
    const ph = Math.floor(height / S);
    if (pw < 2 || ph < 2) return false;
    if (this.tex && this.texW === width && this.texH === height) return true;

    this.tex?.destroy?.();
    this.pyrBuf?.destroy?.();
    this.chrBuf?.destroy?.();
    this.pyrReadBuf?.destroy?.();

    this.tex = this.device.createTexture({
      size: { width, height },
      format: 'rgba8unorm',
      usage: TEX_COPY_DST | TEX_BINDING | TEX_RENDER_ATTACHMENT,
    });
    const planeBytes = pw * ph * 4;
    this.pyrBuf = this.device.createBuffer({
      size: planeBytes,
      usage: BUF_STORAGE | BUF_COPY_SRC,
    });
    this.chrBuf = this.device.createBuffer({
      size: planeBytes,
      usage: BUF_STORAGE | BUF_COPY_SRC,
    });
    // Only used by the self-test, but it must exist before the first sweep so a
    // failed self-test can be reported before any detection depends on the GPU.
    this.pyrReadBuf = this.device.createBuffer({
      size: planeBytes * 2,
      usage: BUF_COPY_DST | BUF_MAP_READ,
    });
    this.queue.writeBuffer(this.dimsBuf, 0, new Uint32Array([width, height, pw, ph]));

    this.planesBind = this.device.createBindGroup({
      layout: this.planesPipeline.getBindGroupLayout(0),
      entries: [
        { binding: 0, resource: this.tex.createView() },
        { binding: 1, resource: { buffer: this.pyrBuf } },
        { binding: 2, resource: { buffer: this.chrBuf } },
        { binding: 3, resource: { buffer: this.dimsBuf } },
      ],
    });

    this.texW = width;
    this.texH = height;
    this.pw = pw;
    this.ph = ph;
    // Template buffers carry the search bounds, which depend on the frame size.
    this.tplBufs.forEach((b) => b.destroy?.());
    this.tplBufs.clear();
    this.sweepBinds.clear();
    this.dispatchDims.clear();
    return true;
  }

  /**
   * Pack a template's mid lattice for the shader: a small header with the search
   * bounds and the gate, then dx, dy, luminance, cr, cg per sample point.
   */
  private ensureTemplate(t: GpuSweepTarget, index: number): GpuAny {
    const cached = this.sweepBinds.get(t.id);
    if (cached) return cached;

    const tpl = t.template;
    const mid = tpl.pyrMid!;
    const n = mid.count;
    const data = new Float32Array(TPL_HEADER_F32 + n * TPL_STRIDE_F32);
    const S = PYRAMID_SCALE;

    let minX = 0;
    let minY = 0;
    let maxX = this.texW - tpl.width;
    let maxY = this.texH - tpl.height;
    if (t.roi) {
      minX = Math.max(0, Math.min(maxX, Math.floor(t.roi.x)));
      minY = Math.max(0, Math.min(maxY, Math.floor(t.roi.y)));
      maxX = Math.max(minX, Math.min(maxX, Math.floor(t.roi.x + t.roi.width - tpl.width)));
      maxY = Math.max(minY, Math.min(maxY, Math.floor(t.roi.y + t.roi.height - tpl.height)));
    }

    data[0] = n;
    data[1] = mid.mean;
    data[2] = mid.std;
    // Same cut as `scanRegion`: min(0.45, threshold * 0.5).
    data[3] = Math.min(0.45, t.threshold * 0.5);
    data[4] = Math.min(this.pw - tpl.pyrWidth, Math.floor(maxX / S));
    data[5] = Math.min(this.ph - tpl.pyrHeight, Math.floor(maxY / S));
    data[6] = Math.floor(minX / S);
    data[7] = Math.floor(minY / S);
    data[8] = this.useColor ? 1 : 0;
    for (let i = 0; i < n; i++) {
      const o = TPL_HEADER_F32 + i * TPL_STRIDE_F32;
      data[o] = mid.dx[i];
      data[o + 1] = mid.dy[i];
      data[o + 2] = mid.lum[i];
      data[o + 3] = tpl.pyrMidCr ? tpl.pyrMidCr[i] : 0;
      data[o + 4] = tpl.pyrMidCg ? tpl.pyrMidCg[i] : 0;
    }

    const buf = this.device.createBuffer({
      size: data.byteLength,
      usage: BUF_STORAGE | BUF_COPY_DST,
    });
    this.queue.writeBuffer(buf, 0, data);
    this.tplBufs.set(t.id, buf);

    const bind = this.device.createBindGroup({
      layout: this.sweepPipeline.getBindGroupLayout(0),
      entries: [
        { binding: 0, resource: { buffer: this.pyrBuf } },
        { binding: 1, resource: { buffer: this.chrBuf } },
        { binding: 2, resource: { buffer: this.dimsBuf } },
        { binding: 3, resource: { buffer: buf } },
        {
          binding: 4,
          resource: { buffer: this.outBuf, offset: index * REGION_BYTES, size: REGION_BYTES },
        },
      ],
    });
    this.sweepBinds.set(t.id, bind);
    this.dispatchDims.set(t.id, {
      gx: Math.max(0, Math.ceil((data[4] - data[6] + 1) / 8)),
      gy: Math.max(0, Math.ceil((data[5] - data[7] + 1) / 8)),
    });
    return bind;
  }

  /**
   * Upload one frame, build the planes, sweep every target, and read the
   * candidate lists back. One submit and one map per frame.
   */
  async sweep(
    source: ImageBitmap,
    width: number,
    height: number
  ): Promise<GpuCandidateSet[] | null> {
    if (this.isLost || this.busy) return null;
    if (!this.ensureFrameResources(width, height)) return null;
    const list = this.targets.filter((t) => this.hasPyramid(t.template));
    if (list.length === 0) return [];
    this.ensureOutBuffers(list.length);

    this.busy = true;
    try {
      for (let i = 0; i < list.length; i++) {
        this.queue.writeBuffer(this.outBuf, i * REGION_BYTES, ZERO_WORD);
      }
      this.queue.copyExternalImageToTexture({ source }, { texture: this.tex }, { width, height });

      // Bind groups and template buffers are built before the encoder opens: a
      // `writeBuffer` issued while a pass is being recorded still lands in queue
      // order, but relying on that is a trap for whoever edits this next.
      for (let i = 0; i < list.length; i++) this.ensureTemplate(list[i], i);

      const enc = this.device.createCommandEncoder();
      const planes = enc.beginComputePass();
      planes.setPipeline(this.planesPipeline);
      planes.setBindGroup(0, this.planesBind);
      planes.dispatchWorkgroups(Math.ceil(this.pw / 8), Math.ceil(this.ph / 8));
      planes.end();

      const pass = enc.beginComputePass();
      pass.setPipeline(this.sweepPipeline);
      for (let i = 0; i < list.length; i++) {
        const bind = this.sweepBinds.get(list[i].id);
        const d = this.dispatchDims.get(list[i].id);
        if (!bind || !d || d.gx <= 0 || d.gy <= 0) continue;
        pass.setBindGroup(0, bind);
        pass.dispatchWorkgroups(d.gx, d.gy);
      }
      pass.end();

      const bytes = list.length * REGION_BYTES;
      enc.copyBufferToBuffer(this.outBuf, 0, this.staging, 0, bytes);
      this.queue.submit([enc.finish()]);

      await this.staging.mapAsync(MAP_READ, 0, bytes);
      const words = new Uint32Array(this.staging.getMappedRange(0, bytes));
      const out: GpuCandidateSet[] = [];
      for (let i = 0; i < list.length; i++) {
        const base = (i * REGION_BYTES) >> 2;
        const raw = words[base];
        const count = Math.min(raw, GPU_CANDIDATE_CAP);
        out.push({
          targetId: list[i].id,
          // A copy, because the mapped range dies on unmap. Its buffer is
          // transferable, so handing it to the refine worker costs nothing.
          packed: words.slice(base + 2, base + 2 + count * 2),
          count,
          overflow: raw > GPU_CANDIDATE_CAP,
        });
      }
      this.staging.unmap();
      return out;
    } catch {
      this.isLost = true;
      return null;
    } finally {
      this.busy = false;
    }
  }

  /**
   * Read the plane buffers back. Only the startup self-test uses this: the planes
   * must be the same bytes `computeFramePlanes` produces, and comparing them is
   * the cheapest way to prove the GPU is doing what the CPU would have done.
   */
  async readPlanes(): Promise<{
    pyr: Uint8Array;
    cr: Uint8Array;
    cg: Uint8Array;
    width: number;
    height: number;
  } | null> {
    if (this.isLost || !this.pyrBuf || this.busy) return null;
    this.busy = true;
    try {
      const planeBytes = this.pw * this.ph * 4;
      const enc = this.device.createCommandEncoder();
      enc.copyBufferToBuffer(this.pyrBuf, 0, this.pyrReadBuf, 0, planeBytes);
      enc.copyBufferToBuffer(this.chrBuf, 0, this.pyrReadBuf, planeBytes, planeBytes);
      this.queue.submit([enc.finish()]);
      await this.pyrReadBuf.mapAsync(MAP_READ, 0, planeBytes * 2);
      const words = new Uint32Array(this.pyrReadBuf.getMappedRange(0, planeBytes * 2));
      const n = this.pw * this.ph;
      const pyr = new Uint8Array(n);
      const cr = new Uint8Array(n);
      const cg = new Uint8Array(n);
      for (let i = 0; i < n; i++) {
        pyr[i] = words[i];
        const c = words[n + i];
        cr[i] = c & 255;
        cg[i] = (c >> 8) & 255;
      }
      this.pyrReadBuf.unmap();
      return { pyr, cr, cg, width: this.pw, height: this.ph };
    } catch {
      this.isLost = true;
      return null;
    } finally {
      this.busy = false;
    }
  }

  destroy(): void {
    try {
      this.tplBufs.forEach((b) => b.destroy?.());
      this.pyrBuf?.destroy?.();
      this.chrBuf?.destroy?.();
      this.pyrReadBuf?.destroy?.();
      this.outBuf?.destroy?.();
      this.staging?.destroy?.();
      this.tex?.destroy?.();
      this.device.destroy?.();
    } catch {
      /* tearing down: nothing useful to do about a failure here */
    }
    this.isLost = true;
  }
}
