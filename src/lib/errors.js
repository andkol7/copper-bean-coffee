export class HttpError extends Error {
  constructor(status, code, message, details) {
    super(message);
    this.status = status;
    this.code = code;
    this.details = details;
  }
}

export const badRequest = (message, details) => new HttpError(400, 'bad_request', message, details);
export const unauthorized = (message = 'Authentication required') => new HttpError(401, 'unauthorized', message);
export const forbidden = (message = 'You do not have access to this resource') =>
  new HttpError(403, 'forbidden', message);
export const notFound = (what = 'Resource') => new HttpError(404, 'not_found', `${what} not found`);
export const conflict = (message, details) => new HttpError(409, 'conflict', message, details);
// retryAfterSeconds, when known, goes out as the standard Retry-After header (see middleware/error.js),
// so a client can wait exactly as long as needed instead of guessing from the text.
export const tooManyRequests = (message = 'Too many requests, try again later', retryAfterSeconds) => {
  const err = new HttpError(429, 'too_many_requests', message);
  if (retryAfterSeconds > 0) err.retryAfterSeconds = Math.ceil(retryAfterSeconds);
  return err;
};
