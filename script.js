// UI entrypoint: wire DOMContentLoaded to stateStore exports

document.addEventListener("DOMContentLoaded", () => {
  const app = window.LaesekredssApp;
  if (!app || typeof app.boot !== "function") {
    console.error("LaesekredssApp.boot er ikke tilgængelig.");
    return;
  }
  app.boot().catch(err => console.error("Boot fejl:", err));
});
