import * as THREE from 'three';
import type { RegionalPresentation } from '../../application/regional-presentation.js';
import type { BrainCameraPose, Scene3DViewState } from '../../domain/types.js';
import type { MeshPackV1, MeshRegionV1 } from '../../data/schema-v1.js';
import type { LoadedMeshLod, MeshPackSource } from './mesh-pack-source.js';
import { StableArcballControls, type CameraInteractionPhase } from './stable-arcball-controls.js';

export type { BrainCameraPose, Scene3DViewState } from '../../domain/types.js';

export type { RegionalPresentation } from '../../application/regional-presentation.js';

export interface BrainScene3DInteractionSink {
  regionPointer?(event: { type: 'hover' | 'leave' | 'select'; regionId: number | null; originalEvent: PointerEvent }): void;
  cameraChanged?(pose: BrainCameraPose, phase: CameraInteractionPhase): void;
  error?(error: Error): void;
}

export interface BrainScene3DViewport {
  setPresentation(presentation: RegionalPresentation): void;
  setViewState(state: Scene3DViewState): void;
  activate(): void;
  deactivate(): void;
  destroy(): void;
}

export interface BrainScene3DViewportFactory {
  create(host: HTMLElement): BrainScene3DViewport;
  setInteractionSink(sink: BrainScene3DInteractionSink): void;
  destroy(): void;
}

interface MeshPackLoader {
  loadManifest(signal?: AbortSignal): Promise<MeshPackV1>;
  loadDefault(signal?: AbortSignal): Promise<LoadedMeshLod>;
  loadUpgrade(signal?: AbortSignal): Promise<LoadedMeshLod | null>;
  dispose(): void;
}

interface ManifestGeometryMetadata {
  readonly whole_brain_centroid_um?: readonly [number, number, number];
  readonly explode_groups?: readonly { signed_group_id: number; centroid_um: readonly [number, number, number] }[];
}

const DEFAULT_PRESENTATION: RegionalPresentation = {
  mapping: 'allen', anatomyColors: new Map(), featureColors: null,
  visibleRegionIds: new Set(), selectedRegionIds: new Set(), highlightedRegionId: null, featureSide: null,
};

export class RetainedBrainScene3DViewportFactory implements BrainScene3DViewportFactory {
  private sink: BrainScene3DInteractionSink = {};
  private readonly viewports = new Set<RetainedBrainScene3DViewport>();
  private destroyed = false;

  constructor(private readonly source: MeshPackLoader | MeshPackSource) {}

  create(host: HTMLElement): BrainScene3DViewport {
    if (this.destroyed) throw new Error('3-D viewport factory was destroyed');
    const viewport = new RetainedBrainScene3DViewport(host, this.source, () => this.sink, () => this.viewports.delete(viewport));
    this.viewports.add(viewport);
    return viewport;
  }

  setInteractionSink(sink: BrainScene3DInteractionSink): void { this.sink = sink; }

  destroy(): void {
    if (this.destroyed) return;
    this.destroyed = true;
    for (const viewport of [...this.viewports]) viewport.destroy();
    this.source.dispose();
  }
}

class RetainedBrainScene3DViewport implements BrainScene3DViewport {
  private readonly canvas = document.createElement('canvas');
  private readonly renderer: THREE.WebGLRenderer;
  private readonly scene = new THREE.Scene();
  private readonly camera = new THREE.PerspectiveCamera(38, 1, .01, 100_000);
  private readonly controls: StableArcballControls;
  private readonly resizeObserver: ResizeObserver;
  private readonly abort = new AbortController();
  private readonly raycaster = new THREE.Raycaster();
  private readonly pointer = new THREE.Vector2();
  private meshes: THREE.Mesh<THREE.BufferGeometry, THREE.ShaderMaterial>[] = [];
  private manifest: MeshPackV1 | null = null;
  private presentation = DEFAULT_PRESENTATION;
  private state: Scene3DViewState = { explode: 0, camera: null };
  private active = false;
  private resumeAfterContextRestore = false;
  private destroyed = false;
  private frame: number | null = null;
  private resizeFrame: number | null = null;
  private geometryUploads = 0;
  private pointerPress: { id: number; x: number; y: number } | null = null;
  private hovered: number | null = null;

