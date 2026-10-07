// Shared cookie-session helpers for api/checklist/*.
//
// Stateless on purpose: the cookie carries its own expiry plus an HMAC over
// that expiry, keyed on CHECKLIST_PASSWORD. Verifying it needs no database
// lookup and no separate session secret to provision — one shared password
// env var covers both "is this the right person" and "is this cookie real".
// This is sized for one editor (plus whoever they invite later) on an
// internal tool, not a multi-tenant auth system.
const crypto = require('crypto');

const SESSION_TTL_MS = 7 * 24 * 60 * 60 * 1000; // 7 days

function sign(value, secret) {
  return crypto.createHmac('sha256', secret).update(value).digest('hex');
}

function createSessionCookieValue(secret) {
  const expires = Date.now() + SESSION_TTL_MS;
  return `${expires}.${sign(String(expires), secret)}`;
}

function verifySessionCookieValue(cookieValue, secret) {
  if (!cookieValue) return false;
  const dot = cookieValue.indexOf('.');
  if (dot === -1) return false;
  const expiresStr = cookieValue.slice(0, dot);
  const sig = cookieValue.slice(dot + 1);
  const expires = Number(expiresStr);
  if (!Number.isFinite(expires) || expires < Date.now()) return false;
  const expected = sign(expiresStr, secret);
  const a = Buffer.from(sig);
  const b = Buffer.from(expected);
  if (a.length !== b.length) return false;
  return crypto.timingSafeEqual(a, b);
}

function parseCookies(header) {
  const out = {};
  if (!header) return out;
  header.split(';').forEach((part) => {
    const idx = part.indexOf('=');
    if (idx === -1) return;
    out[part.slice(0, idx).trim()] = decodeURIComponent(part.slice(idx + 1).trim());
  });
  return out;
}

function isAuthenticated(req) {
  const expected = process.env.CHECKLIST_PASSWORD;
  if (!expected) return false;
  const cookies = parseCookies(req.headers.cookie);
  return verifySessionCookieValue(cookies.checklist_session, expected);
}

module.exports = { createSessionCookieValue, verifySessionCookieValue, parseCookies, isAuthenticated, SESSION_TTL_MS };
