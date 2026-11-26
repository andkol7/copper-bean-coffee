// The cart lives in this browser (localStorage) until the order is placed. Prices kept here are only
// for showing; when the order is placed the server takes the real prices from the database.

const KEY = 'cb.cart';
const MAX_QUANTITY = 100; // the same limit the API has

const read = () => {
  try {
    return JSON.parse(localStorage.getItem(KEY)) ?? [];
  } catch {
    return [];
  }
};
const write = (items) => {
  localStorage.setItem(KEY, JSON.stringify(items));
  window.dispatchEvent(new Event('cart-changed'));
};

export const cart = {
  items: read,

  count() {
    return read().reduce((sum, item) => sum + item.quantity, 0);
  },

  subtotalCents() {
    return read().reduce((sum, item) => sum + item.priceCents * item.quantity, 0);
  },

  // One line per product (the API does not take the same product twice): adding again adds up.
  add(product, quantity = 1) {
    const items = read();
    const line = items.find((item) => item.product === product.id);
    const limit = Math.min(MAX_QUANTITY, product.stock);
    if (line) line.quantity = Math.min(limit, line.quantity + quantity);
    else items.push({ product: product.id, slug: product.slug, name: product.name, priceCents: product.priceCents, quantity: Math.min(limit, quantity) });
    write(items);
  },

  setQuantity(productId, quantity) {
    const items = read()
      .map((item) => (item.product === productId ? { ...item, quantity: Math.min(MAX_QUANTITY, quantity) } : item))
      .filter((item) => item.quantity > 0);
    write(items);
  },

  remove(productId) {
    write(read().filter((item) => item.product !== productId));
  },

  clear() {
    write([]);
  },
};
