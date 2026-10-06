/*
  Polling that stops while nobody can see the window.

  A minimised or fully covered window cannot show new numbers, so fetching them every two seconds only costs CPU in the
  webview, the backend and the native layer. `scheduleWhenVisible` runs `fn` after `delayMs` like setTimeout, but if the
  page is hidden when the delay ends it waits for the page to become visible and then runs it once at once, so the
  numbers are fresh the moment the window comes back. The returned function cancels everything (timer and listener).
*/
export function scheduleWhenVisible(fn: () => void, delayMs: number, doc: Pick<Document, 'hidden' | 'addEventListener' | 'removeEventListener'> = document): () => void {
  let timer: ReturnType<typeof setTimeout> | undefined;
  let waiting = false;
  let cancelled = false;

  const onVisible = () => {
    if (doc.hidden || cancelled) return;
    waiting = false;
    doc.removeEventListener('visibilitychange', onVisible);
    fn();
  };

  timer = setTimeout(() => {
    timer = undefined;
    if (cancelled) return;
    if (!doc.hidden) {
      fn();
      return;
    }
    waiting = true;
    doc.addEventListener('visibilitychange', onVisible);
  }, delayMs);

  return () => {
    cancelled = true;
    if (timer !== undefined) clearTimeout(timer);
    if (waiting) doc.removeEventListener('visibilitychange', onVisible);
  };
}
