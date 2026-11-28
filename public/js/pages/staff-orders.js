import { api } from '../api.js';
import { page, requireRole } from '../layout.js';
import { date, h, money, render, statusBadge, STATUS_LABELS } from '../ui.js';

// /staff/orders: every order, newest first, with a status filter and a search by number.
// ?customer=<id> narrows it to one customer (the customer card links here). Filters live in the URL.
page('Orders', async (app) => {
  if (!requireRole(app)) return;

  const params = new URLSearchParams(location.search);
  const state = { status: params.get('status') ?? '', number: params.get('number') ?? '', customer: params.get('customer') ?? '', page: Number(params.get('page') ?? 1) };

  const status = h('select', { name: 'status' }, h('option', { value: '' }, 'All statuses'), Object.entries(STATUS_LABELS).map(([value, label]) => h('option', { value }, label)));
  status.value = state.status;
  const number = h('input', { type: 'search', name: 'number', placeholder: 'Order number, CB-1042', value: state.number });
  const results = h('div');

  const load = async () => {
    const query = new URLSearchParams({ limit: 20, page: state.page });
    for (const key of ['status', 'number', 'customer']) if (state[key]) query.set(key, state[key]);
    const shown = new URLSearchParams(query);
    shown.delete('limit');
    if (state.page === 1) shown.delete('page');
    history.replaceState(null, '', shown.toString() ? `?${shown}` : location.pathname);

    const list = await api('GET', `/orders?${query}`);
    render(
      results,
      h('p', { class: 'muted' }, `${list.total} order${list.total === 1 ? '' : 's'}`),
      list.total > 0 &&
        h(
          'table',
          { class: 'table' },
          h('thead', {}, h('tr', {}, h('th', {}, 'Order'), h('th', {}, 'Date'), h('th', {}, 'Customer'), h('th', {}, 'Items'), h('th', {}, 'Status'), h('th', {}, 'Total'))),
          h(
            'tbody',
            {},
            list.items.map((order) =>
              h(
                'tr',
                {},
                h('td', {}, h('a', { href: `/order?id=${order.id}` }, order.number)),
                h('td', {}, date(order.createdAt)),
                h('td', {}, h('a', { href: `/staff/customer?id=${order.customer}` }, order.shippingAddress.name)),
                h('td', {}, order.items.reduce((sum, item) => sum + item.quantity, 0)),
                h('td', {}, statusBadge(order.status)),
                h('td', {}, money(order.totalCents)),
              ),
            ),
          ),
        ),
      list.pages > 1 &&
        h(
          'div',
          { class: 'pager' },
          h('button', { type: 'button', disabled: list.page <= 1, onclick: () => go(list.page - 1) }, '← Newer'),
          h('span', {}, `Page ${list.page} of ${list.pages}`),
          h('button', { type: 'button', disabled: list.page >= list.pages, onclick: () => go(list.page + 1) }, 'Older →'),
        ),
    );
  };
  const go = (n) => {
    state.page = n;
    load();
  };

  const form = h(
    'form',
    {
      class: 'filters',
      onsubmit: (event) => {
        event.preventDefault();
        Object.assign(state, { status: status.value, number: number.value.trim(), page: 1 });
        load();
      },
    },
    number,
    status,
    h('span'),
    h('button', { type: 'submit' }, 'Filter'),
  );
  status.addEventListener('change', () => form.requestSubmit());

  render(
    app,
    h('h1', {}, 'Orders'),
    state.customer && h('p', {}, 'Only one customer\'s orders. ', h('a', { href: '/staff/orders' }, 'Show all')),
    form,
    results,
  );
  await load();
});
