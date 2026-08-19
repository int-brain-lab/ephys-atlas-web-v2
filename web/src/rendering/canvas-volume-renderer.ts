import type { VolumeSliceFrame, VolumeSliceRenderer } from './types.js';

export class CanvasVolumeSliceRenderer implements VolumeSliceRenderer {
  private readonly context: CanvasRenderingContext2D;
  private readonly canvas: HTMLCanvasElement;

  constructor(canvas: HTMLCanvasElement) {
    this.canvas = canvas;
    const context = canvas.getContext('2d', { alpha: true });
    if (!context) throw new Error('2D canvas is unavailable');
    this.context = context;
  }

  render(frame: VolumeSliceFrame): void {
    if (this.canvas.width !== frame.width) this.canvas.width = frame.width;
    if (this.canvas.height !== frame.height) this.canvas.height = frame.height;
    const image = new ImageData(frame.rgba, frame.width, frame.height);
    this.context.putImageData(image, 0, 0);
  }

  dispose(): void {
    this.context.clearRect(0, 0, this.canvas.width, this.canvas.height);
  }
}
