// Simple helper for caching message elements and updating them via showMsg

(() => {
  function create(selector) {
    let cached = null;
    const resolve = () => {
      if (cached === null) {
        cached = typeof selector === "string" ? document.querySelector(selector) : selector;
      }
      return cached;
    };
    return {
      set(text, ok = false) {
        const node = resolve();
        if (window.showMsg) {
          window.showMsg(node || selector, text, ok);
        }
      }
    };
  }

  window.MessageHelper = Object.freeze({
    create
  });
})();
