// Small helpers for building pages, so no page ever puts raw HTML together from data.

// h('a', { href: '/cart', class: 'button' }, 'Cart (', count, ')') builds a DOM element.
// Children that are strings become TEXT nodes, so a product called "<script>" shows up as those
// characters and never runs. That is the main protection against XSS on this site.
export function h(tag, props = {}, ...children) {
  const el = document.createElement(tag);
  for (const [key, value] of Object.entries(props ?? {})) {
    if (value == null || value === false) continue;
    if (key.startsWith('on')) el.addEventListener(key.slice(2).toLowerCase(), value);
    else if (key === 'class') el.className = value;
    else if (key === 'value') el.value = value;
    else el.setAttribute(key, value === true ? '' : value);
  }
  for (const child of children.flat(Infinity)) {
    if (child == null || child === false) continue;
    el.append(child instanceof Node ? child : String(child));
  }
  return el;
}

// Replaces what is inside an element.
export function render(target, ...children) {
  target.replaceChildren(...children.flat(Infinity).filter((c) => c != null && c !== false));
}

// Prices are whole cents in the API: 1450 -> "$14.50".
export const money = (cents) => `$${(cents / 100).toFixed(2)}`;

export const date = (value) =>
  new Date(value).toLocaleString('en-GB', { day: 'numeric', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' });

export const STATUS_LABELS = {
  pending_payment: 'Waiting for payment',
  paid: 'Paid',
  shipped: 'Shipped',
  completed: 'Completed',
  cancelled: 'Cancelled',
  refunded: 'Refunded',
};

export const statusBadge = (status) => h('span', { class: `badge status-${status}` }, STATUS_LABELS[status] ?? status);

// An API error as a message box, with the field problems listed (from a 400).
export function errorBox(err) {
  const details = (err.details ?? []).filter((d) => d.message);
  return h(
    'div',
    { class: 'alert error', role: 'alert' },
    h('strong', {}, err.message ?? String(err)),
    details.length ? h('ul', {}, details.map((d) => h('li', {}, d.path ? `${d.path}: ${d.message}` : d.message))) : null,
  );
}

export const notice = (text, kind = 'info') => h('div', { class: `alert ${kind}`, role: 'status' }, text);

// Reads a form into a plain object, leaving out empty fields.
export function formValues(form) {
  const values = {};
  for (const [key, value] of new FormData(form)) {
    const text = String(value).trim();
    if (text !== '') values[key] = text;
  }
  return values;
}

// Runs an async form action with the button disabled and errors shown in the form.
export async function busy(form, action) {
  const button = form.querySelector('button[type="submit"]');
  form.querySelector('.alert')?.remove();
  if (button) button.disabled = true;
  try {
    await action();
  } catch (err) {
    form.prepend(errorBox(err));
  } finally {
    if (button) button.disabled = false;
  }
}

// URL query helpers: ?slug=earl-grey
export const query = (name) => new URLSearchParams(location.search).get(name);
