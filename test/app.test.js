import { expect } from 'chai';
import request from 'supertest';
import { createApp } from '../src/app.js';

const app = createApp();

describe('app basics', () => {
  it('GET /health returns 200 with status ok', async () => {
    const res = await request(app).get('/health');
    expect(res.status).to.equal(200);
    expect(res.body.status).to.equal('ok');
    expect(res.body.uptimeSeconds).to.be.a('number');
  });

  it('unknown routes return a JSON 404', async () => {
    const res = await request(app).get('/nope');
    expect(res.status).to.equal(404);
    expect(res.body).to.deep.equal({ error: { code: 'not_found', message: 'Route GET /nope not found' } });
  });

  it('broken JSON in the body returns 400, not 500', async () => {
    const res = await request(app).post('/health').set('Content-Type', 'application/json').send('{"oops":');
    expect(res.status).to.equal(400);
    expect(res.body.error.code).to.equal('invalid_json');
  });

  it('security headers are set and Express is not advertised', async () => {
    const res = await request(app).get('/nope');
    expect(res.headers['x-content-type-options']).to.equal('nosniff');
    expect(res.headers).to.not.have.property('x-powered-by');
  });
});
