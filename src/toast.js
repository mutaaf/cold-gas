// 0053: its own module, so the title can toast without the share card's chunk (src/share-card.js, src/later.js).
// A short message at the bottom of the screen (polite live region), for the copy fallback.
export function toast(msg, ms = 1800) {
  let el = document.querySelector('[data-toast]');
  if (!el) {
    el = document.createElement('div');
    el.className = 'toast'; el.setAttribute('data-toast', ''); el.setAttribute('role', 'status'); el.setAttribute('aria-live', 'polite');
    document.body.appendChild(el);
  }
  el.textContent = msg;
  el.classList.add('on');
  clearTimeout(el._t);
  el._t = setTimeout(() => el.classList.remove('on'), ms);
}
