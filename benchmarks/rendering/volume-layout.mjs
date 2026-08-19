import { brotliCompressSync, brotliDecompressSync, gzipSync, gunzipSync } from 'node:zlib';
import { performance } from 'node:perf_hooks';

const shape = { coronal: 528, sagittal: 456, horizontal: 320 };
const axes = Object.keys(shape);
const bytesPerVoxel = 2;
const layouts = [32, 48, 64, 96].map((edge) => [`cube${edge}`, Object.fromEntries(axes.map((axis) => [axis, edge]))]);

function ceilDiv(a, b) { return Math.ceil(a / b); }
function mib(bytes) { return bytes / 1024 / 1024; }
function sliceStats(chunk, axis) {
  const other = axes.filter((a) => a !== axis);
  const requests = ceilDiv(shape[other[0]], chunk[other[0]]) * ceilDiv(shape[other[1]], chunk[other[1]]);
  const chunkBytes = chunk.coronal * chunk.sagittal * chunk.horizontal * bytesPerVoxel;
  return { requests, rawMiB: mib(requests * chunkBytes) };
}
function unionThreePlaneChunkCount(chunk) {
  const grid = Object.fromEntries(axes.map((axis) => [axis, ceilDiv(shape[axis], chunk[axis])]));
  return grid.sagittal * grid.horizontal + grid.coronal * grid.horizontal + grid.coronal * grid.sagittal
    - grid.horizontal - grid.sagittal - grid.coronal + 1;
}

const f32 = new Float32Array(1);
const u32 = new Uint32Array(f32.buffer);
function floatToHalf(value) {
  f32[0] = value;
  const x = u32[0];
  let bits = (x >> 16) & 0x8000;
  let m = (x >> 12) & 0x07ff;
  const e = (x >> 23) & 0xff;
  if (e < 103) return bits;
  if (e > 142) {
    bits |= 0x7c00;
    bits |= e === 255 && (x & 0x007fffff) ? 1 : 0;
    return bits;
  }
  if (e < 113) {
    m |= 0x0800;
    bits |= (m >> (114 - e)) + ((m >> (113 - e)) & 1);
    return bits;
  }
  bits |= ((e - 112) << 10) | (m >> 1);
  bits += m & 1;
  return bits;
}
function representativeChunk(edge) {
  const data = new Uint16Array(edge ** 3);
  let i = 0;
  for (let c = 0; c < edge; c++) {
    for (let s = 0; s < edge; s++) {
      for (let h = 0; h < edge; h++) {
        const value = Math.sin(c / 13) + 0.7 * Math.cos(s / 17) + 0.4 * Math.sin(h / 11) + ((c * 17 + s * 7 + h * 3) % 19) / 200;
        data[i++] = floatToHalf(value);
      }
    }
  }
  return Buffer.from(data.buffer);
}

const totalVoxels = shape.coronal * shape.sagittal * shape.horizontal;
console.log(`volume voxels=${totalVoxels.toLocaleString()} float16=${mib(totalVoxels * 2).toFixed(1)} MiB decoded-float32=${mib(totalVoxels * 4).toFixed(1)} MiB`);
console.log('\nCold orthogonal slice cost if every logical cube is one independently fetched object:');
console.log('layout\tchunk MiB\tcoronal req/MiB\tsagittal req/MiB\thorizontal req/MiB\t3-plane union MiB');
for (const [name, chunk] of layouts) {
  const bytes = chunk.coronal * chunk.sagittal * chunk.horizontal * bytesPerVoxel;
  const cells = axes.map((axis) => {
    const s = sliceStats(chunk, axis);
    return `${s.requests}/${s.rawMiB.toFixed(1)}`;
  });
  const unionMiB = mib(unionThreePlaneChunkCount(chunk) * bytes);
  console.log(`${name}\t${mib(bytes).toFixed(3)}\t${cells.join('\t')}\t${unionMiB.toFixed(1)}`);
}

console.log('\nOrientation-specific float16 slice packs (3x storage, one request per current view):');
console.log('pack depth\t3-view startup raw MiB\tdecoded cache MiB\tfull feature storage MiB\twarm steps');
for (const depth of [1, 4, 8, 16]) {
  const perSlice = shape.sagittal * shape.horizontal + shape.coronal * shape.horizontal + shape.coronal * shape.sagittal;
  const startup = perSlice * depth * bytesPerVoxel;
  console.log(`${depth}\t${mib(startup).toFixed(2)}\t${mib(startup * 2).toFixed(2)}\t${mib(totalVoxels * bytesPerVoxel * 3).toFixed(1)}\t${depth}`);
}

console.log('\nRepresentative smooth float16 cube compression (indicative; real launch data required):');
console.log('edge\traw MiB\tgzip MiB/ratio/enc ms/dec ms\tbrotli MiB/ratio/enc ms/dec ms');
for (const edge of [32, 48, 64]) {
  const raw = representativeChunk(edge);
  let t0 = performance.now();
  const gzip = gzipSync(raw, { level: 6 });
  let t1 = performance.now();
  gunzipSync(gzip);
  let t2 = performance.now();
  const brotli = brotliCompressSync(raw);
  let t3 = performance.now();
  brotliDecompressSync(brotli);
  let t4 = performance.now();
  console.log([
    edge,
    mib(raw.length).toFixed(2),
    `${mib(gzip.length).toFixed(2)}/${(gzip.length / raw.length).toFixed(2)}/${(t1 - t0).toFixed(1)}/${(t2 - t1).toFixed(1)}`,
    `${mib(brotli.length).toFixed(2)}/${(brotli.length / raw.length).toFixed(2)}/${(t3 - t2).toFixed(1)}/${(t4 - t3).toFixed(1)}`,
  ].join('\t'));
}
