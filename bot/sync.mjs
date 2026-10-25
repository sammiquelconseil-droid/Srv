// Append a line to INBOX.md of a GitHub repo through the Contents API (no git on the server).
export function createSync({ getToken, owner, fetchImpl = fetch }) {
  async function put(repo, filePath, content, message) {
    const token = await getToken(); if (!token) return false;
    const h = { authorization: `Bearer ${token}`, accept: 'application/vnd.github+json', 'content-type': 'application/json' };
    const url = `https://api.github.com/repos/${owner}/${repo}/contents/${filePath}`;
    const cur = await fetchImpl(url, { headers: h }); let sha;
    if (cur.status === 200) sha = (await cur.json()).sha; else if (cur.status !== 404) throw new Error(`GitHub ${cur.status}`);
    const r = await fetchImpl(url, { method: 'PUT', headers: h, body: JSON.stringify({ message, content: Buffer.from(content).toString('base64'), sha }) });
    if (!r.ok) throw new Error(`GitHub PUT ${r.status}`);
    return true;
  }
  async function append(repo, line) {
    const token = await getToken();
    if (!token) return false;
    const h = { authorization: `Bearer ${token}`, accept: 'application/vnd.github+json', 'content-type': 'application/json' };
    const url = `https://api.github.com/repos/${owner}/${repo}/contents/INBOX.md`;
    const cur = await fetchImpl(url, { headers: h });
    let sha, body = '# INBOX.md\n\n';
    if (cur.status === 200) { const j = await cur.json(); sha = j.sha; body = Buffer.from(j.content, 'base64').toString('utf8'); }
    else if (cur.status !== 404) throw new Error(`GitHub ${cur.status}`);
    body = body.replace(/\(vide\)\n?/, '').replace(/\s*$/, '\n') + line + '\n';
    const res = await fetchImpl(url, { method: 'PUT', headers: h, body: JSON.stringify({ message: 'INBOX : note du bot personnel [skip ci] [skip render] [skip netlify]', content: Buffer.from(body).toString('base64'), sha }) });
    if (!res.ok) throw new Error(`GitHub PUT ${res.status}`);
    return true;
  }
  append.put = put;
  return append;
}
