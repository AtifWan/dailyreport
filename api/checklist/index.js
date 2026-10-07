const { kv } = require('@vercel/kv');
const { withCors } = require('../_lib/cors');

const DOC_KEY = 'checklist:current';

// No login gate: this page is an internal status board, not a place that
// takes or shows anything sensitive, so anyone with the link can view it.
module.exports = withCors(async function handler(req, res) {
  if (req.method !== 'GET') {
    res.setHeader('Allow', 'GET');
    return res.status(405).json({ error: 'method_not_allowed' });
  }
  const data = (await kv.get(DOC_KEY)) || null;
  return res.status(200).json({ data });
});
