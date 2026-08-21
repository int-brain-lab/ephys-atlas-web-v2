export function required<T extends Element>(root: ParentNode, selector: string): T {
  const node = root.querySelector<T>(selector);
  if (!node) throw new Error(`Missing regional panel node: ${selector}`);
  return node;
}

export function html<K extends keyof HTMLElementTagNameMap>(
  tag: K,
  className?: string,
): HTMLElementTagNameMap[K] {
  const node = document.createElement(tag);
  if (className) node.className = className;
  return node;
}

export function message(text: string): HTMLElement {
  const node = html('p', 'regional-data-message');
  node.textContent = text;
  return node;
}
