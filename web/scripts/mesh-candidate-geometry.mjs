import { MeshoptDecoder, MeshoptEncoder, MeshoptSimplifier } from 'meshoptimizer';

await Promise.all([MeshoptDecoder.ready, MeshoptEncoder.ready, MeshoptSimplifier.ready]);

export async function decodeLabMeshopt(data) {
  const view = new DataView(data.buffer, data.byteOffset, data.byteLength);
  if (data.subarray(0, 4).toString() !== 'EAM3' || view.getUint32(4, true) !== 1) throw new Error('donor EAM3 identity differs');
  const headerLength = view.getUint32(8, true);
  const payloadOffset = align4(12 + headerLength);
  const header = JSON.parse(data.subarray(12, 12 + headerLength).toString());
  const payload = data.subarray(payloadOffset);
  const geometries = new Map();
  for (const chunk of header.chunks) {
    const vertexCount = chunk.vertexCount ?? chunk.vertex_count;
    const indexCount = chunk.indexCount ?? chunk.index_count;
    const minimum = chunk.bounds.minimum ?? chunk.bounds.minimum_um;
    const maximum = chunk.bounds.maximum ?? chunk.bounds.maximum_um;
    const vertexBytes = new Uint8Array(vertexCount * 8);
    const indices = new Uint32Array(indexCount);
    MeshoptDecoder.decodeVertexBuffer(vertexBytes, vertexCount, 8, block(payload, chunk.blocks.vertices));
    MeshoptDecoder.decodeIndexBuffer(new Uint8Array(indices.buffer), indexCount, 4, block(payload, chunk.blocks.indices));
    const quantized = new Uint16Array(vertexBytes.buffer);
    for (const range of chunk.ranges) {
      const rangeVertexStart = range.vertexStart ?? range.vertex_start;
      const rangeVertexCount = range.vertexCount ?? range.vertex_count;
      const rangeIndexStart = range.indexStart ?? range.index_start;
      const rangeIndexCount = range.indexCount ?? range.index_count;
      const featureId = range.featureId ?? range.feature_id;
      const signedAllenId = range.signedAllenId ?? range.signed_allen_id;
      const explodeGroupId = range.explodeGroupId ?? range.signed_explode_group_id;
      const positions = new Float32Array(rangeVertexCount * 3);
      for (let vertex = 0; vertex < rangeVertexCount; vertex += 1) {
        for (let axis = 0; axis < 3; axis += 1) {
          const value = quantized[(rangeVertexStart + vertex) * 4 + axis];
          positions[vertex * 3 + axis] = minimum[axis] + (maximum[axis] - minimum[axis]) * value / 16383;
        }
      }
      const rangeIndices = indices.subarray(rangeIndexStart, rangeIndexStart + rangeIndexCount);
      geometries.set(featureId, {
        featureId,
        signedAllenId,
        explodeGroupId: chunk.hemisphere === 'left' ? -Math.abs(explodeGroupId) : Math.abs(explodeGroupId),
        hemisphere: chunk.hemisphere,
        positions,
        indices: Uint32Array.from(rangeIndices, (value) => value - rangeVertexStart),
      });
    }
  }
  return geometries;
}

export function simplifyGeometry(geometry, targetRatio) {
  const ratios = [...new Set([targetRatio, 0.25, 0.5, 1].filter((ratio) => ratio >= targetRatio))].sort((a, b) => a - b);
  for (const attemptedRatio of ratios) {
    if (attemptedRatio === 1) return { ...geometry, error: 0, ratioUsed: 1 };
    const targetIndexCount = Math.max(12, Math.floor(geometry.indices.length * attemptedRatio / 3) * 3);
    const [candidate, error] = MeshoptSimplifier.simplify(
      geometry.indices,
      geometry.positions,
      3,
      targetIndexCount,
      0.025,
      ['LockBorder', 'RegularizeLight'],
    );
    const indices = Uint32Array.from(candidate);
    const incidence = topology(indices);
    if (!incidence.boundaryEdgeCount && !incidence.nonManifoldEdgeCount) {
      return { ...geometry, indices, error, ratioUsed: indices.length / geometry.indices.length };
    }
  }
  throw new Error(`no topology-preserving LOD for signed Allen ${geometry.signedAllenId}`);
}

export function geometryMetrics(geometry) {
  const bounds = positionBounds(geometry.positions);
  return {
    vertexCount: geometry.positions.length / 3,
    triangleCount: geometry.indices.length / 3,
    componentCount: components(geometry.indices, geometry.positions.length / 3),
    bounds,
    topology: topology(geometry.indices),
    quality: triangleQuality(geometry.positions, geometry.indices),
  };
}

