import { execFileSync } from 'node:child_process';
import { readdirSync, readFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { expect } from 'chai';
import request from 'supertest';
import { createApp } from '../src/app.js';

// The website in public/: plain HTML pages plus browser JavaScript calling the API. These tests check
// what can be checked without a browser: the pages are served, the scripts exist and parse, nothing
// breaks the Content-Security-Policy, and the redirect after login cannot leave the site.
const app = createApp();
const PAGES = ['/', '/product', '/cart', '/login', '/account', '/order', '/staff/orders', '/staff/customers', '/staff/customer', '/staff/emails'];

const walk = (dir) => readdirSync(dir, { withFileTypes: true }).flatMap((e) => (e.isDirectory() ? walk(join(dir, e.name)) : [join(dir, e.name)]));
const scripts = walk('public/js').filter((f) => f.endsWith('.js'));
const htmlFiles = walk('public').filter((f) => f.endsWith('.html'));

describe('website (public/)', () => {
  it('every page is served as HTML, by its short path', async () => {
    for (const path of PAGES) {
      const res = await request(app).get(path);
      expect(res.status, path).to.equal(200);
      expect(res.headers['content-type'], path).to.include('text/html');
      expect(res.text, path).to.include('id="app"');
    }
  });

  it('each page loads a script and the stylesheet that really exist', async () => {
    for (const path of PAGES) {
      const html = (await request(app).get(path)).text;
      const [, script] = html.match(/<script type="module" src="([^"]+)"/);
      const js = await request(app).get(script);
      expect(js.status, script).to.equal(200);
      expect(js.headers['content-type']).to.include('javascript');
      expect((await request(app).get('/css/style.css')).headers['content-type']).to.include('text/css');
    }
  });

  it('no inline scripts or inline event handlers: the CSP allows only our own script files', async () => {
    for (const file of htmlFiles) {
      const html = readFileSync(file, 'utf8');
      expect(html.match(/<script(?![^>]*\bsrc=)[^>]*>/g), `${file}: inline <script>`).to.equal(null);
      expect(html.match(/\son[a-z]+=/gi), `${file}: inline handler`).to.equal(null);
    }
    const csp = (await request(app).get('/')).headers['content-security-policy'];
    expect(csp).to.include("script-src 'self'");
    expect(csp).to.not.include("script-src 'self' 'unsafe-inline'");
  });

  it('every browser script parses, and every import points to a file that exists', () => {
    for (const file of scripts) {
      execFileSync(process.execPath, ['--check', file]); // throws on a syntax error
      for (const [, path] of readFileSync(file, 'utf8').matchAll(/from '(\.[^']+)'/g)) {
        expect(() => readFileSync(resolve(dirname(file), path)), `${file} imports ${path}`).to.not.throw();
      }
    }
  });

  it('page content is put in as text, never as HTML (no innerHTML anywhere)', () => {
    for (const file of scripts) expect(readFileSync(file, 'utf8'), file).to.not.match(/innerHTML|outerHTML|insertAdjacentHTML|document\.write/);
  });

  it('after login it only goes back to a path on this site', () => {
    const source = readFileSync('public/js/pages/login.js', 'utf8');
    const rule = new RegExp(source.match(/const next = \/(.+)\/\.test/)[1]);
    for (const ok of ['/account', '/order?id=1', '/cart']) expect(rule.test(ok), ok).to.equal(true);
    for (const bad of ['//evil.com', '/\\evil.com', 'https://evil.com', 'evil.com', '']) expect(rule.test(bad), bad).to.equal(false);
  });

  it('the API and the docs still answer next to the pages', async () => {
    expect((await request(app).get('/api/v1/nothing')).body.error.code).to.equal('not_found');
    expect((await request(app).get('/docs/openapi.json')).status).to.equal(200);
  });
});
