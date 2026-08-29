import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { marked } from 'marked';
import type { Plugin } from 'vite';

const RAW_HTML_LINE = /^\s*<\/?[a-z!][^>]*>/im;

export function helpMarkdownPlugin(): Plugin {
  const helpRoot = path.resolve('content/help');
  return {
    name: 'ephys-atlas-help-markdown',
    enforce: 'pre',
    async load(id) {
      const sourcePath = path.resolve(id);
      if (path.extname(sourcePath) !== '.md' || !sourcePath.startsWith(`${helpRoot}${path.sep}`)) return null;
      const markdown = await readFile(sourcePath, 'utf8');
      if (RAW_HTML_LINE.test(markdown)) throw new Error(`${sourcePath}: Help Markdown must not contain raw HTML`);

      const renderer = new marked.Renderer();
      renderer.html = () => {
        throw new Error(`${sourcePath}: Help Markdown must not contain raw HTML`);
      };
      renderer.image = () => {
        throw new Error(`${sourcePath}: Help Markdown must not contain images`);
      };
      const html = marked.parse(markdown, { async: false, gfm: true, renderer });
      return `export default ${JSON.stringify(html)};`;
    },
  };
}
