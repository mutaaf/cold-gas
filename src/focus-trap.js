// Focus in the modal sheets (0054): an open dialog takes focus, Tab and Shift+Tab cycle inside the one on
// top and never reach the game or the sheet under it, and closing it gives focus back to whatever had it
// before (the button that opened it). Driven by each root's `hidden`, so every way a sheet opens or
// closes (a click, a key, a lost tab, a run ending) is covered without wiring each call site.
// A sheet that already put focus where it wants it (the tier picker's checked tier, How to fly's Got it)
// keeps it; the others focus the dialog box itself (no ring), so a phone gets no stray focus ring and a
// screen reader starts at the sheet's name; the first Tab then lands on its first control.

const FOCUSABLE = 'button, [href], input, select, textarea, [tabindex], details > summary:first-of-type';

const shown = (el) => !el.hidden && el.getClientRects().length > 0;
const boxOf = (root) => root.querySelector('[role="dialog"]') || root.querySelector('.sheet') || root;

// The controls Tab can reach inside `root`, in document order (a radiogroup offers only its checked one).
export function tabStops(root) {
  return [...root.querySelectorAll(FOCUSABLE)].filter((el) => el.tabIndex >= 0 && !el.disabled
    && !el.closest('[hidden], [inert]') && el.getClientRects().length > 0 && getComputedStyle(el).visibility !== 'hidden');
}

export function initFocusTrap(roots) {
  const open = [];   // the sheets that are up, oldest first: the last one is on top
  let prev = null, cur = null, keyed = false;
  document.addEventListener('focusin', (e) => { prev = cur; cur = e.target; }, true);
  // A blur to nothing (input.js drops a mouse-clicked button's focus) leaves no opener behind.
  document.addEventListener('focusout', (e) => { if (!e.relatedTarget) cur = null; }, true);
  // Focus goes back to the opener only for a keyboard: a tap or a click closes to no focus, as it opened.
  addEventListener('keydown', () => { keyed = true; }, true);
  addEventListener('pointerdown', () => { keyed = false; }, true);

  const focusBox = (root) => {
    const box = boxOf(root);
    if (!box.hasAttribute('tabindex')) box.tabIndex = -1;
    box.focus({ preventScroll: true });
  };
  const opened = (root) => {
    const a = document.activeElement;
    // The sheet may have focused its own control already (synchronously, before this ran).
    const opener = root.contains(a) ? (prev && !root.contains(prev) ? prev : null) : a;
    open.push({ root, opener });
    if (!root.contains(a)) focusBox(root);
  };
  const closed = (root) => {
    const i = open.findIndex((o) => o.root === root);
    if (i < 0) return;
    const [{ opener }] = open.splice(i, 1);
    const a = document.activeElement;
    // Only when focus was lost with the sheet: a close that already moved it somewhere keeps that.
    if (a && a !== document.body && !root.contains(a)) return;
    let under = null;
    for (let j = open.length - 1; j >= 0 && !under; j--) if (shown(open[j].root)) under = open[j].root;
    if (keyed && opener && opener !== document.body && opener.isConnected && !opener.closest('[hidden], [inert]') && (!under || under.contains(opener))) opener.focus({ preventScroll: true });
    else if (under) focusBox(under);
    else if (root.contains(a)) a.blur();
  };

  const watch = new MutationObserver((recs) => {
    for (const { target } of recs) {
      const up = shown(target), was = open.some((o) => o.root === target);
      if (up && !was) opened(target);
      else if (!up && was) closed(target);
    }
  });
  for (const root of roots) {
    if (!root) continue;
    watch.observe(root, { attributes: true, attributeFilter: ['hidden'] });
    if (shown(root)) opened(root);
  }

  // Capture: before the game or a sheet reads the key.
  addEventListener('keydown', (e) => {
    if (e.key !== 'Tab' || e.altKey || e.ctrlKey || e.metaKey) return;
    let top = null;
    for (let i = open.length - 1; i >= 0 && !top; i--) if (shown(open[i].root)) top = open[i].root;
    if (!top) return;
    e.preventDefault();
    const stops = tabStops(top);
    if (!stops.length) { focusBox(top); return; }
    const i = stops.indexOf(document.activeElement), n = stops.length;
    const next = i < 0 ? (e.shiftKey ? n - 1 : 0) : (i + (e.shiftKey ? -1 : 1) + n) % n;
    stops[next].focus();
  }, true);
}
