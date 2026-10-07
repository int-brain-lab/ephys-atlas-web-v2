export function element<K extends keyof HTMLElementTagNameMap>(tag: K, className?: string): HTMLElementTagNameMap[K] {
  const node = document.createElement(tag);
  if (className) node.className = className;
  return node;
}

export function heading(text: string, level: 1 | 2 | 3 = 2): HTMLHeadingElement {
  const node = document.createElement(`h${level}`);
  node.textContent = text;
  return node;
}

export function titleCaseToken(value: string): string {
  const words = value.replaceAll('_', ' ').replaceAll('-', ' ').trim();
  return words ? words[0]?.toUpperCase() + words.slice(1) : 'Unavailable';
}

export function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(bytes < 10 * 1024 ? 1 : 0)} KiB`;
  return `${(bytes / (1024 * 1024)).toFixed(bytes < 10 * 1024 * 1024 ? 1 : 0)} MiB`;
}
