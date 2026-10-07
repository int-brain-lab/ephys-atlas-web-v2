/// <reference types="vite/client" />

declare module 'region-navigation-assets' {
  export const REGION_NAVIGATION_ASSETS: import('./rendering/region-navigation-source.js').RegionNavigationAssets;
}

declare module '*.md' {
  const html: string;
  export default html;
}
