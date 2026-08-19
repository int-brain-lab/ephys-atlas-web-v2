import { performance } from 'node:perf_hooks';

function scalarToRgba(values, palette, min, max, out) {
  const n = palette.length / 4;
  const scale = (n - 1) / (max - min);
  for (let i = 0; i < values.length; i++) {
    const value = values[i];
    const normalized = Number.isFinite(value) ? Math.max(0, Math.min(n - 1, Math.floor((value - min) * scale))) : 0;
    const p = normalized * 4;
    const o = i * 4;
    out[o] = palette[p];
    out[o + 1] = palette[p + 1];
    out[o + 2] = palette[p + 2];
    out[o + 3] = Number.isFinite(value) ? palette[p + 3] : 0;
  }
  return out;
}

const planes = [456 * 320, 528 * 320, 456 * 528];
const arrays = planes.map((n, j) => {
  const out = new Float32Array(n);
  for (let i = 0; i < n; i++) out[i] = Math.sin(i / (97 + j * 13));
  return out;
});
const outputs = arrays.map((values) => new Uint8ClampedArray(values.length * 4));
const palette = new Uint8Array(256 * 4);
for (let i = 0; i < 256; i++) {
  palette[i * 4] = i;
  palette[i * 4 + 1] = 255 - i;
  palette[i * 4 + 2] = (i * 3) & 255;
  palette[i * 4 + 3] = 255;
}

for (let warmup = 0; warmup < 10; warmup++) arrays.forEach((values, i) => scalarToRgba(values, palette, -1, 1, outputs[i]));
const samples = [];
for (let run = 0; run < 100; run++) {
  const t0 = performance.now();
  arrays.forEach((values, i) => scalarToRgba(values, palette, -1, 1, outputs[i]));
  samples.push(performance.now() - t0);
}
samples.sort((a, b) => a - b);
const percentile = (p) => samples[Math.floor((samples.length - 1) * p)];
console.log(`pixels per three-view redraw=${planes.reduce((a, b) => a + b, 0).toLocaleString()}`);
console.log(`scalar->RGBA p50=${percentile(0.50).toFixed(2)} ms p95=${percentile(0.95).toFixed(2)} ms max=${samples.at(-1).toFixed(2)} ms`);
