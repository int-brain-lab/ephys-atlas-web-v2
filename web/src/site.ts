export {};

const APP_PATHS = new Set(['/app', '/app/']);

if (APP_PATHS.has(window.location.pathname)) {
  document.querySelector<HTMLElement>('[data-landing]')?.remove();
  document.body.classList.remove('landing-page');
  document.title = 'IBL Ephys Atlas';
  const app = document.querySelector<HTMLElement>('#app');
  if (!app) throw new Error('Missing #app root element');
  const status = document.querySelector<HTMLElement>('#app-bootstrap-status');
  if (!status) throw new Error('Missing #app-bootstrap-status');
  status.hidden = false;
  try {
    await import('./main.js');
  } catch (error) {
    status.textContent = 'Unable to load the atlas. Reload the page and try again.';
    status.setAttribute('role', 'alert');
    console.error('Unable to load atlas startup module', error);
  }
}
