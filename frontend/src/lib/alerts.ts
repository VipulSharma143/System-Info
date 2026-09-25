import type { SweetAlertResult } from 'sweetalert2';
import { ALERT_COPY, type AlertKind, type AlertTone } from './errors';

/*
  The app's alert system: SweetAlert2, themed to the app's design tokens (the
  `.sysalert` rules in index.css read the same CSS variables as everything
  else, so light/dark follow the theme toggle automatically).

  Callers pass a *kind* from lib/errors.ts — never free text — so an alert can
  only ever say something that was written for users.

  Behaviour worth knowing:
    - One alert at a time. Anything raised while another is open waits its turn
      rather than replacing it.
    - Per-kind de-duplication. A flapping connection can't stack up copies of
      the same message.
    - `dismissAlert(kind)` closes (or un-queues) an alert whose cause has gone
      away, e.g. "Live updates paused" once the connection is back.
    - SweetAlert2 itself is loaded on first use, so it costs nothing at startup.
*/

type SwalModule = typeof import('sweetalert2');
type SwalStatic = SwalModule['default'];

let swalPromise: Promise<SwalStatic> | null = null;
let swalRef: SwalStatic | null = null;

function loadSwal(): Promise<SwalStatic> {
  swalPromise ??= import('sweetalert2').then((mod) => {
    swalRef = mod.default;
    return mod.default;
  });
  return swalPromise;
}

/* ------------------------------------------------------------------ */
/* Icons — inline SVG (Lucide geometry) so they match the rest of the  */
/* app's icon set instead of SweetAlert's animated built-ins.          */
/* ------------------------------------------------------------------ */

const svg = (body: string) =>
  `<svg xmlns="http://www.w3.org/2000/svg" width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${body}</svg>`;

const ICON_BODY: Record<AlertKind, string> = {
  systemInfo:
    '<circle cx="12" cy="12" r="10"/><path d="m15 9-6 6"/><path d="m9 9 6 6"/>',
  connectionLost:
    '<path d="M12 20h.01"/><path d="M8.5 16.429a5 5 0 0 1 7 0"/><path d="M5 12.859a10 10 0 0 1 5.17-2.69"/><path d="M19 12.859a10 10 0 0 0-2.007-1.523"/><path d="M2 8.82a15 15 0 0 1 4.177-2.643"/><path d="M22 8.82a15 15 0 0 0-11.288-3.764"/><path d="m2 2 20 20"/>',
  gpu: '<circle cx="12" cy="12" r="10"/><path d="M12 16v-4"/><path d="M12 8h.01"/>',
  updateCheck:
    '<path d="m21.73 18-8-14a2 2 0 0 0-3.48 0l-8 14A2 2 0 0 0 4 21h16a2 2 0 0 0 1.73-3"/><path d="M12 9v4"/><path d="M12 17h.01"/>',
  updateDownload:
    '<circle cx="12" cy="12" r="10"/><path d="m15 9-6 6"/><path d="m9 9 6 6"/>',
  updateInstall:
    '<circle cx="12" cy="12" r="10"/><path d="m15 9-6 6"/><path d="m9 9 6 6"/>',
  speedTest:
    '<path d="m21.73 18-8-14a2 2 0 0 0-3.48 0l-8 14A2 2 0 0 0 4 21h16a2 2 0 0 0 1.73-3"/><path d="M12 9v4"/><path d="M12 17h.01"/>',
  serviceStart:
    '<circle cx="12" cy="12" r="10"/><path d="m15 9-6 6"/><path d="m9 9 6 6"/>',
  serviceStop:
    '<circle cx="12" cy="12" r="10"/><path d="m15 9-6 6"/><path d="m9 9 6 6"/>',
  confirmExit: '<path d="M12 2v10"/><path d="M18.4 6.6a9 9 0 1 1-12.77.04"/>',
};

const SWAL_ICON: Record<AlertTone, 'error' | 'warning' | 'info' | 'question'> = {
  error: 'error',
  warning: 'warning',
  info: 'info',
  question: 'question',
};

/* ------------------------------------------------------------------ */
/* Queue                                                               */
/* ------------------------------------------------------------------ */

