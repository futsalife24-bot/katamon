/** Fixed database namespace; caller cannot supply paths outside the registry. */
function createStore({ origin, token, emulator = false, approved = false, fetchImpl = fetch }) {
  const url = new URL(origin);
  if (url.username || url.password || url.search || url.hash || url.pathname !== '/') throw new Error('publisher.databaseOrigin');
  if (emulator ? url.origin !== 'http://127.0.0.1:19000' : (url.protocol !== 'https:' || !/^[a-z0-9-]+\.(?:firebaseio\.com|[a-z0-9-]+\.firebasedatabase\.app)$/.test(url.hostname))) throw new Error('publisher.databaseOrigin');
  async function request(path, options = {}) {
    if (path !== 'active' && !/^revisions\/[a-f0-9]{64}$/.test(path)) throw new Error('publisher.databasePath');
    const target = new URL('characterRegistry/' + path + '.json',url);
    if (emulator) target.searchParams.set('ns','demo-catamon-registration-default-rtdb');
    const response = await fetchImpl(target,{ ...options, redirect:'error', signal:AbortSignal.timeout(15000), headers:{ Authorization:'Bearer ' + token,'Content-Type':'application/json',...options.headers } });
    if (!response.ok) throw Object.assign(new Error(response.status === 412 ? 'publisher.activeConflict' : 'publisher.databaseUnavailable'),{ status:response.status });
    return response;
  }
  return {
    applicationApproved:async () => approved === true,
    async read(path) { const response = await request(path,{ headers:{'X-Firebase-ETag':'true'} }); return { value:await require('../../shared/content-studio-registration.js').readJson(response),etag:response.headers.get('etag') }; },
    async compareAndSet(path,etag,value) {
      if (!approved || !etag) throw new Error('publisher.applyNotApproved');
      const response = await request(path,{ method:'PUT',headers:{'if-match':etag},body:JSON.stringify(value) });
      await response.body?.cancel(); // The echoed PUT body is unnecessary; verification uses a separate read.
    },
  };
}
module.exports = { createStore };
