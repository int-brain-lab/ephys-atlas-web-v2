export class PrefetchQueue {
  private generation = 0;

  schedule(tasks: readonly (() => Promise<void>)[]): void {
    const generation = ++this.generation;
    void this.run(tasks, generation);
  }

  cancel(): void {
    this.generation += 1;
  }

  private async run(tasks: readonly (() => Promise<void>)[], generation: number): Promise<void> {
    for (const task of tasks) {
      if (generation !== this.generation) return;
      try {
        await task();
      } catch {
        // Prefetch is opportunistic and must not surface as application failure.
      }
    }
  }
}
