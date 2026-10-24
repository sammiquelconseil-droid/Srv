// Minimal Telegram Bot API client (no dependency). Long polling only: no public port needed.
export function createTelegram(token, fetchImpl = fetch) {
  const base = `https://api.telegram.org/bot${token}`;
  async function call(method, body) {
    const res = await fetchImpl(`${base}/${method}`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body || {}) });
    const data = await res.json();
    if (!data.ok) throw new Error(`${method}: ${data.description || res.status}`);
    return data.result;
  }
  return {
    call,
    getUpdates: (offset) => call('getUpdates', { offset, timeout: 50, allowed_updates: ['message', 'callback_query'] }),
    send: (chat_id, text, extra) => call('sendMessage', { chat_id, text, ...extra }),
    answerCallback: (id) => call('answerCallbackQuery', { callback_query_id: id }),
    fileUrl: async (file_id) => { const f = await call('getFile', { file_id }); return `https://api.telegram.org/file/bot${token}/${f.file_path}`; },
  };
}
