# 3D renderer evaluation

Status: recommendation for a post-regional/volume vertical slice; 3D remains non-blocking for launch.

## Requirements checked

The renderer boundary must support:

- Allen brain region meshes;
- per-region colors, visibility, selection, and hover highlight;
- region picking;
- orbit/arcball-style camera interaction;
- a future 100k-500k point layer;
- current desktop Chrome/Edge, Firefox, and Safari;
- no coupling of application state to one graphics stack.

`Renderer3D`, `Renderer3DScene`, and `Renderer3DState` encode that boundary. Geometry loading is separate from feature/color/selection state so changing renderer technology does not change the application model.

## Existing IBL assets and behavior

Current `int-brain-lab/ibl-datoviz/ibl_datoviz/meshes.py` loads the Allen region mesh scene from `meshes.glb`, with geometries named by Allen region id (`<region_id>.obj`). It already treats region geometry and region color/visibility as separable concerns. A v2 web mesh release should reuse this source asset/provenance where practical rather than regenerate meshes independently.

The v1 website's Unity integration is a narrow JavaScript bridge. `js/unity.js` sends region acronym lists, color strings, visibility flags, and an exploded-view percentage through `SendMessage`. The Unity `Build/` and `StreamingAssets/` are deployed separately and are not present in the source repository (`download_webgl.sh` rsyncs them from the server). This makes Unity useful as a fallback deployment, but a poor foundation for a clean, reproducible v2 renderer contract.

## Candidate comparison

### Three.js: recommended first v2 3D spike

Current official Three.js APIs directly cover the required primitives:

- `GLTFLoader` loads glTF/GLB and supports meshopt/Draco integrations;
- `Mesh` + `BufferGeometry` cover region meshes;
- `Raycaster` handles mesh and point picking;
- `OrbitControls` covers orbit, zoom, pan, mouse, and touch;
- `Points` renders point clouds from a `BufferGeometry`;
- `WebGPURenderer` attempts WebGPU and can fall back to a WebGL2 backend.

The important caveat is also explicit in current Three.js documentation: `WebGPURenderer` is still experimental. Therefore the first production-oriented spike should use **Three.js WebGLRenderer/WebGL2**, behind `Renderer3D`, and benchmark the same scene with `WebGPURenderer` separately. This gives the lowest implementation risk while preserving a straightforward WebGPU migration path.

Per-region coloring can initially use one material/object per region from the GLB scene; picking maps the returned object to `regionId`. If draw-call count becomes material, merge geometry later while retaining a region id attribute/picking map. Do not optimize this before measuring the actual Allen GLB.

### Datoviz WebGPU/WASM: capable, but not the launch default

Current `datoviz/datoviz` browser work is materially beyond an early proof of concept: the WebGPU/WASM live surface includes meshes, picking, arcball/controller examples, retained updates, and dense point examples. Its compatibility notes also record a 500,000-point browser artifact/packet proof.

However, the same current `examples/webgpu/COMPAT.md` describes the browser runner as a strict subset and lists generic volume before brain volume among the remaining promotion work. The browser path also brings the WASM scene ABI, DRP2 stream/runtime, build tooling, and Datoviz-specific integration surface. That complexity is justified if v2 later needs Datoviz's broader scientific rendering capabilities, but it is unnecessary for the initial brain-mesh viewer.

Datoviz should remain a serious second spike, especially because IBL already has `ibl-datoviz` brain/point code. It should not block the regional/volume launch path.

### Custom WebGPU: reject for launch

WebGPU browser coverage is now much better than it was during v1: Chrome ships it, Firefox has shipped it on Windows, and Safari 26 added WebGPU on Apple platforms. This makes custom WebGPU technically plausible.

It still has the highest engineering surface for this viewer: GLB parsing, materials/lighting, camera controls, resize/device loss, picking or ID passes, point rendering, fallbacks, and browser-specific validation would all become project code. Those are solved problems in focused renderers. There is no launch-critical requirement that needs custom compute or rendering enough to justify this ownership cost.

### Legacy Unity: fallback only

Keeping the existing Unity view deployable is the lowest-risk emergency fallback if a 3D panel is required at launch. It is not the lowest-risk *v2 implementation*: its build artifacts are opaque to this repo, state crosses a string-based `SendMessage` bridge, and it adds a separate large runtime/toolchain. Do not invest in extending it unless product requirements make 3D launch-critical.

## 500k point budget

The technology-neutral scene fixture uses three float32 coordinates plus one float32 scalar and one uint32 stable id per point. For 500,000 points this is exactly 10,000,000 bytes (9.54 MiB) of source typed-array payload before GPU duplication/allocator overhead. Omitting ids until picking is needed reduces that by 1.91 MiB; deriving color on GPU avoids an additional CPU RGBA array.

This makes 100k-500k points realistic in a single/few GPU buffers. CPU `Raycaster` picking across 500k points must be measured; if it is too slow, use a spatial index or renderer-specific GPU picking behind the same event contract.

## Browser strategy

For launch-quality compatibility, 3D must feature-detect and fail closed without affecting the regional/volume viewer. A missing/failed 3D renderer should leave the rest of the app fully functional.

Recommended order:

1. load the real Allen `meshes.glb` in a Three.js WebGL2 spike;
2. measure compressed GLB bytes, parse time, first frame, draw calls, GPU/JS memory, region recolor, and raycast latency;
3. test Chrome/Edge, Firefox, and Safari on the same fixture;
4. repeat the fixture with Three.js `WebGPURenderer` and Datoviz WebGPU/WASM;
5. choose only after those measurements. Until then, 3D remains optional.
