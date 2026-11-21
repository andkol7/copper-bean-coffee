import mongoose from 'mongoose';
import { ZodError } from 'zod';
import { HttpError } from '../lib/errors.js';

const send = (res, status, code, message, details) =>
  res.status(status).json({ error: { code, message, ...(details !== undefined && { details }) } });

export function notFoundHandler(req, res) {
  send(res, 404, 'not_found', `Route ${req.method} ${req.path} not found`);
}

// Every error leaves the API in the same shape: { error: { code, message, details? } }.
export function errorHandler(err, req, res, next) {
  if (res.headersSent) return next(err);

  if (err instanceof HttpError) return send(res, err.status, err.code, err.message, err.details);

  if (err instanceof ZodError) {
    const details = err.issues.map((issue) => ({ path: issue.path.map(String).join('.'), message: issue.message }));
    return send(res, 400, 'validation_error', 'Request validation failed', details);
  }

  if (err instanceof mongoose.Error.CastError) return send(res, 400, 'invalid_id', `Invalid value for ${err.path}`);

  if (err instanceof mongoose.Error.ValidationError) {
    const details = Object.values(err.errors).map((e) => ({ path: e.path, message: e.message }));
    return send(res, 400, 'validation_error', 'Request validation failed', details);
  }

  if (err?.code === 11000) {
    return send(res, 409, 'duplicate', 'A record with these values already exists', Object.keys(err.keyValue ?? {}));
  }

  if (err?.type === 'entity.parse.failed') return send(res, 400, 'invalid_json', 'Request body is not valid JSON');
  if (err?.type === 'entity.too.large') return send(res, 413, 'payload_too_large', 'Request body is too large');

  // err.where is set by BaseController.wrap, e.g. "ProductsController.create".
  if (process.env.NODE_ENV !== 'test') console.error(`Unhandled error${err?.where ? ` in ${err.where}` : ''}:`, err);
  return send(res, 500, 'internal_error', 'Something went wrong');
}
