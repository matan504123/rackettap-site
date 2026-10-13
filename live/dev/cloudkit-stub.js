/* Dev-only CloudKit stub. Loaded by dev/page.html INSTEAD of the Apple CDN
 * script. Serves fixture records (fixtures.js) keyed by the share id in the
 * URL fragment. Never referenced by the production page. */
(function () {
  window.CloudKit = {
    configure: function () {},
    getDefaultContainer: function () {
      return { publicCloudDatabase: { fetchRecords: function (id) {
        const make = window.LIVE_FIXTURES[id];
        if (!make) return Promise.resolve({ records: [{ recordName: id, serverErrorCode: "NOT_FOUND" }] });
        return Promise.resolve({ records: [make()] });
      } } };
    },
  };
})();
