// Server-to-server endpoint for the daily ingestion routine to flip
// cloopDone/callLogsDone — a different trust boundary than the browser
// password login above, so it uses a separate shared secret (x-api-key)
// rather than the session cookie.
const crypto = require('crypto');
const { kv } = require('@vercel/kv');

const DOC_KEY = 'checklist:current';
const ALLOWED_KEYS = ['date', 'cloopDone', 'cloopDate', 'callLogsDone', 'callLogsDate', 'note'];

module.exports = async function handler(req, res) {
  if (req.method !== 'POST') {
    res.setHeader('Allow', 'POST');
    return res.status(405).json({ error: 'method_not_allowed' });
  }
  const expected = process.env.CHECKLIST_API_SECRET;
  const provided = req.headers['x-api-key'];
  const match = typeof provided === 'string' && expected
    && Buffer.from(provided).length === Buffer.from(expected).length
    && crypto.timingSafeEqual(Buffer.from(provided), Buffer.from(expected));
  if (!match) {
    return res.status(401).json({ error: 'not_authenticated' });
  }
  const patch = req.body || {};
  const filtered = {};
  for (const k of ALLOWED_KEYS) {
    if (k in patch) filtered[k] = patch[k];
  }
  const current = (await kv.get(DOC_KEY)) || {};
  const next = { ...current, ...filtered };
  await kv.set(DOC_KEY, next);
  return res.status(200).json({ data: next });
};