  constructor(
    private readonly host: HTMLElement,
    private readonly source: MeshPackLoader | MeshPackSource,
    private readonly sink: () => BrainScene3DInteractionSink,
    private readonly onDestroy: () => void,
  ) {
    host.replaceChildren(this.canvas);
    host.dataset.scene3dState = 'loading';
    host.dataset.geometryUploads = '0';
    this.renderer = new THREE.WebGLRenderer({ canvas: this.canvas, antialias: true, powerPreference: 'high-performance' });
    this.renderer.outputColorSpace = THREE.SRGBColorSpace;
    this.scene.background = new THREE.Color('#09141e');
    this.camera.up.set(0, 0, 1);
    this.controls = new StableArcballControls(this.camera, this.canvas, (phase) => {
      this.scheduleRender();
      this.sink().cameraChanged?.(this.cameraPose(), phase);
    });
    this.scene.add(new THREE.HemisphereLight('#ffffff', '#78909c', 2.1));
    const key = new THREE.DirectionalLight('#ffffff', 2.8);
    key.position.set(-4, -3, 8);
    this.scene.add(key);
    this.resizeObserver = new ResizeObserver(() => {
      if (this.resizeFrame !== null) return;
      this.resizeFrame = requestAnimationFrame(() => { this.resizeFrame = null; this.resize(); });
    });
    this.resizeObserver.observe(host);
    this.canvas.addEventListener('pointerdown', this.onPointerDown);
    this.canvas.addEventListener('pointermove', this.onPointerMove);
    this.canvas.addEventListener('pointerleave', this.onPointerLeave);
    this.canvas.addEventListener('pointerup', this.onPointerUp);
    this.canvas.addEventListener('dblclick', this.onDoubleClick);
    this.canvas.addEventListener('webglcontextlost', this.onContextLost);
    this.canvas.addEventListener('webglcontextrestored', this.onContextRestored);
    void this.load();
  }

  setPresentation(presentation: RegionalPresentation): void {
    this.assertActiveObject();
    this.presentation = presentation;
    this.updateLookupTextures();
    this.scheduleRender();
  }

  setViewState(state: Scene3DViewState): void {
    this.assertActiveObject();
    const explode = Number.isFinite(state.explode) ? Math.max(0, Math.min(1, state.explode)) : 0;
    this.state = { explode, camera: state.camera };
    for (const mesh of this.meshes) mesh.material.uniforms.uExplode!.value = explode;
    if (state.camera) this.applyCamera(state.camera);
    this.host.dataset.explode = String(explode);
    this.scheduleRender();
  }

  activate(): void { this.assertActiveObject(); this.active = true; this.host.dataset.active = 'true'; this.controls.enabled = true; this.scheduleRender(); }
  deactivate(): void { this.active = false; this.host.dataset.active = 'false'; this.controls.enabled = false; if (this.frame !== null) cancelAnimationFrame(this.frame); this.frame = null; }

  destroy(): void {
    if (this.destroyed) return;
    this.destroyed = true;
    this.deactivate();
    this.abort.abort();
    if (this.resizeFrame !== null) cancelAnimationFrame(this.resizeFrame);
    this.resizeFrame = null;
    this.resizeObserver.disconnect();
    this.controls.dispose();
    this.canvas.removeEventListener('pointerdown', this.onPointerDown);
    this.canvas.removeEventListener('pointermove', this.onPointerMove);
    this.canvas.removeEventListener('pointerleave', this.onPointerLeave);
    this.canvas.removeEventListener('pointerup', this.onPointerUp);
    this.canvas.removeEventListener('dblclick', this.onDoubleClick);
    this.canvas.removeEventListener('webglcontextlost', this.onContextLost);
    this.canvas.removeEventListener('webglcontextrestored', this.onContextRestored);
    this.disposeMeshes(this.meshes);
    this.renderer.dispose();
    this.canvas.remove();
    this.host.dataset.scene3dState = 'destroyed';
    this.onDestroy();
  }

