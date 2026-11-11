/* Dev-only CloudKit + Worker stub. Loaded by dev/page.html INSTEAD of the Apple CDN script. Never in production. */
(function () {
  const F = window.TOURNAMENT_FIXTURES;
  const sent = (window.__sent = []);
  window.CloudKit = {
    configure: function () {},
    getDefaultContainer: function () {
      return { publicCloudDatabase: {
        fetchRecords: function (id) {
          const f = F[id];
          return Promise.resolve({ records: [f ? f.rec : { recordName: id, serverErrorCode: "NOT_FOUND" }] });
        },
        performQuery: function (q) {
          const id = q.filterBy[0].fieldValue.value, f = F[id];
          return Promise.resolve({ records: f ? f.scores : [], moreComing: false });
        },
      } };
    },
  };
  /* Worker stub: PIN 1234 is correct; matchID ending in "c1" in a finished tournament -> 403; otherwise 200. */
  const realFetch = window.fetch;
  window.fetch = function (url, opts) {
    if (String(url).indexOf("workers.dev") < 0) return realFetch.apply(this, arguments);
    const body = JSON.parse(opts.body); sent.push({ url: String(url), body });
    const status = body.pin !== "1234" ? 401 : 200;
    return Promise.resolve({ status });
  };
})();
