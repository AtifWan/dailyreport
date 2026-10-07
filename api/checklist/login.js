const { createSessionCookieValue } = require('../_lib/auth');

module.exports = async function handler(req, res) {
  if (req.method !== 'POST') {
    res.setHeader('Allow', 'POST');
    return res.status(405).json({ error: 'method_not_allowed' });
  }
  const expected = process.env.CHECKLIST_PASSWORD;
  if (!expected) {
    return res.status(500).json({ error: 'server_not_configured' });
  }
  const { password } = req.body || {};
  if (typeof password !== 'string' || password.length === 0) {
    return res.status(400).json({ error: 'invalid_body' });
  }
  const a = Buffer.from(password);
  const b = Buffer.from(expected);
  const match = a.length === b.length && require('crypto').timingSafeEqual(a, b);
  if (!match) {
    return res.status(401).json({ error: 'invalid_password' });
  }
  const cookieValue = createSessionCookieValue(expected);
  const maxAge = 7 * 24 * 60 * 60;
  res.setHeader('Set-Cookie', `checklist_session=${cookieValue}; HttpOnly; Secure; SameSite=Strict; Path=/; Max-Age=${maxAge}`);
  return res.status(200).json({ ok: true });
};
