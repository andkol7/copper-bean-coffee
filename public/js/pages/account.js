import { api, session, updateStoredUser } from '../api.js';
import { page, requireLogin } from '../layout.js';
import { busy, date, formValues, h, money, notice, render, statusBadge } from '../ui.js';

// My account: orders, addresses, profile, password. For staff the order list shows every order.
page('My account', async (app) => {
  if (!requireLogin()) return;
  const me = await api('GET', '/users/me');
  updateStoredUser(me);

  render(
    app,
    h('h1', {}, `Hello, ${me.name}`),
    session.isStaff && notice(`You are logged in as ${me.role}: the order list below shows all customers' orders.`),
    h('section', { id: 'orders' }, h('h2', {}, session.isStaff ? 'All orders' : 'My orders'), await ordersTable()),
    h('section', { id: 'addresses' }, h('h2', {}, 'Delivery addresses'), await addressesBlock()),
    h('section', { id: 'profile', class: 'two-columns' }, profileForm(me), passwordForm()),
  );
});

async function ordersTable(pageNumber = 1) {
  const box = h('div');
  const draw = async (n) => {
    const list = await api('GET', `/orders?limit=10&page=${n}`);
    if (list.total === 0) {
      render(box, h('p', { class: 'muted' }, 'No orders yet. ', h('a', { href: '/' }, 'Go shopping')));
      return;
    }
    render(
      box,
      h(
        'table',
        { class: 'table' },
        h('thead', {}, h('tr', {}, h('th', {}, 'Order'), h('th', {}, 'Date'), h('th', {}, 'Status'), h('th', {}, 'Total'))),
        h(
          'tbody',
          {},
          list.items.map((order) =>
            h(
              'tr',
              {},
              h('td', {}, h('a', { href: `/order?id=${order.id}` }, order.number)),
              h('td', {}, date(order.createdAt)),
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
          h('button', { type: 'button', disabled: n <= 1, onclick: () => draw(n - 1) }, '← Newer'),
          h('span', {}, `Page ${n} of ${list.pages}`),
          h('button', { type: 'button', disabled: n >= list.pages, onclick: () => draw(n + 1) }, 'Older →'),
        ),
    );
  };
  await draw(pageNumber);
  return box;
}

async function addressesBlock() {
  const box = h('div');
  const list = h('div', { class: 'address-list' });

  const draw = async () => {
    const { items } = await api('GET', '/addresses?limit=50');
    render(
      list,
      items.length === 0
        ? h('p', { class: 'muted' }, 'No addresses yet. Add one to place orders.')
        : items.map((a) =>
            h(
              'div',
              { class: 'panel address' },
              a.label && h('strong', {}, a.label),
              h('p', {}, a.name, h('br'), a.line1, a.line2 ? [h('br'), a.line2] : null, h('br'), `${a.postalCode} ${a.city}, ${a.country}`, h('br'), a.phone),
              h(
                'button',
                {
                  type: 'button',
                  class: 'link danger',
                  onclick: async () => {
                    if (!confirm('Delete this address? Orders already placed keep their own copy.')) return;
                    await api('DELETE', `/addresses/${a.id}`);
                    draw();
                  },
                },
                'Delete',
              ),
            ),
          ),
    );
  };

  const form = h(
    'form',
    {
      class: 'panel grid-form',
      onsubmit: (event) => {
        event.preventDefault();
        busy(form, async () => {
          await api('POST', '/addresses', formValues(form));
          form.reset();
          await draw();
        });
      },
    },
    h('h3', {}, 'Add an address'),
    h('label', {}, 'Label (Home, Work…)', h('input', { name: 'label', maxlength: 40 })),
    h('label', {}, 'Recipient', h('input', { name: 'name', required: true, maxlength: 100 })),
    h('label', {}, 'Phone', h('input', { name: 'phone', required: true, placeholder: '+380 67 123 45 67' })),
    h('label', {}, 'Street and number', h('input', { name: 'line1', required: true, maxlength: 120 })),
    h('label', {}, 'Apartment, floor (optional)', h('input', { name: 'line2', maxlength: 120 })),
    h('label', {}, 'City', h('input', { name: 'city', required: true, maxlength: 80 })),
    h('label', {}, 'Postal code', h('input', { name: 'postalCode', required: true, maxlength: 20 })),
    h('label', {}, 'Country code', h('input', { name: 'country', required: true, maxlength: 2, placeholder: 'UA' })),
    h('button', { type: 'submit' }, 'Save the address'),
  );

  await draw();
  render(box, list, form);
  return box;
}

function profileForm(me) {
  const form = h(
    'form',
    {
      class: 'panel stack',
      onsubmit: (event) => {
        event.preventDefault();
        const values = formValues(form);
        busy(form, async () => {
          const updated = await api('PATCH', '/users/me', { name: values.name, ...(values.phone ? { phone: values.phone } : {}) });
          updateStoredUser(updated);
          form.prepend(notice('Saved.', 'success'));
        });
      },
    },
    h('h3', {}, 'Profile'),
    h('label', {}, 'Email', h('input', { value: me.email, disabled: true })),
    h('label', {}, 'Name', h('input', { name: 'name', value: me.name, required: true, maxlength: 100 })),
    h('label', {}, 'Phone', h('input', { name: 'phone', value: me.phone ?? '', placeholder: '+380 67 123 45 67' })),
    h('button', { type: 'submit' }, 'Save'),
  );
  return form;
}

function passwordForm() {
  const form = h(
    'form',
    {
      class: 'panel stack',
      onsubmit: (event) => {
        event.preventDefault();
        busy(form, async () => {
          await api('PATCH', '/users/me', formValues(form));
          // A new password ends every login, this one too: log in again with it.
          session.clear();
          location.href = '/login?next=/account';
        });
      },
    },
    h('h3', {}, 'Change the password'),
    h('label', {}, 'Current password', h('input', { type: 'password', name: 'currentPassword', required: true, autocomplete: 'current-password' })),
    h('label', {}, 'New password (at least 8 characters)', h('input', { type: 'password', name: 'password', required: true, minlength: 8, autocomplete: 'new-password' })),
    h('button', { type: 'submit' }, 'Change and log in again'),
  );
  return form;
}