  private async load(): Promise<void> {
    try {
      const [manifest, lod] = await Promise.all([
        this.source.loadManifest(this.abort.signal), this.source.loadDefault(this.abort.signal),
      ]);
      if (this.destroyed) return;
      this.manifest = manifest;
      this.installLod(lod);
      this.frameCamera();
      if (this.state.camera) this.applyCamera(this.state.camera);
      this.host.dataset.scene3dState = 'ready';
      this.host.dataset.lod = lod.id;
      this.scheduleRender();
      void this.loadUpgrade();
    } catch (error) { this.fail(error); }
  }

  private async loadUpgrade(): Promise<void> {
    try {
      const upgrade = await this.source.loadUpgrade(this.abort.signal);
      if (!upgrade || this.destroyed) return;
      const previous = this.meshes;
      const next = this.buildMeshes(upgrade);
      this.meshes = next;
      for (const mesh of previous) this.scene.remove(mesh);
      for (const mesh of next) this.scene.add(mesh);
      this.disposeMeshes(previous);
      this.updateLookupTextures();
      this.host.dataset.lod = upgrade.id;
      this.scheduleRender();
    } catch (error) {
      if (!this.abort.signal.aborted) {
        this.host.dataset.upgradeError = 'true';
        this.sink().error?.(error instanceof Error ? error : new Error(String(error)));
      }
    }
  }

  private installLod(lod: LoadedMeshLod): void {
    const next = this.buildMeshes(lod);
    for (const mesh of this.meshes) this.scene.remove(mesh);
    this.disposeMeshes(this.meshes);
    this.meshes = next;
    for (const mesh of next) this.scene.add(mesh);
    this.updateLookupTextures();
  }

  private buildMeshes(lod: LoadedMeshLod): THREE.Mesh<THREE.BufferGeometry, THREE.ShaderMaterial>[] {
    if (!this.manifest) throw new Error('Mesh manifest is unavailable');
    const metadata = this.manifest as MeshPackV1 & ManifestGeometryMetadata;
    const center = metadata.whole_brain_centroid_um ?? [0, 0, 0];
    const groups = new Map((metadata.explode_groups ?? []).map((group) => [group.signed_group_id, group.centroid_um]));
    const meshes: THREE.Mesh<THREE.BufferGeometry, THREE.ShaderMaterial>[] = [];
    try {
      for (const chunk of lod.chunks) {
        const geometry = new THREE.BufferGeometry();
        geometry.setAttribute('position', new THREE.BufferAttribute(chunk.positions, 3));
        geometry.setAttribute('normal', new THREE.BufferAttribute(chunk.normals, 3));
        geometry.setAttribute('featureId', new THREE.BufferAttribute(chunk.featureIds, 1));
        const explode = new Float32Array(chunk.featureIds.length * 3);
        for (const range of chunk.ranges) {
          const centroid = groups.get(range.signedExplodeGroupId) ?? center;
          const direction = new THREE.Vector3(centroid[0] - center[0], centroid[1] - center[1], centroid[2] - center[2]);
          for (let vertex = range.vertexStart; vertex < range.vertexStart + range.vertexCount; vertex += 1) {
            explode.set(direction.toArray(), vertex * 3);
          }
        }
        geometry.setAttribute('explodeOffset', new THREE.BufferAttribute(explode, 3));
        geometry.setIndex(new THREE.BufferAttribute(chunk.indices, 1));
        geometry.computeBoundingSphere();
        const lookup = this.createLookupTexture();
        const material = new THREE.ShaderMaterial({
          transparent: true,
          side: THREE.DoubleSide,
          uniforms: { uLookup: { value: lookup }, uLookupWidth: { value: this.manifest!.regions.length }, uExplode: { value: this.state.explode } },
          vertexShader: `attribute float featureId; attribute vec3 explodeOffset; uniform sampler2D uLookup; uniform float uLookupWidth; uniform float uExplode; varying vec3 vNormal; varying vec4 vColor; void main(){ vColor=texture2D(uLookup,vec2((featureId+.5)/uLookupWidth,.5)); vNormal=normalize(normalMatrix*normal); gl_Position=projectionMatrix*modelViewMatrix*vec4(position+explodeOffset*uExplode,1.); }`,
          fragmentShader: `varying vec3 vNormal; varying vec4 vColor; void main(){ if(vColor.a<.01) discard; float light=.38+.62*abs(dot(normalize(vNormal),normalize(vec3(-.3,.4,.85)))); gl_FragColor=vec4(vColor.rgb*light,vColor.a); }`,
        });
        const mesh = new THREE.Mesh(geometry, material);
        mesh.userData.hemisphere = chunk.hemisphere;
        this.geometryUploads += 1;
        this.host.dataset.geometryUploads = String(this.geometryUploads);
        meshes.push(mesh);
      }
      return meshes;
    } catch (error) {
      this.disposeMeshes(meshes);
      throw error;
    }
  }

