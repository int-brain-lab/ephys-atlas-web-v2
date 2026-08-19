import { brotliCompressSync, gzipSync } from 'node:zlib';
import { performance } from 'node:perf_hooks';

const shape = { coronal: 528, sagittal: 456, horizontal: 320 };
const axes = Object.keys(shape);
const layouts = [
  ['cube32', { coronal: 32, sagittal: 32, horizontal: 32 }],
  ['cube48', { coronal: 48, sagittal: 48, horizontal: 48 }],
  ['cube64', { coronal: 64, sagittal: 64, horizontal: 64 }],
  ['cube96', { coronal: 96, sagittal: 96, horizontal: 96 }],
];
const bytesPerVoxel = 4;

function ceilDiv(a, b) { return Math.ceil(a / b); }
function mib(bytes) { return bytes / 1024 / 1024; }

function sliceStats(chunk, axis) {
  const other = axes.filter((a) => a !== axis);
  const requests = ceilDiv(shape[other[0]], chunk[other[0]]) * ceilDiv(shape[other[1]], chunk[other[1]]);
  const chunkBytes = chunk.coronal * chunk.sagittal * chunk.horizontal * bytesPerVoxel;
  return { requests, rawMiB: mib(requests * chunkBytes) };
}

function representativeChunk(edge) {
  const n = edge ** 3;
  const data = new Float32Array(n);
  let i = 0;
  for (let c = 0; c < edge; c++) {
    for (let s = 0; s < edge; s++) {
      for (let h = 0; h < edge; h++) {
        data[i++] = Math.fround(
          Math.sin(c / 13) + 0.7 * Math.cos(s / 17) + 0.4 * Math.sin(h / 11) + ((c * 17 + s * 7 + h * 3) % 19) / 200,
        );
      }
    }
  }
  return Buffer.from(data.buffer);
}

const totalVoxels = shape.coronal * shape.sagittal * shape.horizontal;
console.log(`volume voxels=${totalVoxels.toLocaleString()} float32=${mib(totalVoxels * 4).toFixed(1)} MiB`);
console.log('\nCold orthogonal slice cost if every logical chunk is one independently fetched object:');
console.log('layout\tchunk MiB\tcoronal req/MiB\tsagittal req/MiB\thorizontal req/MiB');
for (const [name, chunk] of layouts) {
  const bytes = chunk.coronal * chunk.sagittal * chunk.horizontal * 4;
  const cells = axes.map((axis) => {
    const s = sliceStats(chunk, axis);
    return `${s.requests}/${s.rawMiB.toFixed(1)}`;
  });
  console.log(`${name}\t${mib(bytes).toFixed(2)}\t${cells.join('\t')}`);
}

console.log('\nRepresentative smooth float32 chunk compression (Node zlib; indicative only):');
console.log('edge\traw MiB\tgzip MiB/ratio/ms\tbrotli MiB/ratio/ms');
for (const edge of [32, 48, 64]) {
  const raw = representativeChunk(edge);
  const t0 = performance.now();
  const gzip = gzipSync(raw, { level: 6 });
  const t1 = performance.now();
  const brotli = brotliCompressSync(raw);
  const t2 = performance.now();
  console.log([
    edge,
    mib(raw.length).toFixed(2),
    `${mib(gzip.length).toFixed(2)}/${(gzip.length / raw.length).toFixed(2)}/${(t1 - t0).toFixed(1)}`,
    `${mib(brotli.length).toFixed(2)}/${(brotli.length / raw.length).toFixed(2)}/${(t2 - t1).toFixed(1)}`,
  ].join('\t'));
}
