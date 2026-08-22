import { PerspectiveCamera, Quaternion, Vector2, Vector3 } from 'three';

export type CameraInteractionPhase = 'start' | 'change' | 'end';

export function screenToArcball(x: number, y: number): Vector3 {
  const distance = x * x + y * y;
  return distance <= 1 ? new Vector3(x, y, Math.sqrt(1 - distance)) : new Vector3(x, y, 0).normalize();
}

export function arcballDragQuaternion(start: Readonly<Vector3>, current: Readonly<Vector3>): Quaternion {
  return new Quaternion().setFromUnitVectors(start, current).normalize();
}

/** Press-referenced arcball: a closed drag returns to the pointer-down pose. */
export class StableArcballControls {
  readonly target = new Vector3();
  enabled = true;
  private mode: 'rotate' | 'pan' | null = null;
  private pointerId: number | null = null;
  private readonly pressPixel = new Vector2();
  private readonly pressBall = new Vector3();
  private readonly pressPosition = new Vector3();
  private readonly pressTarget = new Vector3();
  private readonly pressUp = new Vector3();
  private readonly pressCameraQuaternion = new Quaternion();
  private readonly homePosition = new Vector3();
  private readonly homeTarget = new Vector3();
  private readonly homeUp = new Vector3();
  private hasHome = false;

  constructor(
    private readonly camera: PerspectiveCamera,
    private readonly element: HTMLElement,
    private readonly onInteraction: (phase: CameraInteractionPhase) => void = () => undefined,
  ) {
    element.style.touchAction = 'none';
    element.addEventListener('pointerdown', this.onPointerDown);
    element.addEventListener('pointermove', this.onPointerMove);
    element.addEventListener('pointerup', this.onPointerUp);
    element.addEventListener('pointercancel', this.onPointerUp);
    element.addEventListener('wheel', this.onWheel, { passive: false });
    element.addEventListener('contextmenu', this.onContextMenu);
  }

  saveState(): void {
    this.homePosition.copy(this.camera.position);
    this.homeTarget.copy(this.target);
    this.homeUp.copy(this.camera.up);
    this.hasHome = true;
  }

  reset(): boolean {
    if (!this.hasHome) return false;
    this.camera.position.copy(this.homePosition);
    this.target.copy(this.homeTarget);
    this.camera.up.copy(this.homeUp);
    this.camera.lookAt(this.target);
    this.camera.updateProjectionMatrix();
    this.onInteraction('change');
    return true;
  }

  dispose(): void {
    this.element.removeEventListener('pointerdown', this.onPointerDown);
    this.element.removeEventListener('pointermove', this.onPointerMove);
    this.element.removeEventListener('pointerup', this.onPointerUp);
    this.element.removeEventListener('pointercancel', this.onPointerUp);
    this.element.removeEventListener('wheel', this.onWheel);
    this.element.removeEventListener('contextmenu', this.onContextMenu);
    this.element.style.touchAction = '';
  }

  private readonly onPointerDown = (event: PointerEvent): void => {
    if (!this.enabled || this.pointerId !== null || ![0, 1, 2].includes(event.button)) return;
    this.pointerId = event.pointerId;
    this.mode = event.button === 0 ? 'rotate' : 'pan';
    this.pressPixel.set(event.clientX, event.clientY);
    this.pressPosition.copy(this.camera.position);
    this.pressTarget.copy(this.target);
    this.pressUp.copy(this.camera.up);
    this.pressCameraQuaternion.copy(this.camera.quaternion);
    this.pressBall.copy(this.pointerBall(event));
    this.element.setPointerCapture(event.pointerId);
    this.onInteraction('start');
    event.preventDefault();
  };

  private readonly onPointerMove = (event: PointerEvent): void => {
    if (!this.enabled || event.pointerId !== this.pointerId || this.mode === null) return;
    if (this.mode === 'rotate') this.rotate(event); else this.pan(event);
    this.onInteraction('change');
    event.preventDefault();
  };

  private readonly onPointerUp = (event: PointerEvent): void => {
    if (event.pointerId !== this.pointerId) return;
    if (this.element.hasPointerCapture(event.pointerId)) this.element.releasePointerCapture(event.pointerId);
    this.pointerId = null;
    this.mode = null;
    this.onInteraction('end');
  };

  private readonly onWheel = (event: WheelEvent): void => {
    if (!this.enabled) return;
    const offset = this.camera.position.clone().sub(this.target);
    const nextDistance = Math.max(10, Math.min(100_000, offset.length() * Math.exp(event.deltaY * .001)));
    this.camera.position.copy(this.target).add(offset.setLength(nextDistance));
    this.camera.lookAt(this.target);
    this.onInteraction('change');
    event.preventDefault();
  };

  private readonly onContextMenu = (event: Event): void => event.preventDefault();

  private rotate(event: PointerEvent): void {
    const local = arcballDragQuaternion(this.pressBall, this.pointerBall(event));
    const world = this.pressCameraQuaternion.clone().multiply(local)
      .multiply(this.pressCameraQuaternion.clone().invert()).invert();
    this.camera.position.copy(this.pressTarget).add(this.pressPosition.clone().sub(this.pressTarget).applyQuaternion(world));
    this.camera.up.copy(this.pressUp).applyQuaternion(world).normalize();
    this.target.copy(this.pressTarget);
    this.camera.lookAt(this.target);
  }

  private pan(event: PointerEvent): void {
    const height = Math.max(1, this.element.getBoundingClientRect().height);
    const scale = 2 * this.pressPosition.distanceTo(this.pressTarget)
      * Math.tan((this.camera.fov * Math.PI / 180) / 2) / height;
    const right = new Vector3(1, 0, 0).applyQuaternion(this.pressCameraQuaternion);
    const up = new Vector3(0, 1, 0).applyQuaternion(this.pressCameraQuaternion);
    const shift = right.multiplyScalar(-(event.clientX - this.pressPixel.x) * scale)
      .add(up.multiplyScalar((event.clientY - this.pressPixel.y) * scale));
    this.target.copy(this.pressTarget).add(shift);
    this.camera.position.copy(this.pressPosition).add(shift);
    this.camera.lookAt(this.target);
  }

  private pointerBall(event: PointerEvent): Vector3 {
    const bounds = this.element.getBoundingClientRect();
    return screenToArcball(
      -1 + 2 * (event.clientX - bounds.left) / Math.max(1, bounds.width),
      1 - 2 * (event.clientY - bounds.top) / Math.max(1, bounds.height),
    );
  }
}
