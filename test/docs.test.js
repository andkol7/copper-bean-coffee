import { expect } from 'chai';
import request from 'supertest';
import { createApp } from '../src/app.js';
import { buildOpenApi, SUMMARIES } from '../src/docs/openapi.js';
import { routes } from '../src/routes.js';

const app = createApp();
const key = (route) => `${route.method.toUpperCase()} ${route.path}`;

describe('API docs (OpenAPI + Swagger UI)', () => {
  const spec = buildOpenApi();
  const op = (method, path) => spec.paths[path][method];

  it('every route has a summary, and every summary belongs to a route', () => {
    const routeKeys = routes.map(key);
    expect(routeKeys.filter((k) => !SUMMARIES[k]), 'routes without a summary').to.deep.equal([]);
    expect(Object.keys(SUMMARIES).filter((k) => !routeKeys.includes(k)), 'summaries of routes that are gone').to.deep.equal([]);
  });

  it('every route is in the spec, with Express :params turned into {params}', () => {
    const count = Object.values(spec.paths).reduce((n, methods) => n + Object.keys(methods).length, 0);
    expect(count).to.equal(routes.length);
    expect(spec.paths).to.have.property('/api/v1/orders/{id}');
    expect(Object.keys(spec.paths).some((p) => p.includes(':'))).to.equal(false);
  });

  it('request bodies come from the zod schemas in routes.js', () => {
    const body = op('post', '/api/v1/addresses').requestBody.content['application/json'].schema;
    expect(body.required).to.include.members(['name', 'phone', 'line1', 'city', 'postalCode', 'country']);
    expect(body.properties.phone.pattern).to.be.a('string');
    expect(body).to.not.have.property('$schema');

    const order = op('post', '/api/v1/orders').requestBody.content['application/json'].schema;
    expect(order.properties).to.have.all.keys('items', 'addressId', 'shippingMethodId', 'note');
    expect(order.properties).to.not.have.any.keys('totalCents', 'status', 'customer'); // the server decides those

    const login = op('post', '/api/v1/auth/sessions').requestBody.content['application/json'].schema;
    expect(login.anyOf).to.have.length(3); // password, code or refresh token
  });

  it('query parameters come from the schemas, and every list gets page and limit', () => {
    const names = (method, path) => op(method, path).parameters.map((p) => p.name);
    expect(names('get', '/api/v1/products')).to.include.members(['category', 'q', 'sort', 'page', 'limit']);
    expect(names('get', '/api/v1/addresses')).to.deep.equal(['page', 'limit']);
    expect(op('get', '/api/v1/users/me')).to.not.have.property('parameters'); // not a list
    expect(op('get', '/api/v1/products/{idOrSlug}').parameters[0]).to.include({ name: 'idOrSlug', in: 'path', required: true });
  });

  it('closed routes carry the lock, optional ones work with or without it, public ones have none', () => {
    expect(op('get', '/api/v1/orders').security).to.deep.equal([{ bearerAuth: [] }]);
    expect(op('get', '/api/v1/products').security).to.deep.equal([{}, { bearerAuth: [] }]);
    expect(op('post', '/api/v1/users')).to.not.have.property('security');
  });

  it('the answers follow the route: 201 for a create, 204 for a delete, 401/403/429 where they can happen', () => {
    expect(op('post', '/api/v1/orders').responses).to.include.keys('201', '400', '401', '409', '429');
    expect(op('delete', '/api/v1/users/{id}').responses).to.include.keys('204', '401', '403', '404');
    expect(op('get', '/api/v1/users/me').responses).to.not.have.property('403'); // any logged-in user
    expect(op('get', '/health').responses).to.have.all.keys('200');
  });

  it('GET /docs/openapi.json serves the spec', async () => {
    const res = await request(app).get('/docs/openapi.json');
    expect(res.status).to.equal(200);
    expect(res.body.openapi).to.equal('3.1.0');
    expect(res.body.info.title).to.equal('Copper Bean Coffee API');
  });

  it('GET /docs serves the Swagger UI page and its script files', async () => {
    const page = await request(app).get('/docs/').redirects(1);
    expect(page.status).to.equal(200);
    expect(page.text).to.include('swagger-ui');

    const script = await request(app).get('/docs/swagger-ui-init.js');
    expect(script.status).to.equal(200);
    expect(script.text).to.include('Copper Bean Coffee API');
  });

  it('the page is not told to upgrade to https, so it works on http://localhost', async () => {
    const csp = (await request(app).get('/docs/').redirects(1)).headers['content-security-policy'];
    expect(csp).to.not.include('upgrade-insecure-requests');
    expect(csp).to.include("script-src 'self'"); // still no scripts from anywhere else
  });
});
