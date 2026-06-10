// CondX — band-open notifications + in-app toasts.
// Foreground checking: when the app is open (or briefly backgrounded), a watched
// band crossing into "open" fires a notification. Real background push on iOS
// requires the PWA to be installed (Add to Home Screen) and granted permission.

let prevOpen = {};   // band -> was open last check

export function supported() {
  return 'Notification' in window;
}

export async function requestPermission() {
  if (!supported()) return 'unsupported';
  if (Notification.permission === 'granted') return 'granted';
  try { return await Notification.requestPermission(); }
  catch (_) { return 'denied'; }
}

function fire(title, body) {
  try {
    if (supported() && Notification.permission === 'granted') {
      new Notification(title, { body, tag: 'condx-band', renotify: true });
    }
  } catch (_) { /* iOS may throw outside a SW context */ }
}

// Compare current band results against last check for the watched bands.
// Fires once on a closed->open transition.
export function checkBandOpenings(results, watch) {
  const opened = [];
  for (const r of results) {
    const isOpen = r.open && r.score >= 62;          // "Good" or better
    if (watch.includes(r.band)) {
      if (isOpen && !prevOpen[r.band]) opened.push(r.band);
    }
    prevOpen[r.band] = isOpen;
  }
  if (opened.length) {
    const list = opened.join(', ');
    fire(`📡 ${list} が開けています！`, `バンドが開放しました — ${list}`);
    toast(`📡 ${list} OPEN!`);
  }
  return opened;
}

// Reset baseline (e.g. when watch list changes) so we don't double-fire.
export function resetBaseline() { prevOpen = {}; }

let toastTimer = null;
export function toast(msg) {
  let el = document.getElementById('toast');
  if (!el) {
    el = document.createElement('div');
    el.id = 'toast';
    document.body.appendChild(el);
  }
  el.textContent = msg;
  el.classList.add('show');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => el.classList.remove('show'), 4000);
}
