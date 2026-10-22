// Runs the built background checker (dist/runners/background.js) in QuickJS, the engine
// Capacitor Background Runner uses on Android, against the saved pages in tests/fixtures.
// Usage: npm run test:runner   (needs `pkg install quickjs-ng`)
// Stand-ins for what Capacitor Background Runner provides on Android.
globalThis.setTimeout = (fn, ms) => os.setTimeout(fn, ms);
globalThis.clearTimeout = (h) => os.clearTimeout(h);
globalThis.console = { log: (...a) => print('[log]', ...a), error: (...a) => print('[error]', ...a), warn: (...a) => print('[warn]', ...a), info: (...a) => print('[info]', ...a), debug() {} };
const KV = {};
globalThis.CapacitorKV = { get: (k) => (k in KV ? { value: KV[k] } : { value: null }), set: (k, v) => { KV[k] = v; } };
const NOTES = [];
globalThis.CapacitorNotifications = { schedule: (n) => NOTES.push(...n) };
const HANDLERS = {};
globalThis.addEventListener = (ev, fn) => { HANDLERS[ev] = fn; };
const routes = [[/amazon\.in/, 'search-amazon.html'], [/flipkart\.com/, 'search-flipkart.html'], [/nykaa\.com/, 'search-nykaa.html'], [/myntra\.com/, 'search-myntra.html'], [/meesho\.com/, 'search-meesho.json'], [/ajio\.com/, 'search-ajio.html'], [/tatacliq\.com/, 'search-tatacliq.html'], [/reliancedigital/, 'search-reliance.json'], [/croma\.com/, 'search-croma.json']];
const FETCHED = [];
globalThis.fetch = (url, init) => new Promise((resolve) => {
  FETCHED.push(`${init && init.method || 'GET'} ${url}`);
  const r = routes.find(([re]) => re.test(url));
  const body = r ? std.loadFile('tests/fixtures/' + r[1]) : '';
  os.setTimeout(() => resolve({ status: r ? 200 : 404, text: () => Promise.resolve(body) }), 5);
});
KV.settings = JSON.stringify({ lang: 'hinglish' });
KV.wallet = JSON.stringify({ cards: [{ bank: 'axis', type: 'credit', card: 'flipkart-axis' }], apps: [], memberships: [], newUser: false });
KV.watch = JSON.stringify([
  { id: 'lakme sunscreen spf 50', query: 'lakme sunscreen spf 50', title: 'Lakme Sunscreen SPF 50', target: 5000, history: [{ t: Date.now() - 3 * 86400000, price: 9999, site: 'Amazon', v: 2 }], lastChecked: 0 },
  { id: 'fresh', query: 'x', title: 'checked a minute ago', history: [], lastChecked: Date.now() - 60000 },
]);
