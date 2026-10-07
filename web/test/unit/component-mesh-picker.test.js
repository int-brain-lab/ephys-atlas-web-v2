import assert from 'node:assert/strict';
import test from 'node:test';
import * as THREE from 'three';
import { ComponentMeshPicker } from '../../.test-dist/rendering/3d/component-mesh-picker.js';
import { meshPresentationAtMl } from '../../.test-dist/rendering/3d/mesh-presentation-boundary.js';

const boundary = { coordinate: 'original-world-ml', threshold_um: 0, on_plane_side: 'right', status: 'provisional-test-only' };

function fixture() {
  const positions = new Float32Array([-2, -1, 2, 2, -1, 2, 0, 1, 2, -2, -1, 0, 2, -1, 0, 0, 1, 0, -2, -1, -2, 2, -1, -2, 0, 1, -2]);
  const indices = new Uint32Array([0, 1, 2, 3, 4, 5, 6, 7, 8]);
  const offsets = new Float32Array([4, 0, 0, 4, 0, 0, 4, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, -2, 0, 0, -2, 0, 0, -2, 0, 0]);
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.BufferAttribute(positions, 3));
  geometry.setAttribute('explodeOffset', new THREE.BufferAttribute(offsets, 3));
  geometry.setIndex(new THREE.BufferAttribute(indices, 1));
  const bounds = new THREE.Box3();
  for (let vertex = 0; vertex < 9; vertex += 1) {
    const point = new THREE.Vector3().fromArray(positions, vertex * 3);
    bounds.expandByPoint(point);
    bounds.expandByPoint(point.clone().add(new THREE.Vector3().fromArray(offsets, vertex * 3)));
  }
  geometry.boundingBox = bounds;
  geometry.boundingSphere = bounds.getBoundingSphere(new THREE.Sphere());
  const material = new THREE.MeshBasicMaterial({ side: THREE.DoubleSide });
  const mesh = new THREE.Mesh(geometry, material);
  const state = { explode: 0 };
  // Independent reference: the previous chunk-wide raycaster deforms vertices.
  const getVertex = mesh.getVertexPosition.bind(mesh);
  mesh.getVertexPosition = (index, target) => getVertex(index, target)
    .addScaledVector(new THREE.Vector3().fromArray(offsets, index * 3), state.explode);
  const chunk = { chunkId: 'shared', positions, indices, normals: new Float32Array(27), componentIds: new Uint16Array([0, 0, 0, 1, 1, 1, 2, 2, 2]),
    ranges: [0, 1, 2].map((componentId) => ({ componentId, leftPresentationId: componentId * 2, rightPresentationId: componentId * 2 + 1,
      indexStart: componentId * 3, indexCount: 3, vertexStart: componentId * 3, vertexCount: 3 })) };
  const picker = new ComponentMeshPicker([mesh], [chunk]);
  return { picker, mesh, geometry, material, chunk, state,
    dispose() { picker.dispose(); geometry.dispose(); material.dispose(); } };
}

function rayThrough(mesh, x, y = 0) {
  const origin = new THREE.Vector3(x, y, 10).applyMatrix4(mesh.matrixWorld);
  const direction = new THREE.Vector3(0, 0, -1).transformDirection(mesh.matrixWorld);
  return new THREE.Raycaster(origin, direction);
}

function originalMl(hit) {
  const position = hit.object.geometry.getAttribute('position');
  return position.getX(hit.face.a) * hit.barycoord.x + position.getX(hit.face.b) * hit.barycoord.y + position.getX(hit.face.c) * hit.barycoord.z;
}

function sameHits(actual, expected) {
  assert.equal(actual.length, expected.length);
  actual.forEach((hit, index) => {
    const reference = expected[index];
    assert.equal(hit.faceIndex, reference.faceIndex);
    assert.deepEqual([hit.face.a, hit.face.b, hit.face.c], [reference.face.a, reference.face.b, reference.face.c]);
    assert.ok(Math.abs(hit.distance - reference.distance) < 1e-9);
    assert.ok(hit.point.distanceTo(reference.point) < 1e-9);
    assert.ok(hit.barycoord.distanceTo(reference.barycoord) < 1e-9);
    assert.ok(Math.abs(originalMl(hit) - originalMl(reference)) < 1e-9);
  });
}

test('component picking matches chunk-wide intersections for rest, partial and full explode and transformed sources', () => {
  const f = fixture();
  try {
    for (const transformed of [false, true]) {
      if (transformed) {
        f.mesh.position.set(7, -4, 2);
        f.mesh.rotation.set(.3, -.4, .2);
        f.mesh.scale.set(1.5, .75, 2);
      }
      f.mesh.updateMatrixWorld(true);
      for (const explode of [0, .5, 1]) {
        f.state.explode = explode;
        for (const x of [-6, -2.5, -.5, 0, .5, 1.5, 3.5, 4.5, 8]) {
          const raycaster = rayThrough(f.mesh, x);
          sameHits(f.picker.intersect(raycaster, explode), raycaster.intersectObject(f.mesh, false));
        }
      }
    }
  } finally { f.dispose(); }
});

