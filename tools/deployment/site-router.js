// CloudFront Function, viewer-request. Associate with the default behavior.
// Query-string navigation is preserved; missing resources remain errors.
function handler(event) {
  const request = event.request;
  if (request.uri === '/') request.uri = '/site/index.html';
  return request;
}
