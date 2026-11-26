import { api, session } from '../api.js';
import { cart } from '../cart-store.js';
import { page } from '../layout.js';
import { busy, h, money, render } from '../ui.js';

// The cart and placing the order: pick a saved address, a shipping method that delivers there, and go.
// What is shown here is a preview; the server works out the real prices, delivery cost and total.
page('Cart', async (app) => {
  const draw = async () => {
    const items = cart.items();
    if (items.length === 0) {
      render(app, h('h1', {}, 'Your cart'), h('p', {}, 'The cart is empty. ', h('a', { href: '/' }, 'Go shopping')));
      return;
    }

    const lines = h(
      'table',
      { class: 'table' },
      h('thead', {}, h('tr', {}, h('th', {}, 'Product'), h('th', {}, 'Price'), h('th', {}, 'Quantity'), h('th', {}, 'Sum'), h('th'))),
      h(
        'tbody',
        {},
        items.map((item) =>
          h(
            'tr',
            {},
            h('td', {}, h('a', { href: `/product?slug=${encodeURIComponent(item.slug)}` }, item.name)),
            h('td', {}, money(item.priceCents)),
            h(
              'td',
              {},
              h('input', {
                type: 'number',
                min: 0,
                max: 100,
                value: item.quantity,
                class: 'qty',
                'aria-label': `Quantity of ${item.name}`,
                onchange: (event) => {
                  cart.setQuantity(item.product, Number(event.target.value) || 0);
                  draw();
                },
              }),
            ),
            h('td', {}, money(item.priceCents * item.quantity)),
            h('td', {}, h('button', { type: 'button', class: 'link', onclick: () => { cart.remove(item.product); draw(); } }, 'Remove')),
          ),
        ),
      ),
    );

    render(app, h('h1', {}, 'Your cart'), lines, h('p', { class: 'total' }, 'Items: ', h('strong', {}, money(cart.subtotalCents()))), await checkout());
  };

  await draw();
});

// The order form, or a hint to log in first.
async function checkout() {
  if (!session.get()) {
    return h('div', { class: 'panel' }, h('p', {}, 'To place the order, ', h('a', { href: '/login?next=/cart' }, 'log in or register'), '.'));
  }

  const { items: addresses } = await api('GET', '/addresses?limit=50');
  if (addresses.length === 0) {
    return h('div', { class: 'panel' }, h('p', {}, 'Add a delivery address first: ', h('a', { href: '/account#addresses' }, 'my addresses'), '.'));
  }

  const addressSelect = h(
    'select',
    { name: 'addressId', required: true },
    addresses.map((a) => h('option', { value: a.id }, `${a.label ? `${a.label}: ` : ''}${a.name}, ${a.line1}, ${a.city}, ${a.country}`)),
  );
  const shippingSelect = h('select', { name: 'shippingMethodId', required: true });
  const note = h('textarea', { name: 'note', maxlength: 500, rows: 2, placeholder: 'A note for us (optional)' });
  const summary = h('div', { class: 'summary' });
  let methods = [];

  // Delivery depends on the country of the address: only methods that go there are offered.
  const loadShipping = async () => {
    const country = addresses.find((a) => a.id === addressSelect.value).country;
    ({ items: methods } = await api('GET', `/shipping-methods?country=${country}`));
    render(
      shippingSelect,
      methods.length
        ? methods.map((m) => h('option', { value: m.id }, `${m.name}: ${money(m.priceCents)}${m.freeOverCents != null ? `, free from ${money(m.freeOverCents)}` : ''}`))
        : h('option', { value: '' }, `No delivery to ${country}`),
    );
    drawSummary();
  };

  // The same rule the server applies (ShippingMethod.costFor), only to show the expected total.
  const drawSummary = () => {
    const method = methods.find((m) => m.id === shippingSelect.value);
    const subtotal = cart.subtotalCents();
    const shipping = !method ? 0 : method.freeOverCents != null && subtotal >= method.freeOverCents ? 0 : method.priceCents;
    render(
      summary,
      h('p', {}, 'Items: ', money(subtotal)),
      h('p', {}, 'Delivery: ', method ? (shipping === 0 ? 'free' : money(shipping)) : '—'),
      h('p', { class: 'total' }, 'Total: ', h('strong', {}, money(subtotal + shipping))),
    );
  };

  addressSelect.addEventListener('change', loadShipping);
  shippingSelect.addEventListener('change', drawSummary);
  await loadShipping();

  const form = h(
    'form',
    {
      class: 'panel stack',
      onsubmit: (event) => {
        event.preventDefault();
        busy(form, async () => {
          const order = await api('POST', '/orders', {
            items: cart.items().map((item) => ({ product: item.product, quantity: item.quantity })),
            addressId: addressSelect.value,
            shippingMethodId: shippingSelect.value,
            ...(note.value.trim() ? { note: note.value.trim() } : {}),
          });
          cart.clear();
          location.href = `/order?id=${order.id}&placed=1`;
        });
      },
    },
    h('h2', {}, 'Delivery'),
    h('label', {}, 'Address', addressSelect),
    h('label', {}, 'Shipping', shippingSelect),
    h('label', {}, 'Note', note),
    summary,
    h('button', { type: 'submit' }, 'Place the order'),
    h('p', { class: 'muted small' }, 'Payment comes in the next phase (Stripe). For now the shop marks orders as paid by hand.'),
  );
  return form;
}
