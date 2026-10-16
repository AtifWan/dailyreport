// This page is rendered from two origins (the Vercel deployment itself, and
// the Claude Artifact, which calls these same endpoints cross-origin) — both
// equally trusted, since the page holds nothing sensitive. Wildcard origin
// keeps this working if the Artifact's own origin ever changes, rather than
// pinning to one that could drift.
function withCors(handler) {
  return async function corsWrapped(req, res) {
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
    if (req.method === 'OPTIONS') {
      return res.status(204).end();
    }
    return handler(req, res);
  };
}

module.exports = { withCors };
