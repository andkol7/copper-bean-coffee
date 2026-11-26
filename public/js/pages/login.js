import { logInWithCode, logInWithPassword, register, requestCode, session } from '../api.js';
import { page } from '../layout.js';
import { busy, formValues, h, notice, query, render } from '../ui.js';

// Three ways in, as tabs: a password, a one-time code by email, or a new account.
page('Log in', async (app) => {
  // Back to where the visitor came from, but only to a path on this site. "//evil.com" and "/\evil.com"
  // both mean another website to a browser, so a path may not start with them (no open redirect).
  const next = /^\/(?![/\\])/.test(query('next') ?? '') ? query('next') : '/account';
  if (session.get()) {
    location.replace(next);
    return;
  }
  const done = () => location.replace(next);

  const tabs = { password: passwordForm(done), code: codeForm(done), register: registerForm(done) };
  const body = h('div');
  const tabBar = h(
    'div',
    { class: 'tabs', role: 'tablist' },
    Object.entries({ password: 'Password', code: 'Code by email', register: 'Register' }).map(([key, label]) =>
      h('button', { type: 'button', role: 'tab', 'data-tab': key, onclick: () => show(key) }, label),
    ),
  );
  const show = (key) => {
    for (const button of tabBar.children) button.setAttribute('aria-selected', String(button.dataset.tab === key));
    render(body, tabs[key]);
  };

  render(
    app,
    h(
      'div',
      { class: 'narrow' },
      h('h1', {}, 'Welcome'),
      notice(h('span', {}, 'Just looking around? Log in as the demo customer: ', h('code', {}, 'demo@copperbean.test'), ' / ', h('code', {}, 'demo-password-123'))),
      tabBar,
      body,
    ),
  );
  show('password');
});

function passwordForm(done) {
  const form = h(
    'form',
    {
      class: 'stack',
      onsubmit: (event) => {
        event.preventDefault();
        const { email, password } = formValues(form);
        busy(form, async () => {
          await logInWithPassword(email, password);
          done();
        });
      },
    },
    h('label', {}, 'Email', h('input', { type: 'email', name: 'email', required: true, autocomplete: 'email' })),
    h('label', {}, 'Password', h('input', { type: 'password', name: 'password', required: true, autocomplete: 'current-password' })),
    h('button', { type: 'submit' }, 'Log in'),
  );
  return form;
}

// Two steps: ask for a code, then type it in.
function codeForm(done) {
  const email = h('input', { type: 'email', name: 'email', required: true, autocomplete: 'email' });
  const code = h('input', { name: 'code', inputmode: 'numeric', pattern: '\\d{6}', maxlength: 6, placeholder: '6 digits', autocomplete: 'one-time-code' });
  const codeStep = h('div', { class: 'stack', hidden: true }, h('label', {}, 'Code from the email', code), h('button', { type: 'submit' }, 'Log in'));
  const askButton = h('button', { type: 'submit' }, 'Send me a code');
  let sent = false;

  const form = h(
    'form',
    {
      class: 'stack',
      onsubmit: (event) => {
        event.preventDefault();
        busy(form, async () => {
          if (!sent) {
            const answer = await requestCode(email.value.trim());
            sent = true;
            email.readOnly = true;
            askButton.hidden = true;
            codeStep.hidden = false;
            code.required = true;
            form.prepend(notice(`${answer.message} Running locally? The code is printed in the server's terminal.`, 'success'));
            code.focus();
          } else {
            await logInWithCode(email.value.trim(), code.value.trim());
            done();
          }
        });
      },
    },
    h('label', {}, 'Email', email),
    askButton,
    codeStep,
  );
  return form;
}

function registerForm(done) {
  const form = h(
    'form',
    {
      class: 'stack',
      onsubmit: (event) => {
        event.preventDefault();
        busy(form, async () => {
          await register(formValues(form));
          done();
        });
      },
    },
    h('label', {}, 'Name', h('input', { name: 'name', required: true, maxlength: 100, autocomplete: 'name' })),
    h('label', {}, 'Email', h('input', { type: 'email', name: 'email', required: true, autocomplete: 'email' })),
    h('label', {}, 'Password (at least 8 characters)', h('input', { type: 'password', name: 'password', required: true, minlength: 8, autocomplete: 'new-password' })),
    h('button', { type: 'submit' }, 'Create my account'),
  );
  return form;
}