const inFlight = new Set<AlertKind>();
const dismissedWhileQueued = new Set<AlertKind>();
let visibleKind: AlertKind | null = null;
let chain: Promise<unknown> = Promise.resolve();

function present(
  kind: AlertKind,
  build: (swal: SwalStatic) => Promise<SweetAlertResult>
): Promise<SweetAlertResult | undefined> {
  if (inFlight.has(kind)) return Promise.resolve(undefined);
  inFlight.add(kind);
  dismissedWhileQueued.delete(kind);

  const task = chain
    .then(async (): Promise<SweetAlertResult | undefined> => {
      if (dismissedWhileQueued.has(kind)) return undefined;
      const swal = await loadSwal();
      if (dismissedWhileQueued.has(kind)) return undefined;
      visibleKind = kind;
      return build(swal);
    })
    .catch(() => undefined) // an alert failing to render must never break the app
    .finally(() => {
      inFlight.delete(kind);
      dismissedWhileQueued.delete(kind);
      if (visibleKind === kind) visibleKind = null;
    });

  chain = task;
  return task;
}

/** Close the alert for `kind` if it is showing, or drop it if it is still waiting. */
export function dismissAlert(kind: AlertKind): void {
  if (!inFlight.has(kind)) return;
  if (visibleKind === kind) {
    swalRef?.close();
  } else {
    dismissedWhileQueued.add(kind);
  }
}

/* ------------------------------------------------------------------ */
/* Shared look                                                         */
/* ------------------------------------------------------------------ */

function baseOptions(tone: AlertTone, kind: AlertKind) {
  const copy = ALERT_COPY[kind];
  return {
    icon: SWAL_ICON[tone],
    iconHtml: svg(ICON_BODY[kind]),
    title: copy.title,
    text: copy.text,
    width: 400,
    buttonsStyling: false,
    // The app is a fixed-height shell whose <main> scrolls, not the page.
    // Without these two, SweetAlert2 resets the body height and pads for a
    // scrollbar that doesn't exist, which makes the layout twitch.
    heightAuto: false,
    scrollbarPadding: false,
    returnFocus: true,
    customClass: {
      popup: `sysalert sysalert--${tone}`,
      icon: 'sysalert__icon',
      title: 'sysalert__title',
      htmlContainer: 'sysalert__text',
      actions: 'sysalert__actions',
      confirmButton: 'sysalert__btn sysalert__btn--primary',
      cancelButton: 'sysalert__btn sysalert__btn--secondary',
      denyButton: 'sysalert__btn sysalert__btn--secondary',
    },
  } as const;
}

/* ------------------------------------------------------------------ */
/* Public API                                                          */
/* ------------------------------------------------------------------ */

interface ShowAlertOptions {
  /**
   * When given, the alert offers "Try again" (which calls this) alongside
   * "Close". Without it the alert is a plain acknowledgement with one "OK".
   */
  onRetry?: () => void;
}

/** Show the user-friendly alert for `kind`. Resolves when it has been closed. */
export async function showAlert(kind: AlertKind, options: ShowAlertOptions = {}): Promise<void> {
  const { tone } = ALERT_COPY[kind];
  const retry = options.onRetry;

  const result = await present(kind, (swal) =>
    swal.fire({
      ...baseOptions(tone, kind),
      confirmButtonText: retry ? 'Try again' : 'OK',
      showCancelButton: Boolean(retry),
      cancelButtonText: 'Close',
      reverseButtons: true,
    })
  );

  if (result?.isConfirmed && retry) retry();
}

/** "Exit System Info?" confirmation. Resolves true only if the user chose Exit. */
export async function confirmExit(): Promise<boolean> {
  const kind: AlertKind = 'confirmExit';
  const result = await present(kind, (swal) =>
    swal.fire({
      ...baseOptions(ALERT_COPY[kind].tone, kind),
      confirmButtonText: 'Exit',
      showCancelButton: true,
      cancelButtonText: 'Cancel',
      reverseButtons: true,
      focusCancel: true,
      customClass: {
        ...baseOptions(ALERT_COPY[kind].tone, kind).customClass,
        confirmButton: 'sysalert__btn sysalert__btn--danger',
      },
    })
  );
  return Boolean(result?.isConfirmed);
}