  private createLookupTexture(): THREE.DataTexture {
    const count = Math.max(1, this.manifest?.regions.length ?? 1);
    const texture = new THREE.DataTexture(new Uint8Array(count * 4), count, 1, THREE.RGBAFormat);
    texture.magFilter = THREE.NearestFilter;
    texture.minFilter = THREE.NearestFilter;
    texture.needsUpdate = true;
    return texture;
  }

  private updateLookupTextures(): void {
    if (!this.manifest) return;
    for (const mesh of this.meshes) {
      const texture = mesh.material.uniforms.uLookup!.value as THREE.DataTexture;
      const bytes = texture.image.data as Uint8Array;
      const regions: readonly MeshRegionV1[] = this.manifest.regions;
      regions.forEach((region: MeshRegionV1) => {
        const id = this.presentationId(region);
        const visible = id !== null && this.presentation.visibleRegionIds.has(id);
        const selected = id !== null && this.presentation.selectedRegionIds.has(id);
        const highlighted = id !== null && this.presentation.highlightedRegionId === id;
        const featureColor = id === null || (this.presentation.featureSide === 'left' && region.hemisphere !== 'left')
          ? undefined : this.presentation.featureColors?.get(id);
        const color = new THREE.Color(featureColor
          ?? (id === null ? undefined : this.presentation.anatomyColors.get(id)) ?? '#73818b');
        const intensity = selected ? 1.35 : highlighted ? 1.18 : 1;
        const offset = region.feature_id * 4;
        bytes[offset] = Math.min(255, Math.round(color.r * 255 * intensity));
        bytes[offset + 1] = Math.min(255, Math.round(color.g * 255 * intensity));
        bytes[offset + 2] = Math.min(255, Math.round(color.b * 255 * intensity));
        bytes[offset + 3] = visible ? (this.presentation.selectedRegionIds.size && !selected ? 28 : 255) : 0;
      });
      texture.needsUpdate = true;
    }
    this.host.dataset.presentationUpdates = String(Number(this.host.dataset.presentationUpdates ?? 0) + 1);
  }

  private presentationId(region: MeshRegionV1): number | null { return region.mappings[this.presentation.mapping]; }

  private pick(event: PointerEvent): number | null {
    if (!this.manifest) return null;
    const bounds = this.canvas.getBoundingClientRect();
    this.pointer.set(2 * (event.clientX - bounds.left) / Math.max(1, bounds.width) - 1, 1 - 2 * (event.clientY - bounds.top) / Math.max(1, bounds.height));
    this.raycaster.setFromCamera(this.pointer, this.camera);
    for (const hit of this.raycaster.intersectObjects(this.meshes, false)) {
      const feature = (hit.object as THREE.Mesh).geometry.getAttribute('featureId').getX(hit.face!.a);
      const region = this.manifest.regions[feature];
      if (!region) continue;
      const id = this.presentationId(region);
      if (id !== null && this.presentation.visibleRegionIds.has(id)) return id;
    }
    return null;
  }

