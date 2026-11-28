import { api } from '../api.js';
import { page, requireRole } from '../layout.js';
import { date, h, money, query, render, statusBadge } from '../ui.js';

// /staff/customer?id=...: one customer's card: who, what they bought, recent orders, addresses.
page('Customer', async (app) => {
  if (!requireRole(app)) return;

  let c;
  try {
    c = await api('GET', `/customers/${encodeURIComponent(query('id') ?? '')}`);
  } catch (err) {
    if (err.status !== 404 && err.status !== 400) throw err;
    render(app, h('h1', {}, 'Customer not found'), h('p', {}, h('a', { href: '/staff/customers' }, '← All customers')));
    return;
  }
  document.title = `${c.name} · Copper Bean Coffee`;
  const wiped = Boolean(c.deletedAt);

  render(
    app,
    h('p', {}, h('a', { href: '/staff/customers' }, '← All customers')),
    h('h1', {}, c.name),
    wiped && h('div', { class: 'alert warning' }, 'This account was deleted: the personal data is wiped, the orders are kept.'),
    h(
      'div',
      { class: 'stats' },
      stat('Orders', c.stats.orders),
      stat('Spent', money(c.stats.spentCents)),
      stat('Last order', c.stats.lastOrderAt ? date(c.stats.lastOrderAt) : '—'),
      stat('Customer since', date(c.createdAt)),
    ),
    h(
      'div',
      { class: 'two-columns' },
      h('div', { class: 'panel' }, h('h3', {}, 'Contact'), h('p', {}, c.email, h('br'), c.phone ?? h('span', { class: 'muted' }, 'no phone'))),
      h(
        'div',
        { class: 'panel' },
        h('h3', {}, 'Addresses'),
        c.addresses.length
          ? c.addresses.map((a) => h('p', {}, a.label && h('strong', {}, a.label, h('br')), a.name, ', ', a.line1, ', ', `${a.postalCode} ${a.city}, ${a.country}`))
          : h('p', { class: 'muted' }, 'None saved.'),
      ),
    ),
    h('h2', {}, 'Recent orders'),
    c.recentOrders.length === 0
      ? h('p', { class: 'muted' }, 'No orders yet.')
      : [
          h(
            'table',
            { class: 'table' },
            h('thead', {}, h('tr', {}, h('th', {}, 'Order'), h('th', {}, 'Date'), h('th', {}, 'Status'), h('th', {}, 'Total'))),
            h(
              'tbody',
              {},
              c.recentOrders.map((order) =>
                h('tr', {}, h('td', {}, h('a', { href: `/order?id=${order.id}` }, order.number)), h('td', {}, date(order.createdAt)), h('td', {}, statusBadge(order.status)), h('td', {}, money(order.totalCents))),
              ),
            ),
          ),
          c.stats.orders > c.recentOrders.length && h('p', {}, h('a', { href: `/staff/orders?customer=${c.id}` }, `All ${c.stats.orders} orders of this customer →`)),
        ],
  );
});

const stat = (label, value) => h('div', { class: 'panel stat' }, h('span', { class: 'muted small' }, label), h('strong', {}, value));
