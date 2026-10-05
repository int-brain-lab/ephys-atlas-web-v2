import * as THREE from 'three';
import type { MeshChunk } from './mesh-pack-codec.js';

interface PickComponent {
  readonly mesh: THREE.Mesh;
  readonly source: THREE.Mesh;
  readonly displacement: THREE.Vector3;
}

/** CPU-only component bounds; render buffers and triangle order remain immutable. */
export class ComponentMeshPicker {
  private readonly components: PickComponent[] = [];
  private readonly translation = new THREE.Matrix4();
  private readonly hits: THREE.Intersection[] = [];

  constructor(meshes: readonly THREE.Mesh[], chunks: readonly MeshChunk[]) {
    const point = new THREE.Vector3();
    try {
      chunks.forEach((chunk, chunkIndex) => {
        const source = meshes[chunkIndex];
        if (!source) throw new Error(`Picking mesh ${chunkIndex} is unavailable`);
        const position = source.geometry.getAttribute('position');
        const offset = source.geometry.getAttribute('explodeOffset');
        for (const range of chunk.ranges) {
          const geometry = new THREE.BufferGeometry();
          for (const [name, attribute] of Object.entries(source.geometry.attributes)) {
            geometry.setAttribute(name, attribute);
          }
          geometry.setIndex(source.geometry.index);
          geometry.setDrawRange(range.indexStart, range.indexCount);
          const bounds = new THREE.Box3();
          for (let vertex = range.vertexStart; vertex < range.vertexStart + range.vertexCount; vertex += 1) {
            bounds.expandByPoint(point.fromBufferAttribute(position, vertex));
          }
          geometry.boundingBox = bounds;
          geometry.boundingSphere = bounds.getBoundingSphere(new THREE.Sphere());
          this.components.push({
            mesh: new THREE.Mesh(geometry, source.material),
            source,
            displacement: new THREE.Vector3().fromBufferAttribute(offset, range.vertexStart),
          });
        }
      });
    } catch (error) {
      this.dispose();
      throw error;
    }
  }

  intersect(raycaster: THREE.Raycaster, explode: number): readonly THREE.Intersection[] {
    this.hits.length = 0;
    for (const { mesh, source, displacement } of this.components) {
      this.translation.makeTranslation(displacement.x * explode, displacement.y * explode, displacement.z * explode);
      mesh.matrixWorld.copy(source.matrixWorld).multiply(this.translation);
      // Tight bounds reject components before Three.js visits their triangles.
      // Keep every hit: a nearer hidden/unmapped face may precede a visible one.
      mesh.raycast(raycaster, this.hits);
    }
    this.hits.sort((a, b) => a.distance - b.distance);
    return this.hits;
  }

  dispose(): void {
    // These wrappers never enter the GPU scene. Their buffers/materials belong
    // to the render meshes and are disposed by the viewport, not this index.
    for (const { mesh } of this.components) mesh.geometry.dispose();
    this.components.length = 0;
    this.hits.length = 0;
  }
}
