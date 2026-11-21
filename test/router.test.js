import { expect } from 'chai';
import { z } from 'zod';
import { buildRouter } from '../src/router.js';

describe('router', () => {
  const ok = (req, res) => res.end();

  it('builds from the real route list', () => {
    expect(() => buildRouter()).to.not.throw();
  });

  it('rejects an unknown method', () => {
    expect(() => buildRouter([{ method: 'fetch', path: '/x', handler: ok }])).to.throw('unknown method');
  });

  it('rejects a route without a handler', () => {
    expect(() => buildRouter([{ method: 'get', path: '/x' }])).to.throw('handler is missing');
  });

  it('rejects the same route listed twice', () => {
    const route = { method: 'get', path: '/x', handler: ok };
    expect(() => buildRouter([route, route])).to.throw('listed twice');
  });

  it('rejects an unknown field, e.g. a typo', () => {
    expect(() => buildRouter([{ method: 'get', path: '/x', valdate: {}, handler: ok }])).to.throw(
      'unknown field "valdate"',
    );
  });

  it('rejects validate on something other than params, query or body', () => {
    const route = { method: 'post', path: '/x', validate: { headers: z.object({}) }, handler: ok };
    expect(() => buildRouter([route])).to.throw('cannot validate "headers"');
  });

  it('rejects a validate entry that is not a zod schema', () => {
    const route = { method: 'post', path: '/x', validate: { body: { name: 'string' } }, handler: ok };
    expect(() => buildRouter([route])).to.throw('validate.body is not a zod schema');
  });
});