export async function encodeCandidateLod(geometries) {
  const chunks = ['left', 'right'].map((hemisphere) => mergeHemisphere(
    [...geometries.values()].filter((geometry) => geometry.hemisphere === hemisphere).sort((a, b) => a.featureId - b.featureId),
    hemisphere,
  ));
  const blocks = [];
  let payloadByteLength = 0;
  const append = (value) => {
    const descriptor = { byte_offset: payloadByteLength, byte_length: value.byteLength };
    blocks.push(value);
    payloadByteLength += value.byteLength;
    return descriptor;
  };
  const descriptors = chunks.map((chunk) => {
    const vertexCount = chunk.positions.length / 3;
    const bounds = positionBounds(chunk.positions);
    const vertices = new Uint16Array(vertexCount * 4);
    for (let vertex = 0; vertex < vertexCount; vertex += 1) {
      for (let axis = 0; axis < 3; axis += 1) {
        const span = bounds.maximum[axis] - bounds.minimum[axis];
        const normalized = span > 0 ? (chunk.positions[vertex * 3 + axis] - bounds.minimum[axis]) / span : 0;
        vertices[vertex * 4 + axis] = Math.round(Math.max(0, Math.min(1, normalized)) * 16383);
      }
      vertices[vertex * 4 + 3] = chunk.featureIds[vertex];
    }
    const normalInput = new Float32Array(vertexCount * 4);
    for (let vertex = 0; vertex < vertexCount; vertex += 1) normalInput.set(chunk.normals.subarray(vertex * 3, vertex * 3 + 3), vertex * 4);
    const filteredNormals = MeshoptEncoder.encodeFilterOct(normalInput, vertexCount, 4, 8);
    return {
      hemisphere: chunk.hemisphere,
      vertex_count: vertexCount,
      index_count: chunk.indices.length,
      position_bits: 14,
      normal_bits: 8,
      bounds: { minimum_um: bounds.minimum, maximum_um: bounds.maximum },
      blocks: {
        vertices: { ...append(MeshoptEncoder.encodeVertexBuffer(new Uint8Array(vertices.buffer), vertexCount, 8)), codec: 'meshopt-vertex', stride: 8 },
        normals: { ...append(MeshoptEncoder.encodeVertexBuffer(filteredNormals, vertexCount, 4)), codec: 'meshopt-oct', stride: 4 },
        indices: { ...append(MeshoptEncoder.encodeIndexBuffer(new Uint8Array(chunk.indices.buffer), chunk.indices.length, 4)), codec: 'meshopt-index', stride: 4 },
      },
      ranges: chunk.ranges,
    };
  });
  const header = Buffer.from(JSON.stringify({ encoding: 'meshopt-quantized-v1', chunks: descriptors }));
  const payloadOffset = align4(12 + header.byteLength);
  const output = Buffer.alloc(payloadOffset + payloadByteLength);
  output.write('EAM3');
  output.writeUInt32LE(1, 4);
  output.writeUInt32LE(header.byteLength, 8);
  header.copy(output, 12);
  let offset = payloadOffset;
  for (const part of blocks) {
    Buffer.from(part.buffer, part.byteOffset, part.byteLength).copy(output, offset);
    offset += part.byteLength;
  }
  return { bytes: output, triangleCount: chunks.reduce((total, chunk) => total + chunk.indices.length / 3, 0) };
}

function mergeHemisphere(geometries, hemisphere) {
  const compacted = geometries.map(compactGeometry);
  const vertexCount = compacted.reduce((total, geometry) => total + geometry.positions.length / 3, 0);
  const indexCount = compacted.reduce((total, geometry) => total + geometry.indices.length, 0);
  const positions = new Float32Array(vertexCount * 3);
  const normals = new Float32Array(vertexCount * 3);
  const featureIds = new Uint16Array(vertexCount);
  const indices = new Uint32Array(indexCount);
  const ranges = [];
  let vertexStart = 0;
  let indexStart = 0;
  for (const geometry of compacted) {
    positions.set(geometry.positions, vertexStart * 3);
    normals.set(geometry.normals, vertexStart * 3);
    featureIds.fill(geometry.featureId, vertexStart, vertexStart + geometry.positions.length / 3);
    for (let offset = 0; offset < geometry.indices.length; offset += 1) indices[indexStart + offset] = geometry.indices[offset] + vertexStart;
    ranges.push({
      feature_id: geometry.featureId,
      signed_allen_id: geometry.signedAllenId,
      signed_explode_group_id: geometry.explodeGroupId,
      index_start: indexStart,
      index_count: geometry.indices.length,
      vertex_start: vertexStart,
      vertex_count: geometry.positions.length / 3,
    });
    vertexStart += geometry.positions.length / 3;
    indexStart += geometry.indices.length;
  }
  return { hemisphere, positions, normals, featureIds, indices, ranges };
}

