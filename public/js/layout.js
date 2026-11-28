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
          // Work pages, only for staff; the server checks the role again on every request.
          session.isStaff && [h('a', { href: '/staff/orders' }, 'Orders'), h('a', { href: '/staff/customers' }, 'Customers')],
          session.user?.role === 'admin' && h('a', { href: '/staff/emails' }, 'Emails'),
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

// For staff pages: a guest goes to log in; a customer (or a manager on an admin page) is told the
// page is not for them. Only the look: the API refuses the data with 403 either way.
export function requireRole(app, roles = ['manager', 'admin']) {
  if (!requireLogin()) return false;
  if (roles.includes(session.user?.role)) return true;
  render(app, h('h1', {}, 'Not for you'), h('p', {}, "This page is for the shop's staff. ",h('a', { href: '/' }, 'Back to the shop')));
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
