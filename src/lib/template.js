// Text with {placeholders}, used by messages in settings and by email templates.

// render('Hi {name}', { name: 'Ann' }) → 'Hi Ann'. Unknown placeholders stay as they are, so a
// typo in an admin-edited text is visible instead of silently becoming empty.
export function render(template, vars = {}) {
  return template.replace(/\{(\w+)\}/g, (match, key) => (key in vars && vars[key] != null ? String(vars[key]) : match));
}

// The placeholder names a text uses: 'Hi {name}, {code}' → ['name', 'code'].
export function placeholders(template) {
  return [...new Set([...template.matchAll(/\{(\w+)\}/g)].map(([, key]) => key))];
}

// 1450 → '$14.50'. All prices in the shop are whole cents in US dollars.
export const formatMoney = (cents) => `$${(cents / 100).toFixed(2)}`;
