// Helper utilities for batching Supabase operations

(() => {
  async function processChunks(items = [], chunkSize = 100, handler = async () => {}) {
    if (!Array.isArray(items) || !items.length || typeof handler !== "function") {
      return { processed: 0 };
    }
    let processed = 0;
    for (let i = 0; i < items.length; i += chunkSize) {
      const chunk = items.slice(i, i + chunkSize);
      await handler(chunk, i / chunkSize);
      processed += chunk.length;
    }
    return { processed };
  }

  window.SupabaseHelper = Object.freeze({
    processChunks
  });
})();
