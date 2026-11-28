import { api, session } from '../api.js';
import { page, requireLogin } from '../layout.js';
import { busy, date, h, money, notice, query, render, statusBadge, STATUS_LABELS } from '../ui.js';

// What each role may do from each status. The server decides for real (the state machine in
// orders/model.js); this only chooses which buttons to show, so nobody sees a button that would fail.
const ACTIONS = {
  pending_payment: { paid: ['admin'], cancelled: ['customer', 'manager', 'admin'] },
  paid: { shipped: ['manager', 'admin'] },
  shipped: { completed: ['manager', 'admin'] },
};
const ACTION_LABELS = { paid: 'Mark as paid', cancelled: 'Cancel the order', shipped: 'Mark as shipped', completed: 'Mark as completed' };

// One order: /order?id=...
page('Order', async (app) => {
  if (!requireLogin()) return;

  const draw = async () => {
    let order;
    try {
      order = await api('GET', `/orders/${encodeURIComponent(query('id') ?? '')}`);
    } catch (err) {
      if (err.status !== 404 && err.status !== 400) throw err;
      render(app, h('h1', {}, 'Order not found'), h('p', {}, h('a', { href: '/account' }, 'Back to my orders')));
      return;
    }
    document.title = `${order.number} · Copper Bean Coffee`;
    const a = order.shippingAddress;

    render(
      app,
      h('p', {}, session.isStaff ? h('a', { href: '/staff/orders' }, '← All orders') : h('a', { href: '/account' }, '← My orders')),
      query('placed') && notice(`Thank you! Order ${order.number} is placed. Unpaid orders are cancelled after an hour.`, 'success'),
      h('h1', {}, `Order ${order.number} `, statusBadge(order.status)),
      h('p', { class: 'muted' }, `Placed ${date(order.createdAt)}`),
      h(
        'table',
        { class: 'table' },
        h('thead', {}, h('tr', {}, h('th', {}, 'Product'), h('th', {}, 'Price'), h('th', {}, 'Qty'), h('th', {}, 'Sum'))),
        h(
          'tbody',
          {},
          order.items.map((item) =>
            h('tr', {}, h('td', {}, item.name), h('td', {}, money(item.unitPriceCents)), h('td', {}, item.quantity), h('td', {}, money(item.unitPriceCents * item.quantity))),
          ),
        ),
        h(
          'tfoot',
          {},
          h('tr', {}, h('td', { colspan: 3 }, 'Items'), h('td', {}, money(order.subtotalCents))),
          h('tr', {}, h('td', { colspan: 3 }, `Delivery: ${order.shipping.name}`), h('td', {}, order.shipping.priceCents ? money(order.shipping.priceCents) : 'free')),
          h('tr', { class: 'total' }, h('td', { colspan: 3 }, 'Total'), h('td', {}, money(order.totalCents))),
        ),
      ),
      h(
        'div',
        { class: 'two-columns' },
        h(
          'div',
          { class: 'panel' },
          h('h3', {}, 'Delivery address'),
          h('p', {}, a.name, h('br'), a.line1, a.line2 ? [h('br'), a.line2] : null, h('br'), `${a.postalCode} ${a.city}, ${a.country}`, h('br'), a.phone),
          order.note && [h('h3', {}, 'Note'), h('p', {}, order.note)],
        ),
        h(
          'div',
          { class: 'panel' },
          h('h3', {}, 'History'),
          h(
            'ol',
            { class: 'history' },
            order.statusHistory.map((step) => h('li', {}, h('strong', {}, STATUS_LABELS[step.status] ?? step.status), ` · ${date(step.at)}`, step.note ? ` · ${step.note}` : '', !step.by ? ' · by the shop' : '')),
          ),
        ),
      ),
      actions(order, draw),
    );
  };

  await draw();
});

// The buttons this user may press now.
function actions(order, redraw) {
  const role = session.user?.role;
  const allowed = Object.entries(ACTIONS[order.status] ?? {}).filter(([, roles]) => roles.includes(role));
  if (allowed.length === 0) return null;

  const note = h('input', { name: 'note', maxlength: 500, placeholder: 'A note for the history (optional)' });
  const form = h(
    'form',
    { class: 'panel stack', onsubmit: (event) => event.preventDefault() },
    h('h3', {}, 'Actions'),
    note,
    h(
      'div',
      { class: 'button-row' },
      allowed.map(([status]) =>
        h(
          'button',
          {
            type: 'button',
            class: status === 'cancelled' ? 'danger' : '',
            onclick: () => {
              if (status === 'cancelled' && !confirm('Cancel this order? The items go back on sale.')) return;
              busy(form, async () => {
                await api('PATCH', `/orders/${order.id}`, { status, ...(note.value.trim() ? { note: note.value.trim() } : {}) });
                await redraw();
              });
            },
          },
          ACTION_LABELS[status],
        ),
      ),
    ),
  );
  return form;
}
