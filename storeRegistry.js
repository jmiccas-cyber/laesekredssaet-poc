// Central store registry to coordinate module registration

(() => {
  const registry = Object.create(null);

  function registerStore(name, api) {
    if (!name || typeof api !== "object" || api === null) {
      throw new Error("registerStore requires a name and api object");
    }
    registry[name] = api;
    if (!window[name]) {
      window[name] = api;
    }
    return api;
  }

  function getStore(name) {
    return registry[name] || window[name];
  }

  function hasStore(name) {
    return !!getStore(name);
  }

  window.StoreRegistry = Object.freeze({
    registerStore,
    getStore,
    hasStore
  });
})();

