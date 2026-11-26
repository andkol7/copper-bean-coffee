import { logOut, session } from './api.js';
import { cart } from './cart-store.js';
import { h, render } from './ui.js';

// The header on every page: shop, cart with its count, and log in or the account.
export function drawHeader() {
  const header = document.getElementById('site-header');
  const draw = () => {
    const user = session.user;
    render(
      header,
      h(
        'nav',
        { class: 'container nav' },
        h('a', { href: '/', class: 'brand' }, '☕ Copper Bean Coffee'),
        h(
          'div',
          { class: 'nav-links' },
          h('a', { href: '/' }, 'Shop'),
          h('a', { href: '/cart' }, `Cart (${cart.count()})`),
          user
            ? [
                h('a', { href: '/account' }, user.name, session.isStaff ? ` (${user.role})` : ''),
                h('button', { class: 'link', type: 'button', onclick: async () => { await logOut(); location.href = '/'; } }, 'Log out'),
              ]
            : h('a', { href: `/login?next=${encodeURIComponent(location.pathname + location.search)}` }, 'Log in'),
        ),
      ),
    );
  };
  draw();
  window.addEventListener('cart-changed', draw);
  window.addEventListener('storage', draw); // another tab logged in or out, or changed the cart
}

// For pages that need a logged-in user: sends a guest to the login page and back here afterwards.
export function requireLogin() {
  if (session.get()) return true;
  location.href = `/login?next=${encodeURIComponent(location.pathname + location.search)}`;
  return false;
}

// Every page: the header, then its own content.
export function page(title, start) {
  document.title = `${title} · Copper Bean Coffee`;
  drawHeader();
  start(document.getElementById('app')).catch((err) => {
    // The login ran out and could not be renewed: log in again and come back here.
    if (err.status === 401) {
      session.clear();
      if (requireLogin()) return;
    }
    render(document.getElementById('app'), h('div', { class: 'alert error' }, err.message));
  });
}
