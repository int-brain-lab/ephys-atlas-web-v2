export type PrefetchTask = (signal: AbortSignal) => Promise<void>;

type IdleWindow = Window & {
  requestIdleCallback?: (callback: IdleRequestCallback, options?: IdleRequestOptions) => number;
};

export class PrefetchQueue {
  private generation = 0;
  private active: AbortController | null = null;

  constructor(private readonly delayMs = 100) {}

  cancel(): void {
    this.generation += 1;
    this.active?.abort();
    this.active = null;
  }

  schedule(tasks: readonly PrefetchTask[]): void {
    this.cancel();
    const generation = this.generation;
    void this.run(generation, [...tasks]);
  }

  private async run(generation: number, tasks: PrefetchTask[]): Promise<void> {
    for (const task of tasks) {
      if (generation !== this.generation) return;
      await this.waitForIdle();
      if (generation !== this.generation) return;

      const controller = new AbortController();
      this.active = controller;
      try {
        await task(controller.signal);
      } catch (error) {
        if (!(error instanceof DOMException && error.name === 'AbortError')) {
          console.warn('prefetch failed', error);
        }
      } finally {
        if (this.active === controller) this.active = null;
      }
    }
  }

  private waitForIdle(): Promise<void> {
    return new Promise((resolve) => {
      const win = typeof window === 'undefined' ? null : window as IdleWindow;
      const callback = () => setTimeout(resolve, this.delayMs);
      if (win?.requestIdleCallback) win.requestIdleCallback(callback, { timeout: 500 });
      else callback();
    });
  }
}
