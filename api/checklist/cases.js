const { kv } = require('@vercel/kv');

const DOC_KEY = 'checklist:current';

module.exports = async function handler(req, res) {
  if (req.method !== 'POST') {
    res.setHeader('Allow', 'POST');
    return res.status(405).json({ error: 'method_not_allowed' });
  }
  const { totalOverallCases, totalInProgress, totalOpenCases } = req.body || {};
  const values = [totalOverallCases, totalInProgress, totalOpenCases];
  if (!values.every((n) => Number.isFinite(Number(n)))) {
    return res.status(400).json({ error: 'invalid_body' });
  }
  const current = (await kv.get(DOC_KEY)) || {};
  const next = {
    ...current,
    casesEntered: true,
    casesValues: {
      totalOverallCases: Number(totalOverallCases),
      totalInProgress: Number(totalInProgress),
      totalOpenCases: Number(totalOpenCases),
    },
  };
  await kv.set(DOC_KEY, next);
  return res.status(200).json({ data: next });
};