test('component draw ranges preserve global face indices, barycentrics and original ML presentation', () => {
  const f = fixture();
  try {
    f.mesh.updateMatrixWorld(true);
    for (const explode of [0, .5, 1]) {
      for (const ml of [-.5, 0, .5]) {
        const hits = f.picker.intersect(rayThrough(f.mesh, ml + 4 * explode), explode);
        const hit = hits.find((candidate) => candidate.faceIndex === 0);
        assert.ok(hit);
        assert.ok(Math.abs(originalMl(hit) - ml) < 1e-12);
        assert.equal(meshPresentationAtMl(originalMl(hit), 0, 1, boundary), ml < 0 ? 0 : 1);
      }
      const hit = f.picker.intersect(rayThrough(f.mesh, .25), explode).find((candidate) => candidate.faceIndex === 1);
      assert.ok(hit);
      assert.deepEqual([hit.face.a, hit.face.b, hit.face.c], [3, 4, 5]);
    }
  } finally { f.dispose(); }
});

test('component picker returns all sorted hits so hidden and unmapped foreground can fall through', () => {
  const f = fixture();
  try {
    const hits = f.picker.intersect(rayThrough(f.mesh, -.5), 0);
    assert.deepEqual(hits.map((hit) => hit.faceIndex), [0, 1, 2]);
    const mapped = [null, -20, -30];
    const visible = new Set([-30]);
    const picked = hits.map((hit) => mapped[hit.faceIndex]).find((id) => id !== null && visible.has(id));
    assert.equal(picked, -30);
    // One-sided rollback geometry retains its sole presentation on either ML side.
    assert.equal(meshPresentationAtMl(originalMl(hits[0]), -1, -1, boundary), -1);
    assert.equal(meshPresentationAtMl(originalMl(hits[0]), -1, 42, boundary), 42);
    assert.equal(meshPresentationAtMl(originalMl(hits[0]), 42, -1, boundary), 42);
  } finally { f.dispose(); }
});

test('hidden side within one intact component does not conceal a farther visible side', () => {
  const f = fixture();
  f.picker.dispose();
  const offsets = f.geometry.getAttribute('explodeOffset');
  for (let vertex = 3; vertex < 6; vertex += 1) offsets.setXYZ(vertex, 4, 0, 0);
  const chunk = { ...f.chunk, ranges: [
    { componentId: 0, leftPresentationId: 0, rightPresentationId: 1, indexStart: 0, indexCount: 6, vertexStart: 0, vertexCount: 6 },
    f.chunk.ranges[2],
  ] };
  const picker = new ComponentMeshPicker([f.mesh], [chunk]);
  try {
    for (const explode of [0, .5, 1]) {
      const ray = new THREE.Raycaster(new THREE.Vector3(1.5 + 4 * explode, 0, 4), new THREE.Vector3(-.5, 0, -1).normalize());
      const hits = picker.intersect(ray, explode);
      assert.equal(hits[0].faceIndex, 0);
      assert.equal(hits[1].faceIndex, 1);
      assert.equal(meshPresentationAtMl(originalMl(hits[0]), 0, 1, boundary), 1);
      const visible = new Set([-315]);
      const picked = hits.map((hit) => [-315, 315][meshPresentationAtMl(originalMl(hit), 0, 1, boundary)]).find((id) => visible.has(id));
      assert.equal(picked, -315);
    }
  } finally { picker.dispose(); f.dispose(); }
});

test('component bounds reject misses before triangle traversal', () => {
  const f = fixture();
  const original = THREE.Mesh.prototype._computeIntersections;
  let traversals = 0;
  THREE.Mesh.prototype._computeIntersections = function (...args) { traversals += 1; return original.apply(this, args); };
  try {
    assert.deepEqual(f.picker.intersect(rayThrough(f.mesh, 100), 1), []);
    assert.equal(traversals, 0);
    // Only the translated foreground component occupies this ray.
    assert.equal(f.picker.intersect(rayThrough(f.mesh, 4.5), 1).length, 1);
    assert.equal(traversals, 1);
  } finally { THREE.Mesh.prototype._computeIntersections = original; f.dispose(); }
});

test('picking and disposal preserve render geometry arrays, draw range, bounds and ownership', () => {
  const f = fixture();
  const positions = f.chunk.positions.slice();
  const indices = f.chunk.indices.slice();
  const drawRange = { ...f.geometry.drawRange };
  const bounds = f.geometry.boundingBox.clone();
  let renderGeometryDisposals = 0;
  let renderMaterialDisposals = 0;
  f.geometry.addEventListener('dispose', () => { renderGeometryDisposals += 1; });
  f.material.addEventListener('dispose', () => { renderMaterialDisposals += 1; });
  try {
    for (const explode of [0, .5, 1, 0]) f.picker.intersect(rayThrough(f.mesh, .5), explode);
    f.picker.dispose();
    f.picker.dispose();
    assert.deepEqual(f.chunk.positions, positions);
    assert.deepEqual(f.chunk.indices, indices);
    assert.deepEqual(f.geometry.drawRange, drawRange);
    assert.ok(f.geometry.boundingBox.equals(bounds));
    assert.equal(renderGeometryDisposals, 0);
    assert.equal(renderMaterialDisposals, 0);
  } finally { f.dispose(); }
});
