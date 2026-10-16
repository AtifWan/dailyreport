"""
Shared helpers for the on-demand "Generate" API endpoints (api/generate/*.py):
committing a parsed result straight to GitHub, and updating the Vercel KV
checklist doc — both over plain HTTPS via urllib, so neither endpoint needs a
third-party dependency (no requirements.txt for the Vercel Python runtime to
install, consistent with this project's "no build step" design).

Deliberately dependency-free rather than using PyGithub/requests/the
@vercel/kv JS client (not usable from Python anyway) — these are small,
well-defined REST calls and stdlib's urllib covers them without adding a
package the deployment has to resolve.
"""
import base64
import json
import urllib.error
import urllib.parse
import urllib.request
from pathlib import Path

GITHUB_API = "https://api.github.com"


def read_local_or_github(repo_root, owner, repo, branch, token, rel_path):
    """Vercel's Python runtime bundles the whole project alongside the
    function (unlike Node's file-tracing, which only ships files a build
    step can prove are referenced), so the committed JSON under
    assets/data/reports/ should normally just be sitting on disk right next
    to this function — reading it directly is instant and avoids a GitHub
    API call. Falls back to a live GitHub read for the one case that can't
    be true from disk: a date committed after this function's own last
    deploy. Never assume only one of the two will ever work."""
    local = repo_root / rel_path
    if local.exists():
        return local.read_text(encoding="utf-8")
    return github_get_file(owner, repo, branch, rel_path, token)


def github_request(method, url, token, body=None):
    data = json.dumps(body).encode() if body is not None else None
    req = urllib.request.Request(url, data=data, method=method, headers={
        "Authorization": f"Bearer {token}",
        "Accept": "application/vnd.github+json",
        "X-GitHub-Api-Version": "2022-11-28",
        "User-Agent": "dailyreport-generate-endpoint",
        **({"Content-Type": "application/json"} if body is not None else {}),
    })
    try:
        with urllib.request.urlopen(req, timeout=20) as resp:
            return resp.status, json.loads(resp.read().decode())
    except urllib.error.HTTPError as e:
        try:
            payload = json.loads(e.read().decode())
        except Exception:
            payload = {"message": str(e)}
        return e.code, payload


def github_commit_file(owner, repo, branch, path, content_str, message, token):
    """Create or update one file via the Contents API — the existing file's
    sha is required to update it, so this always does a GET first (a 404
    there just means the file is new)."""
    base_url = f"{GITHUB_API}/repos/{owner}/{repo}/contents/{path}"
    status, existing = github_request("GET", f"{base_url}?ref={branch}", token)
    sha = existing.get("sha") if status == 200 else None

    body = {
        "message": message,
        "content": base64.b64encode(content_str.encode()).decode(),
        "branch": branch,
    }
    if sha:
        body["sha"] = sha

    status, result = github_request("PUT", base_url, token, body)
    if status not in (200, 201):
        raise RuntimeError(f"GitHub commit failed ({status}): {result.get('message', result)}")
    return {
        "commitSha": result.get("commit", {}).get("sha"),
        "commitUrl": result.get("commit", {}).get("html_url"),
        "contentUrl": result.get("content", {}).get("html_url"),
    }


def github_get_file(owner, repo, branch, path, token):
    """Read one committed file's raw text, or None if it doesn't exist on
    this branch — used to find the previous date's own call-logs.json/
    cloop.json for trend chaining, and to check whether a date folder has
    tasks.json/leave.json already (i.e. the PDF pipeline has a home for it)."""
    url = f"{GITHUB_API}/repos/{owner}/{repo}/contents/{path}?ref={branch}"
    status, result = github_request("GET", url, token)
    if status != 200:
        return None
    return base64.b64decode(result["content"]).decode("utf-8")


def get_manifest(repo_root, owner, repo, branch, token):
    text = read_local_or_github(repo_root, owner, repo, branch, token, "assets/data/reports/index.json")
    return json.loads(text) if text else {"dates": [], "latest": None}


def find_prev_committed(repo_root, owner, repo, branch, token, manifest, date, filename):
    """The latest date strictly before `date` in the manifest whose own
    <date>/<filename> exists — mirrors the daily routine's own '--prev'
    convention (chain from the most recent actual commit, not just the
    immediately-preceding calendar date, in case that date never got this
    particular file)."""
    candidates = sorted(d for d in manifest["dates"] if d < date)
    for d in reversed(candidates):
        text = read_local_or_github(repo_root, owner, repo, branch, token, f"assets/data/reports/{d}/{filename}")
        if text:
            return d, json.loads(text)
    return None, None


def has_committed_date(repo_root, owner, repo, branch, token, date):
    """True if assets/data/reports/<date>/ already has tasks.json AND
    leave.json — i.e. the PDF pipeline has a home for this date already,
    same gate the daily routine itself uses (STEP 5c) before writing
    call-logs.json/cloop.json into it."""
    tasks = read_local_or_github(repo_root, owner, repo, branch, token, f"assets/data/reports/{date}/tasks.json")
    leave = read_local_or_github(repo_root, owner, repo, branch, token, f"assets/data/reports/{date}/leave.json")
    return bool(tasks and leave)


def kv_request(command_path, kv_url, kv_token):
    """One call against Upstash's REST API (the same store Vercel KV is
    backed by) — e.g. command_path='get/checklist:current' or
    'set/checklist:current/<url-encoded-json>'."""
    req = urllib.request.Request(
        f"{kv_url}/{command_path}",
        headers={"Authorization": f"Bearer {kv_token}"},
    )
    try:
        with urllib.request.urlopen(req, timeout=10) as resp:
            return json.loads(resp.read().decode())
    except urllib.error.HTTPError as e:
        try:
            payload = json.loads(e.read().decode())
        except Exception:
            payload = {}
        raise RuntimeError(f"KV request failed ({e.code}): {payload.get('error', str(e))}") from None


def kv_update_checklist(patch, kv_url, kv_token):
    """Merge `patch` into the checklist:current doc, same shape as
    api/checklist/status.js's own update (this endpoint writes to the same
    key so both paths — the daily routine's relay, and this on-demand
    button — keep one consistent checklist state)."""
    current_raw = kv_request("get/checklist:current", kv_url, kv_token).get("result")
    current = json.loads(current_raw) if current_raw else {}
    next_doc = {**current, **patch}
    # Upstash's GET-style REST calls take each command argument as its own
    # URL path segment — quote()'s default safe='/' leaves literal slashes
    # in the JSON unescaped, which splits the value across segments and
    # gets rejected as a malformed command (400 Bad Request). safe='' forces
    # every reserved character, slashes included, to be percent-encoded.
    encoded = urllib.parse.quote(json.dumps(next_doc), safe='')
    kv_request(f"set/checklist:current/{encoded}", kv_url, kv_token)
    return next_doc
