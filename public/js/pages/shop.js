import { api } from '../api.js';
import { page } from '../layout.js';
import { h, money, render } from '../ui.js';

// The shop window: search, category, sort, pages. The filters live in the URL (?q=...&category=...),
// so a filtered list can be bookmarked or shared, and Back works.
page('Shop', async (app) => {
  const params = new URLSearchParams(location.search);
  const state = {
    q: params.get('q') ?? '',
    category: params.get('category') ?? '',
    sort: params.get('sort') ?? '',
    page: Number(params.get('page') ?? 1),
  };

  const results = h('div');
  const search = h('input', { type: 'search', name: 'q', placeholder: 'Search coffee, tea, equipment…', value: state.q });
  const category = h(
    'select',
    { name: 'category' },
    h('option', { value: '' }, 'All categories'),
    ['coffee', 'tea', 'equipment'].map((c) => h('option', { value: c }, c[0].toUpperCase() + c.slice(1))),
  );
  category.value = state.category;
  const sort = h(
    'select',
    { name: 'sort' },
    h('option', { value: '' }, 'Newest'),
    h('option', { value: 'price_asc' }, 'Price: low to high'),
    h('option', { value: 'price_desc' }, 'Price: high to low'),
    h('option', { value: 'name' }, 'Name'),
  );
  sort.value = state.sort;

  const load = async () => {
    const query = new URLSearchParams({ limit: 12, page: state.page });
    if (state.q) query.set('q', state.q);
    if (state.category) query.set('category', state.category);
    if (state.sort) query.set('sort', state.sort);

    const shown = new URLSearchParams(query);
    shown.delete('limit');
    if (state.page === 1) shown.delete('page');
    history.replaceState(null, '', shown.toString() ? `/?${shown}` : '/');

    render(results, h('p', { class: 'muted' }, 'Loading…'));
    const list = await api('GET', `/products?${query}`);
    render(
      results,
      list.total === 0
        ? h('p', { class: 'muted' }, 'Nothing found. Try another word or category.')
        : [
            h('p', { class: 'muted' }, `${list.total} product${list.total === 1 ? '' : 's'}`),
            h('div', { class: 'grid' }, list.items.map(card)),
            list.pages > 1 &&
              h(
                'div',
                { class: 'pager' },
                h('button', { type: 'button', disabled: list.page <= 1, onclick: () => go(list.page - 1) }, '← Previous'),
                h('span', {}, `Page ${list.page} of ${list.pages}`),
                h('button', { type: 'button', disabled: list.page >= list.pages, onclick: () => go(list.page + 1) }, 'Next →'),
              ),
          ],
    );
  };
  const go = (pageNumber) => {
    state.page = pageNumber;
    load();
    window.scrollTo(0, 0);
  };

  const form = h(
    'form',
    {
      class: 'filters',
      onsubmit: (event) => {
        event.preventDefault();
        Object.assign(state, { q: search.value.trim(), category: category.value, sort: sort.value, page: 1 });
        load();
      },
    },
    search,
    category,
    sort,
    h('button', { type: 'submit' }, 'Search'),
  );
  // Changing a dropdown applies at once.
  category.addEventListener('change', () => form.requestSubmit());
  sort.addEventListener('change', () => form.requestSubmit());

  render(app, h('h1', {}, 'Our coffee, tea and brewing gear'), form, results);
  await load();
});

function card(product) {
  const soldOut = product.stock === 0;
  return h(
    'a',
    { class: 'card', href: `/product?slug=${encodeURIComponent(product.slug)}` },
    h('span', { class: `badge category-${product.category}` }, product.category),
    h('h3', {}, product.name),
    h('p', { class: 'muted clamp' }, product.description),
    h('div', { class: 'card-foot' }, h('strong', {}, money(product.priceCents)), soldOut ? h('span', { class: 'badge sold-out' }, 'Sold out') : null),
  );
}
