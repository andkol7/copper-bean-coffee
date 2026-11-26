import mongoose from 'mongoose';
import { toJSONPlugin } from '../../db.js';

// How this module's data is stored in MongoDB. The record classes in model.js work on top of it.

// ---------- Session ----------

// One document per issued refresh token. The token itself (random 256 bits) is given to the
// client once; only its sha256 is stored, so a database leak gives no working tokens.
// sha256 rather than bcrypt: the token cannot be brute-forced anyway, and an unsalted hash can
// be looked up directly (findOne({ tokenHash })).
const sessionSchema = new mongoose.Schema(
  {
    user: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true, index: true },
    tokenHash: { type: String, required: true, unique: true },
    // Shared by all tokens of one login, through every refresh. If a used token comes back,
    // someone has a copy, and the whole family is revoked.
    family: { type: String, required: true, index: true },
    // When this token was exchanged for a new pair; a token works only once.
    usedAt: { type: Date, default: null },
    // TTL index: MongoDB deletes the document after this time.
    expiresAt: { type: Date, required: true, index: { expires: 0 } },
  },
  { timestamps: true },
);

sessionSchema.plugin(toJSONPlugin, { hide: ['tokenHash'] });

export const SessionCollection = mongoose.model('Session', sessionSchema);

// ---------- PasswordFailure ----------

// Wrong-password counter per email (see settings.passwordLock). Kept for unknown emails too,
// so a lock never tells whether an account exists. Every failure pushes expiresAt forward;
// the TTL index removes the counter once the email has been quiet long enough.
const passwordFailureSchema = new mongoose.Schema(
  {
    email: { type: String, required: true, unique: true, lowercase: true, trim: true },
    failures: { type: Number, default: 0 },
    expiresAt: { type: Date, required: true, index: { expires: 0 } },
  },
  { timestamps: true },
);

passwordFailureSchema.plugin(toJSONPlugin);

export const PasswordFailureCollection = mongoose.model('PasswordFailure', passwordFailureSchema);
