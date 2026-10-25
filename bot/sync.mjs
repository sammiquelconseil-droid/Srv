// Append a line to INBOX.md of a GitHub repo through the Contents API (no git on the server).
// branchOf(repo) -> branch name when the notes of that repo go to a reception branch (main protected), else null.
export function createSync({ getToken, owner, fetchImpl = fetch, branchOf = () => null }) {
  const API = `https://api.github.com/repos/${owner}`;
  const headers = (token) => ({ authorization: `Bearer ${token}`, accept: 'application/vnd.github+json', 'content-type': 'application/json' });
  const failed = async (what, r) => { let m = ''; try { m = (await r.json()).message || ''; } catch {} return new Error(`GitHub ${what} ${r.status}${m ? `: ${m}` : ''}`); };
  const q = (repo) => (branchOf(repo) ? `?ref=${encodeURIComponent(branchOf(repo))}` : '');
  const withBranch = (repo, body) => (branchOf(repo) ? { ...body, branch: branchOf(repo) } : body);

  async function put(repo, filePath, content, message) {
    const token = await getToken(); if (!token) return false;
    const h = headers(token);
    const url = `${API}/${repo}/contents/${filePath}`;
    const cur = await fetchImpl(url + q(repo), { headers: h }); let sha;
    if (cur.status === 200) sha = (await cur.json()).sha; else if (cur.status !== 404) throw await failed('GET', cur);
    const r = await fetchImpl(url, { method: 'PUT', headers: h, body: JSON.stringify(withBranch(repo, { message, content: Buffer.from(content).toString('base64'), sha })) });
    if (!r.ok) throw await failed('PUT', r);
    return true;
  }
  async function append(repo, line) {
    const token = await getToken();
    if (!token) return false;
    const h = headers(token);
    const url = `${API}/${repo}/contents/INBOX.md`;
    const cur = await fetchImpl(url + q(repo), { headers: h });
    let sha, body = '# INBOX.md\n\n';
    if (cur.status === 200) { const j = await cur.json(); sha = j.sha; body = Buffer.from(j.content, 'base64').toString('utf8'); }
    else if (cur.status !== 404) throw await failed('GET', cur);
    if (body.includes(line)) return true; // already there (a retry after a lost answer)
    body = body.replace(/\(vide\)\n?/, '').replace(/\s*$/, '\n') + line + '\n';
    const res = await fetchImpl(url, { method: 'PUT', headers: h, body: JSON.stringify(withBranch(repo, { message: 'INBOX : note du bot personnel [skip ci] [skip render] [skip netlify]', content: Buffer.from(body).toString('base64'), sha })) });
    if (!res.ok) throw await failed('PUT', res);
    return true;
  }
  // A refused write because main is protected (ruleset / branch protection), or a reception branch that vanished.
  append.needsBranch = (e, repo) => /^GitHub PUT (403|422).*(rule|protect)/i.test(e.message) || (!!branchOf(repo) && /^GitHub (GET|PUT) 404/.test(e.message));
  // Create the reception branch from the default branch if it does not exist (same token, no extra right).
  async function ensureBranch(repo, name) {
    const token = await getToken(); if (!token) return false;
    const h = headers(token);
    const have = await fetchImpl(`${API}/${repo}/git/ref/heads/${encodeURIComponent(name)}`, { headers: h });
    if (have.status === 200) return true;
    if (have.status !== 404) throw await failed('GET ref', have);
    const info = await fetchImpl(`${API}/${repo}`, { headers: h }); if (info.status !== 200) throw await failed('GET repo', info);
    const def = (await info.json()).default_branch || 'main';
    const base = await fetchImpl(`${API}/${repo}/git/ref/heads/${encodeURIComponent(def)}`, { headers: h }); if (base.status !== 200) throw await failed('GET base', base);
    const sha = (await base.json()).object.sha;
    const made = await fetchImpl(`${API}/${repo}/git/refs`, { method: 'POST', headers: h, body: JSON.stringify({ ref: `refs/heads/${name}`, sha }) });
    if (!made.ok && made.status !== 422) throw await failed('POST ref', made); // 422 = created meanwhile
    return true;
  }
  append.ensureBranch = ensureBranch;
  // Read-only helpers for the « où en sont mes projets » view (same token, no extra right).
  async function read(repo, filePath) {
    const token = await getToken(); if (!token) return null;
    const r = await fetchImpl(`https://api.github.com/repos/${owner}/${repo}/contents/${filePath}`, { headers: { authorization: `Bearer ${token}`, accept: 'application/vnd.github+json' } });
    if (r.status !== 200) return null;
    return Buffer.from((await r.json()).content, 'base64').toString('utf8');
  }
  async function commit(repo) {
    const token = await getToken(); if (!token) return null;
    const r = await fetchImpl(`https://api.github.com/repos/${owner}/${repo}/commits?per_page=1`, { headers: { authorization: `Bearer ${token}`, accept: 'application/vnd.github+json' } });
    if (r.status !== 200) return null;
    const [c] = await r.json(); return c ? { date: c.commit.committer.date, message: c.commit.message } : null;
  }
  append.put = put; append.read = read; append.commit = commit;
  return append;
}
