// Talking to our own API from the browser: /api/v1/..., the same API Swagger shows at /docs.
//
// The session ({ accessToken, refreshToken, user }) is kept in localStorage, so a reload or a new tab
// stays logged in. The access token lives 15 minutes; when the API answers 401, this file swaps the
// refresh token for a new pair once and repeats the request, so the user never notices.
//
// Trade-off worth knowing: anything in localStorage can be read by JavaScript on this site, so an XSS
// hole would expose the tokens. The site guards against that: every text is put on the page as text,
// never as HTML (see h() in ui.js), and the server's Content-Security-Policy only lets our own script
// files run. A production shop might keep the refresh token in an httpOnly cookie instead.

const KEY = 'cb.session';

export const session = {
  get() {
    try {
      return JSON.parse(localStorage.getItem(KEY));
    } catch {
      return null;
    }
  },
  set(value) {
    localStorage.setItem(KEY, JSON.stringify(value));
  },
  clear() {
    localStorage.removeItem(KEY);
  },
  get user() {
    return this.get()?.user ?? null;
  },
  get isStaff() {
    return ['manager', 'admin'].includes(this.user?.role);
  },
};

// The API answered with an error: { error: { code, message, details? } }.
export class ApiError extends Error {
  constructor(status, body) {
    super(body?.error?.message ?? `Something went wrong (${status})`);
    this.status = status;
    this.code = body?.error?.code;
    this.details = body?.error?.details ?? [];
  }
}

// api('GET', '/products?q=colombia') or api('POST', '/orders', { ... }). Returns the parsed answer.
export async function api(method, path, body) {
  const send = () =>
    fetch(`/api/v1${path}`, {
      method,
      headers: {
        ...(body !== undefined ? { 'content-type': 'application/json' } : {}),
        ...(session.get()?.accessToken ? { authorization: `Bearer ${session.get().accessToken}` } : {}),
      },
      body: body !== undefined ? JSON.stringify(body) : undefined,
    });

  let res = await send();
  if (res.status === 401 && session.get()?.refreshToken && !path.startsWith('/auth/')) {
    if (await refresh()) res = await send();
  }

  const data = res.status === 204 ? null : await res.json().catch(() => null);
  if (!res.ok) throw new ApiError(res.status, data);
  return data;
}

// One refresh at a time. The API rotates refresh tokens and treats a token used twice as stolen
// (it ends the whole login), so two requests refreshing in parallel would log the user out.
let refreshing = null;
function refresh() {
  refreshing ??= (async () => {
    try {
      const res = await fetch('/api/v1/auth/sessions', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ refreshToken: session.get().refreshToken }),
      });
      if (!res.ok) {
        session.clear();
        return false;
      }
      session.set(await res.json());
      return true;
    } finally {
      refreshing = null;
    }
  })();
  return refreshing;
}

// ---------- Logging in and out ----------

export async function logInWithPassword(email, password) {
  session.set(await api('POST', '/auth/sessions', { email, password }));
}

export async function requestCode(email) {
  return api('POST', '/auth/otp', { email });
}

export async function logInWithCode(email, code) {
  session.set(await api('POST', '/auth/sessions', { email, code }));
}

export async function register({ email, name, password }) {
  await api('POST', '/users', { email, name, password });
  await logInWithPassword(email, password);
}

export async function logOut() {
  const refreshToken = session.get()?.refreshToken;
  session.clear();
  if (refreshToken) await api('DELETE', '/auth/sessions', { refreshToken }).catch(() => {}); // gone already: fine
}

// The profile changed (name, phone): keep the copy in the session up to date.
export function updateStoredUser(user) {
  const current = session.get();
  if (current) session.set({ ...current, user });
}
