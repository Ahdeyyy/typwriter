// Build the URL the webview uses to fetch a rendered preview page. The key
// encodes the content fingerprint + scale bucket, so responses are immutable
// and the webview's HTTP cache absorbs repeat views with zero IPC.
//
// On Android and Windows the custom scheme is served as
// `http://previewimg.localhost/...`; elsewhere (macOS/iOS/Linux) it's
// `previewimg://localhost/...`. Desktop dev on Windows uses the http form too.

export function previewUrl(fingerprint: string, bucket: number): string {
  const useHttp =
    typeof navigator !== "undefined" && /Android|Windows/i.test(navigator.userAgent);
  const path = `${fingerprint}-${bucket}.png`;
  return useHttp ? `http://previewimg.localhost/${path}` : `previewimg://localhost/${path}`;
}
