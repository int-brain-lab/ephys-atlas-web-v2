// CloudFront Function, viewer-request. Associate with the default behavior.
// The single mutable site entry selects the static landing page or lazy viewer
// at the browser-visible path. Query strings are preserved; missing resources
// remain errors.
function handler(event) {
  const request = event.request;
  if (request.uri === '/' || request.uri === '/app' || request.uri === '/app/') {
    request.uri = '/site/index.html';
  }
  return request;
}