function compactGeometry(geometry) {
  const remap = new Int32Array(geometry.positions.length / 3).fill(-1);
  const positions = [];
  const indices = new Uint32Array(geometry.indices.length);
  for (let offset = 0; offset < geometry.indices.length; offset += 1) {
    const sourceIndex = geometry.indices[offset];
    let targetIndex = remap[sourceIndex];
    if (targetIndex < 0) {
      targetIndex = positions.length / 3;
      remap[sourceIndex] = targetIndex;
      positions.push(...geometry.positions.subarray(sourceIndex * 3, sourceIndex * 3 + 3));
    }
    indices[offset] = targetIndex;
  }
  const packedPositions = new Float32Array(positions);
  return { ...geometry, positions: packedPositions, indices, normals: vertexNormals(packedPositions, indices) };
}

function vertexNormals(positions, indices) {
  const normals = new Float32Array(positions.length);
  for (let offset = 0; offset < indices.length; offset += 3) {
    const ia = indices[offset] * 3, ib = indices[offset + 1] * 3, ic = indices[offset + 2] * 3;
    const ab = [positions[ib] - positions[ia], positions[ib + 1] - positions[ia + 1], positions[ib + 2] - positions[ia + 2]];
    const ac = [positions[ic] - positions[ia], positions[ic + 1] - positions[ia + 1], positions[ic + 2] - positions[ia + 2]];
    const normal = [ab[1] * ac[2] - ab[2] * ac[1], ab[2] * ac[0] - ab[0] * ac[2], ab[0] * ac[1] - ab[1] * ac[0]];
    for (const index of [ia, ib, ic]) for (let axis = 0; axis < 3; axis += 1) normals[index + axis] += normal[axis];
  }
  for (let offset = 0; offset < normals.length; offset += 3) {
    const length = Math.hypot(normals[offset], normals[offset + 1], normals[offset + 2]) || 1;
    normals[offset] /= length;
    normals[offset + 1] /= length;
    normals[offset + 2] /= length;
  }
  return normals;
}

function positionBounds(positions) {
  const minimum = [Infinity, Infinity, Infinity], maximum = [-Infinity, -Infinity, -Infinity];
  for (let offset = 0; offset < positions.length; offset += 3) for (let axis = 0; axis < 3; axis += 1) {
    minimum[axis] = Math.min(minimum[axis], positions[offset + axis]);
    maximum[axis] = Math.max(maximum[axis], positions[offset + axis]);
  }
  return { minimum, maximum };
}

function components(indices, vertexCount) {
  const parent = Int32Array.from({ length: vertexCount }, (_, index) => index);
  const find = (value) => parent[value] === value ? value : (parent[value] = find(parent[value]));
  const join = (left, right) => { left = find(left); right = find(right); if (left !== right) parent[right] = left; };
  const used = new Set();
  for (let offset = 0; offset < indices.length; offset += 3) {
    const values = [indices[offset], indices[offset + 1], indices[offset + 2]];
    values.forEach((value) => used.add(value));
    join(values[0], values[1]);
    join(values[1], values[2]);
  }
  return new Set([...used].map(find)).size;
}

function topology(indices) {
  const edges = new Map();
  for (let offset = 0; offset < indices.length; offset += 3) for (const [left, right] of [[indices[offset], indices[offset + 1]], [indices[offset + 1], indices[offset + 2]], [indices[offset + 2], indices[offset]]]) {
    const key = left < right ? `${left}:${right}` : `${right}:${left}`;
    edges.set(key, (edges.get(key) ?? 0) + 1);
  }
  return {
    boundaryEdgeCount: [...edges.values()].filter((count) => count === 1).length,
    nonManifoldEdgeCount: [...edges.values()].filter((count) => count > 2).length,
  };
}

function triangleQuality(positions, indices) {
  let maximumEdgeUm = 0, maximumAspectRatio = 0;
  for (let offset = 0; offset < indices.length; offset += 3) {
    const points = [indices[offset], indices[offset + 1], indices[offset + 2]].map((index) => positions.subarray(index * 3, index * 3 + 3));
    const edges = [distance(points[0], points[1]), distance(points[1], points[2]), distance(points[2], points[0])];
    const ab = points[1].map((value, axis) => value - points[0][axis]);
    const ac = points[2].map((value, axis) => value - points[0][axis]);
    const twiceArea = Math.hypot(ab[1] * ac[2] - ab[2] * ac[1], ab[2] * ac[0] - ab[0] * ac[2], ab[0] * ac[1] - ab[1] * ac[0]);
    maximumEdgeUm = Math.max(maximumEdgeUm, ...edges);
    maximumAspectRatio = Math.max(maximumAspectRatio, Math.max(...edges) ** 2 / Math.max(1e-12, twiceArea));
  }
  return { maximumEdgeUm, maximumAspectRatio };
}

function distance(a, b) { return Math.hypot(a[0] - b[0], a[1] - b[1], a[2] - b[2]); }
function block(payload, descriptor) {
  const offset = descriptor.byteOffset ?? descriptor.byte_offset;
  const length = descriptor.byteLength ?? descriptor.byte_length;
  return payload.subarray(offset, offset + length);
}
function align4(value) { return Math.ceil(value / 4) * 4; }
