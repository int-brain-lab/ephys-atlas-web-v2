import * as THREE from 'three';

/** Weighted blended OIT, using two passes instead of per-attachment blend extensions.
 * Accumulation and revealage are linear; output conversion happens once at composite.
 * https://jcgt.org/published/0002/02/09/
 */
export const TRANSPARENCY_FRAGMENT = `
uniform int uPass;
uniform sampler2D uOpaqueDepth;
uniform vec2 uViewport;
uniform float uFar;
varying float vViewDepth;
vec4 transparencyOutput(vec4 color) {
  if (uPass == 0) {
    if (color.a < .999) discard;
    return linearToOutputTexel(vec4(color.rgb, 1.));
  }
  if (color.a >= .999 || gl_FragCoord.z > texture2D(uOpaqueDepth, gl_FragCoord.xy / uViewport).r) discard;
  if (uPass == 2) return vec4(0., 0., 0., color.a);
  float z = clamp(vViewDepth / uFar, 0., 1.);
  float weight = clamp(pow(min(1., color.a * 10.) + .01, 3.) * 1000. * pow(1. - .9 * z, 3.), .01, 300.);
  return vec4(color.rgb * color.a, color.a) * weight;
}
`;

type AnatomyMesh = THREE.Mesh<THREE.BufferGeometry, THREE.ShaderMaterial>;

export class WeightedTransparency {
  private readonly opaque = new THREE.WebGLRenderTarget(1, 1, { type: THREE.HalfFloatType });
  private readonly accumulation = new THREE.WebGLRenderTarget(1, 1, { type: THREE.HalfFloatType, depthBuffer: false });
  private readonly revealage = new THREE.WebGLRenderTarget(1, 1, { depthBuffer: false });
  private readonly scene = new THREE.Scene();
  private readonly camera = new THREE.Camera();
  private readonly material: THREE.ShaderMaterial;
  private readonly quad: THREE.Mesh;
  private readonly size = new THREE.Vector2();

  constructor() {
    this.opaque.depthTexture = new THREE.DepthTexture(1, 1, THREE.UnsignedIntType);
    for (const target of [this.opaque, this.accumulation, this.revealage]) {
      target.texture.minFilter = THREE.NearestFilter;
      target.texture.magFilter = THREE.NearestFilter;
      target.texture.generateMipmaps = false;
    }
    this.material = new THREE.ShaderMaterial({
      depthTest: false, depthWrite: false, blending: THREE.NoBlending,
      uniforms: { uOpaque: { value: this.opaque.texture }, uAccumulation: { value: this.accumulation.texture }, uRevealage: { value: this.revealage.texture } },
      vertexShader: 'varying vec2 vUv; void main(){ vUv=uv; gl_Position=vec4(position.xy,0.,1.); }',
      fragmentShader: `uniform sampler2D uOpaque; uniform sampler2D uAccumulation; uniform sampler2D uRevealage; varying vec2 vUv;
        void main(){
          vec4 accum=texture2D(uAccumulation,vUv);
          float reveal=texture2D(uRevealage,vUv).r;
          vec3 transparentColor=accum.rgb/max(accum.a,.00001);
          vec3 color=transparentColor*(1.-reveal)+texture2D(uOpaque,vUv).rgb*reveal;
          gl_FragColor=linearToOutputTexel(vec4(color,1.));
        }`,
    });
    this.quad = new THREE.Mesh(new THREE.PlaneGeometry(2, 2), this.material);
    this.quad.frustumCulled = false;
    this.scene.add(this.quad);
  }

  render(renderer: THREE.WebGLRenderer, scene: THREE.Scene, camera: THREE.PerspectiveCamera, meshes: readonly AnatomyMesh[]): void {
    renderer.getDrawingBufferSize(this.size);
    for (const target of [this.opaque, this.accumulation, this.revealage]) {
      if (target.width !== this.size.x || target.height !== this.size.y) target.setSize(this.size.x, this.size.y);
    }
    const background = scene.background;
    const clearColor = renderer.getClearColor(new THREE.Color());
    const clearAlpha = renderer.getClearAlpha();
    const previousTarget = renderer.getRenderTarget();
    const autoClear = renderer.autoClear;
    renderer.autoClear = false;
    try {
      for (const mesh of meshes) {
        mesh.material.uniforms.uOpaqueDepth!.value = this.opaque.depthTexture;
        mesh.material.uniforms.uViewport!.value = this.size;
        mesh.material.uniforms.uFar!.value = camera.far;
      }
      this.pass(meshes, 0);
      renderer.setRenderTarget(this.opaque);
      renderer.setClearColor(background instanceof THREE.Color ? background : clearColor, 1);
      renderer.clear();
      renderer.render(scene, camera);
      scene.background = null;
      this.pass(meshes, 1);
      renderer.setRenderTarget(this.accumulation);
      renderer.setClearColor(0, 0);
      renderer.clear();
      renderer.render(scene, camera);
      this.pass(meshes, 2);
      renderer.setRenderTarget(this.revealage);
      renderer.setClearColor(0xffffff, 1);
      renderer.clear();
      renderer.render(scene, camera);
      renderer.setRenderTarget(previousTarget);
      renderer.render(this.scene, this.camera);
    } finally {
      this.pass(meshes, 0);
      scene.background = background;
      renderer.setRenderTarget(previousTarget);
      renderer.setClearColor(clearColor, clearAlpha);
      renderer.autoClear = autoClear;
    }
  }

  private pass(meshes: readonly AnatomyMesh[], pass: number): void {
    for (const { material } of meshes) {
      material.uniforms.uPass!.value = pass;
      // Never sample a texture attached to the active framebuffer, even in a disabled shader branch.
      material.uniforms.uOpaqueDepth!.value = pass === 0 ? null : this.opaque.depthTexture;
      material.depthWrite = pass === 0;
      material.depthTest = pass === 0;
      material.blending = pass === 0 ? THREE.NoBlending : THREE.CustomBlending;
      material.blendEquation = THREE.AddEquation;
      material.blendSrc = pass === 2 ? THREE.ZeroFactor : THREE.OneFactor;
      material.blendDst = pass === 2 ? THREE.OneMinusSrcAlphaFactor : THREE.OneFactor;
    }
  }

  dispose(): void {
    this.opaque.depthTexture?.dispose();
    this.opaque.dispose(); this.accumulation.dispose(); this.revealage.dispose();
    this.quad.geometry.dispose(); this.material.dispose();
  }
}
