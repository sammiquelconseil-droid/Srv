// One delivery = one INBOX line, or for a long note a file in inbox/ plus a pointer line. Built once, so a
// retry rewrites the same file and the same line (sync skips a line already present).
export function itemFor(project, line, meta = {}, iso = new Date().toISOString(), hash = '') {
  const item = { project, line };
  if (meta.long ?? line.length > 1500) {
    item.file = `inbox/${iso.slice(0, 19).replace(/[:T]/g, '-')}${hash ? `-${hash}` : ''}.md`;
    item.pointer = `${(line.match(/^- [^—]*— /) || ['- '])[0]}${meta.title || ''}… → texte complet : ${item.file}`;
  }
  return item;
}

// onProtected(repo): called once when main refuses the write; it switches that repo to its reception branch.
export function createDeliver(sync, repoOf, { onProtected = null } = {}) {
  const once = async (repo, item) => {
    if (item.file) {
      if (!(await sync.put(repo, item.file, item.line.replace(/^- /, '') + '\n', 'INBOX : note longue du bot personnel [skip ci] [skip render] [skip netlify]'))) return false;
      return sync(repo, item.pointer);
    }
    return sync(repo, item.line);
  };
  return async (item) => {
    const repo = repoOf(item.project);
    try { return await once(repo, item); }
    catch (e) {
      if (!onProtected || !sync.needsBranch || !sync.needsBranch(e, repo)) throw e;
      await onProtected(repo);
      return once(repo, item); // same content, same idempotent append: no double
    }
  };
}

// Notes that could not reach GitHub wait here and are retried; delivery must be idempotent.
export function createQueue({ load = () => [], save = () => {}, deliver, log = async () => {} }) {
  let items = load() || [];
  return {
    get size() { return items.length; },
    add(item) { items.push(item); save(items); },
    async flush() {
      const left = [];
      for (const item of items) {
        try { if (!(await deliver(item))) left.push(item); } catch (e) { left.push(item); await log(`retry failed ${item.project}: ${e.message}`); }
      }
      const sent = items.length - left.length; items = left; save(items);
      return sent;
    },
  };
}
