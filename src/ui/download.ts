/** Hands text to the browser as a file. Nothing leaves the machine: a blob URL is origin-local,
 * which is why saving a file works at all under `connect-src 'none'`. */
export function download(name: string, text: string, type = 'application/json') {
  const url = URL.createObjectURL(new Blob([text], { type }));
  const link = document.createElement('a');
  link.href = url;
  link.download = name;
  document.body.appendChild(link);
  link.click();
  link.remove();
  // Revoked on the next tick so the download has started reading it.
  setTimeout(() => URL.revokeObjectURL(url), 0);
}