  private readonly onPointerDown = (event: PointerEvent): void => { if (event.button === 0) this.pointerPress = { id: event.pointerId, x: event.clientX, y: event.clientY }; };
  private readonly onPointerMove = (event: PointerEvent): void => {
    const next = this.pick(event);
    if (next === this.hovered) return;
    this.hovered = next;
    this.sink().regionPointer?.({ type: next === null ? 'leave' : 'hover', regionId: next, originalEvent: event });
  };
  private readonly onPointerLeave = (event: PointerEvent): void => { this.hovered = null; this.sink().regionPointer?.({ type: 'leave', regionId: null, originalEvent: event }); };
  private readonly onPointerUp = (event: PointerEvent): void => {
    const press = this.pointerPress;
    this.pointerPress = null;
    if (!press || press.id !== event.pointerId || Math.hypot(event.clientX - press.x, event.clientY - press.y) > 4) return;
    const id = this.pick(event);
    if (id !== null) this.sink().regionPointer?.({ type: 'select', regionId: id, originalEvent: event });
  };
  private readonly onDoubleClick = (event: MouseEvent): void => { if (this.controls.reset()) { this.scheduleRender(); event.preventDefault(); } };
  private readonly onContextLost = (event: Event): void => {
    event.preventDefault();
    this.resumeAfterContextRestore = this.active;
    this.deactivate();
    this.host.dataset.scene3dState = 'context-lost';
  };
  private readonly onContextRestored = (): void => {
    this.host.dataset.scene3dState = 'ready';
    this.active = this.resumeAfterContextRestore;
    this.controls.enabled = this.active;
    this.scheduleRender();
  };

  private resize(): void {
    if (this.destroyed) return;
    const bounds = this.host.getBoundingClientRect();
    const width = Math.max(1, Math.round(bounds.width));
    const height = Math.max(1, Math.round(bounds.height));
    this.renderer.setPixelRatio(Math.min(devicePixelRatio, 2));
    this.renderer.setSize(width, height, false);
    this.camera.aspect = width / height;
    this.camera.updateProjectionMatrix();
    this.scheduleRender();
  }

  private frameCamera(): void {
    const bounds = new THREE.Box3();
    for (const mesh of this.meshes) bounds.expandByObject(mesh);
    const sphere = bounds.getBoundingSphere(new THREE.Sphere());
    const radius = Math.max(.5, sphere.radius);
    this.controls.target.copy(sphere.center);
    // Look along AP so bilateral ML geometry is visible side-by-side for picking.
    this.camera.position.copy(sphere.center).add(new THREE.Vector3(0, -radius * 4, radius * 2.2));
    this.camera.near = Math.max(.01, radius / 100);
    this.camera.far = radius * 20;
    this.camera.lookAt(sphere.center);
    this.camera.updateProjectionMatrix();
    this.controls.saveState();
  }

  private applyCamera(pose: BrainCameraPose): void {
    this.camera.position.fromArray(pose.positionUm);
    this.controls.target.fromArray(pose.targetUm);
    this.camera.up.fromArray(pose.up).normalize();
    this.camera.lookAt(this.controls.target);
  }

  private cameraPose(): BrainCameraPose {
    const tuple = (vector: THREE.Vector3): readonly [number, number, number] => [vector.x, vector.y, vector.z];
    return { positionUm: tuple(this.camera.position), targetUm: tuple(this.controls.target), up: tuple(this.camera.up) };
  }

  private scheduleRender(): void {
    if (!this.active || this.destroyed || this.frame !== null) return;
    this.frame = requestAnimationFrame(() => {
      this.frame = null;
      if (!this.active || this.destroyed) return;
      this.renderer.render(this.scene, this.camera);
      this.host.dataset.renderCount = String(Number(this.host.dataset.renderCount ?? 0) + 1);
    });
  }

  private disposeMeshes(meshes: readonly THREE.Mesh<THREE.BufferGeometry, THREE.ShaderMaterial>[]): void {
    for (const mesh of meshes) {
      (mesh.material.uniforms.uLookup!.value as THREE.Texture).dispose();
      mesh.material.dispose();
      mesh.geometry.dispose();
    }
  }

  private fail(error: unknown): void {
    if (this.abort.signal.aborted) return;
    const normalized = error instanceof Error ? error : new Error(String(error));
    this.host.dataset.scene3dState = 'error';
    this.host.dataset.error = normalized.message;
    this.sink().error?.(normalized);
  }

  private assertActiveObject(): void { if (this.destroyed) throw new Error('3-D viewport was destroyed'); }
}
