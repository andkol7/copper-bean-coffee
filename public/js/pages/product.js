import { api } from '../api.js';
import { cart } from '../cart-store.js';
import { page } from '../layout.js';
import { h, money, notice, query, render } from '../ui.js';

// One product: /product?slug=ethiopia-yirgacheffe
page('Product', async (app) => {
  const slug = query('slug');
  let product;
  try {
    product = await api('GET', `/products/${encodeURIComponent(slug ?? '')}`);
  } catch (err) {
    if (err.status !== 404) throw err;
    render(app, h('h1', {}, 'Not found'), h('p', {}, 'This product does not exist or is not on sale any more. ', h('a', { href: '/' }, 'Back to the shop')));
    return;
  }
  document.title = `${product.name} · Copper Bean Coffee`;

  const message = h('div');
  const quantity = h('input', { type: 'number', name: 'quantity', min: 1, max: Math.max(1, Math.min(100, product.stock)), value: 1 });
  const soldOut = product.stock === 0;

  const addToCart = h(
    'form',
    {
      class: 'buy',
      onsubmit: (event) => {
        event.preventDefault();
        cart.add(product, Number(quantity.value) || 1);
        render(message, notice(h('span', {}, 'Added to your cart. ', h('a', { href: '/cart' }, 'Go to the cart')), 'success'));
      },
    },
    h('label', {}, 'Quantity ', quantity),
    h('button', { type: 'submit', disabled: soldOut }, soldOut ? 'Sold out' : 'Add to cart'),
  );

  render(
    app,
    h('p', {}, h('a', { href: '/' }, '← All products')),
    h(
      'article',
      { class: 'product' },
      h('span', { class: `badge category-${product.category}` }, product.category),
      h('h1', {}, product.name),
      !product.active && notice('Hidden from the shop: only staff can see this page.', 'warning'),
      h('p', { class: 'price' }, money(product.priceCents)),
      h('p', {}, product.description),
      h('p', { class: 'muted' }, soldOut ? 'Out of stock' : product.stock <= 5 ? `Only ${product.stock} left` : 'In stock'),
      addToCart,
      message,
    ),
  );
});
