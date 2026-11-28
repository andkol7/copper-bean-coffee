import { api } from '../api.js';
import { page, requireRole } from '../layout.js';
import { date, h, money, render } from '../ui.js';

// /staff/customers: customers with what they bought (one aggregation on the server, see
// modules/customers): search by name or email, sort by money spent, orders, last order...
page('Customers', async (app) => {
  if (!requireRole(app)) return;

  const params = new URLSearchParams(location.search);
  const state = { q: params.get('q') ?? '', sort: params.get('sort') ?? '', page: Number(params.get('page') ?? 1) };
  const q = h('input', { type: 'search', name: 'q', placeholder: 'Name or email', value: state.q });
  const sort = h(
    'select',
    { name: 'sort' },
    h('option', { value: '' }, 'Newest first'),
    h('option', { value: 'spent' }, 'Spent the most'),
    h('option', { value: 'orders' }, 'Most orders'),
    h('option', { value: 'last_order' }, 'Ordered last'),
    h('option', { value: 'name' }, 'Name'),
  );
  sort.value = state.sort;
  const results = h('div');

  const load = async () => {
    const query = new URLSearchParams({ limit: 20, page: state.page });
    if (state.q) query.set('q', state.q);
    if (state.sort) query.set('sort', state.sort);
    const shown = new URLSearchParams(query);
    shown.delete('limit');
    if (state.page === 1) shown.delete('page');
    history.replaceState(null, '', shown.toString() ? `?${shown}` : location.pathname);

    const list = await api('GET', `/customers?${query}`);
    render(
      results,
      h('p', { class: 'muted' }, `${list.total} customer${list.total === 1 ? '' : 's'}`),
      list.total > 0 &&
        h(
          'table',
          { class: 'table' },
          h('thead', {}, h('tr', {}, h('th', {}, 'Customer'), h('th', {}, 'Email'), h('th', {}, 'Orders'), h('th', {}, 'Spent'), h('th', {}, 'Last order'), h('th', {}, 'Since'))),
          h(
            'tbody',
            {},
            list.items.map((c) =>
              h(
                'tr',
                {},
                h('td', {}, h('a', { href: `/staff/customer?id=${c.id}` }, c.name)),
                h('td', {}, c.email),
                h('td', {}, c.stats.orders),
                h('td', {}, money(c.stats.spentCents)),
                h('td', {}, c.stats.lastOrderAt ? date(c.stats.lastOrderAt) : '—'),
                h('td', {}, date(c.createdAt)),
              ),
            ),
          ),
        ),
      list.pages > 1 &&
        h(
          'div',
          { class: 'pager' },
          h('button', { type: 'button', disabled: list.page <= 1, onclick: () => go(list.page - 1) }, '← Previous'),
          h('span', {}, `Page ${list.page} of ${list.pages}`),
          h('button', { type: 'button', disabled: list.page >= list.pages, onclick: () => go(list.page + 1) }, 'Next →'),
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
        Object.assign(state, { q: q.value.trim(), sort: sort.value, page: 1 });
        load();
      },
    },
    q,
    sort,
    h('span'),
    h('button', { type: 'submit' }, 'Search'),
  );
  sort.addEventListener('change', () => form.requestSubmit());

  render(app, h('h1', {}, 'Customers'), h('p', { class: 'muted' }, 'Spent counts paid, shipped and completed orders.'), form, results);
  await load();
});
