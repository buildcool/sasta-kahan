const t0 = Date.now();
HANDLERS.checkWatchlist(() => {
  const watch = JSON.parse(KV.watch);
  print('done in', Date.now() - t0, 'ms');
  print('fetched', FETCHED.length);
  FETCHED.forEach((u) => print('  ' + u.slice(0, 90)));
  print('item0 history', JSON.stringify(watch[0].history));
  print('item0 lastChecked set', watch[0].lastChecked > t0 - 1000, 'inStock', watch[0].inStock, 'url', watch[0].url);
  print('item1 untouched', watch[1].lastChecked < t0 - 30000);
  print('notifications', JSON.stringify(NOTES));
}, (e) => print('REJECT', e), {});
