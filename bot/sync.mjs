// Append a line to INBOX.md of a GitHub repo through the Contents API (no git on the server).
export function createSync({ token, owner, fetchImpl = fetch }) {
  if (!token) return null;
  const h = { authorization: `Bearer ${token}`, accept: 'application/vnd.github+json', 'content-type': 'application/json' };
  return async function append(repo, line) {
    const url = `https://api.github.com/repos/${owner}/${repo}/contents/INBOX.md`;
    const cur = await fetchImpl(url, { headers: h });
    let sha, body = '# INBOX.md\n\n';
    if (cur.status === 200) { const j = await cur.json(); sha = j.sha; body = Buffer.from(j.content, 'base64').toString('utf8'); }
    else if (cur.status !== 404) throw new Error(`GitHub ${cur.status}`);
    body = body.replace(/\(vide\)\n?/, '').replace(/\s*$/, '\n') + line + '\n';
    const put = await fetchImpl(url, { method: 'PUT', headers: h, body: JSON.stringify({ message: 'INBOX : note du bot personnel', content: Buffer.from(body).toString('base64'), sha }) });
    if (!put.ok) throw new Error(`GitHub PUT ${put.status}`);
    return true;
  };
}
