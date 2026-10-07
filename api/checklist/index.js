const { kv } = require('@vercel/kv');
const { isAuthenticated } = require('../_lib/auth');

const DOC_KEY = 'checklist:current';

module.exports = async function handler(req, res) {
  if (req.method !== 'GET') {
    res.setHeader('Allow', 'GET');
    return res.status(405).json({ error: 'method_not_allowed' });
  }
  if (!isAuthenticated(req)) {
    return res.status(401).json({ error: 'not_authenticated' });
  }
  const data = (await kv.get(DOC_KEY)) || null;
  return res.status(200).json({ data });
};
