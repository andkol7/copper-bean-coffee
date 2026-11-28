import { api } from '../api.js';
import { page, requireRole } from '../layout.js';
import { busy, date, formValues, h, notice, query, render } from '../ui.js';

// /staff/emails (admin): the texts of the emails the shop sends. The left column lists them; the
// right one edits the chosen one, with its variables and a live preview. The server keeps the rules:
// the shop's own templates cannot be deleted and accept only their own {placeholders}.

// Example values for the preview, so the admin sees roughly what a customer will get.
const SAMPLES = {
  name: 'Ann',
  code: '482913',
  ttlMinutes: '10',
  number: 'CB-1042',
  items: '2 × Ethiopia Yirgacheffe  $29.00\n1 × Gooseneck Kettle  $45.00',
  subtotal: '$74.00',
  shippingName: 'Standard',
  shippingPrice: 'free',
  total: '$74.00',
  address: 'Ann Smith\n1 Khreshchatyk St\n01001 Kyiv, UA\n+380 67 123 45 67',
  orderUrl: `${location.origin}/order?id=…`,
  payWithinMinutes: '60',
  reason: 'you cancelled it',
};
// The same rule the server uses: known placeholders filled, unknown ones left visible.
const fill = (text) => text.replace(/\{(\w+)\}/g, (match, key) => SAMPLES[key] ?? match);

page('Emails', async (app) => {
  if (!requireRole(app, ['admin'])) return;

  const side = h('div', { class: 'template-list' });
  const editor = h('div');

  const loadList = async (selectKey) => {
    const { items } = await api('GET', '/email-templates?limit=50');
    render(
      side,
      items.map((t) =>
        h(
          'a',
          { href: `?key=${encodeURIComponent(t.key)}`, class: `template-link${t.key === selectKey ? ' selected' : ''}`, onclick: (event) => { event.preventDefault(); open(t.key); } },
          h('strong', {}, t.key),
          h('span', { class: 'muted small' }, t.description ?? ''),
          h('span', {}, t.system ? h('span', { class: 'badge' }, 'shop') : h('span', { class: 'badge' }, 'custom'), ' ', !t.active && h('span', { class: 'badge sold-out' }, 'off')),
        ),
      ),
      h('button', { type: 'button', class: 'link', onclick: () => newTemplate() }, '+ New template'),
    );
  };

  const open = async (key) => {
    history.replaceState(null, '', `?key=${encodeURIComponent(key)}`);
    const t = await api('GET', `/email-templates/${encodeURIComponent(key)}`);
    await loadList(key);
    render(editor, editForm(t));
  };

  // ---------- Editing one template ----------
  const editForm = (t) => {
    const subject = h('input', { name: 'subject', required: true, maxlength: 200, value: t.subject });
    const text = h('textarea', { name: 'text', required: true, rows: 14, value: t.text });
    const active = h('input', { type: 'checkbox', name: 'active' });
    active.checked = t.active;
    const preview = h('div', { class: 'preview' });
    const drawPreview = () => render(preview, h('p', {}, h('strong', {}, fill(subject.value))), h('pre', {}, fill(text.value)));
    subject.addEventListener('input', drawPreview);
    text.addEventListener('input', drawPreview);
    drawPreview();

    // Click a variable to put it where the cursor is in the text.
    const insert = (name) => {
      const at = text.selectionStart ?? text.value.length;
      text.value = `${text.value.slice(0, at)}{${name}}${text.value.slice(text.selectionEnd ?? at)}`;
      text.focus();
      text.selectionStart = text.selectionEnd = at + name.length + 2;
      drawPreview();
    };

    const form = h(
      'form',
      {
        class: 'panel stack',
        onsubmit: (event) => {
          event.preventDefault();
          busy(form, async () => {
            await api('PATCH', `/email-templates/${encodeURIComponent(t.key)}`, { subject: subject.value, text: text.value, active: active.checked });
            await loadList(t.key);
            form.prepend(notice('Saved. The next email uses the new text.', 'success'));
          });
        },
      },
      h('h2', {}, t.key),
      h('p', { class: 'muted' }, t.description ?? '', t.updatedAt ? ` · changed ${date(t.updatedAt)}` : ''),
      h('label', {}, 'Subject', subject),
      h('label', {}, 'Text', text),
      t.variables
        ? h('div', { class: 'variables' }, h('span', { class: 'muted small' }, 'Variables (click to insert):'), Object.entries(t.variables).map(([name, about]) => h('button', { type: 'button', class: 'chip', title: about, onclick: () => insert(name) }, `{${name}}`)))
        : h('p', { class: 'muted small' }, 'Your own template: any {placeholder} is allowed, but nothing in the shop sends it yet.'),
      h('label', { class: 'inline' }, active, ' Send this email'),
      h('div', { class: 'button-row' }, h('button', { type: 'submit' }, 'Save'), !t.system && h('button', { type: 'button', class: 'danger', onclick: () => remove(t) }, 'Delete')),
      h('h3', {}, 'Preview, with example values'),
      preview,
    );
    return form;
  };

  const remove = async (t) => {
    if (!confirm(`Delete the template ${t.key}?`)) return;
    await api('DELETE', `/email-templates/${encodeURIComponent(t.key)}`);
    history.replaceState(null, '', location.pathname);
    await loadList();
    render(editor, h('p', { class: 'muted' }, 'Deleted. Choose a template on the left.'));
  };

  // ---------- A new template of your own ----------
  const newTemplate = () => {
    const form = h(
      'form',
      {
        class: 'panel stack',
        onsubmit: (event) => {
          event.preventDefault();
          busy(form, async () => {
            const created = await api('POST', '/email-templates', formValues(form));
            await open(created.key);
          });
        },
      },
      h('h2', {}, 'New template'),
      h('label', {}, 'Key (like newsletter.welcome)', h('input', { name: 'key', required: true, maxlength: 60, pattern: '[a-z0-9]+([.\\-][a-z0-9]+)*' })),
      h('label', {}, 'Description', h('input', { name: 'description', maxlength: 300 })),
      h('label', {}, 'Subject', h('input', { name: 'subject', required: true, maxlength: 200 })),
      h('label', {}, 'Text', h('textarea', { name: 'text', required: true, rows: 8 })),
      h('button', { type: 'submit' }, 'Create'),
    );
    render(editor, form);
  };

  render(app, h('h1', {}, 'Emails'), h('div', { class: 'templates' }, side, editor));
  const key = query('key');
  if (key) await open(key);
  else {
    await loadList();
    render(editor, h('p', { class: 'muted' }, 'Choose a template on the left to change its text.'));
  }
});
