export const REQUEST_PARTS = ['params', 'query', 'body'];

// Checks the request against the zod schemas from a route's `validate` field.
// Parsed results go to req.valid ({ params, query, body }): in Express 5 req.query is
// read-only, and keeping them apart makes it obvious in a controller which data was checked.
// zod drops fields a schema does not list, so a client cannot set e.g. its own role.
// A failed check throws ZodError, which the error handler turns into 400 with details.
export const validate = (schemas) => (req, res, next) => {
  req.valid = {};
  for (const part of REQUEST_PARTS) {
    if (schemas[part]) req.valid[part] = schemas[part].parse(req[part] ?? {});
  }
  next();
};
