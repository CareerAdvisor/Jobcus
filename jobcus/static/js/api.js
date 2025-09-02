// static/js/api.js
// Global helpers for API calls with: cookies, login bounce, and upgrade banners.

(function () {
  // Always send cookies (SameSite=Lax)
  const _fetch = window.fetch.bind(window);
  window.fetch = (input, init = {}) => {
    if (!("credentials" in init)) init.credentials = "same-origin";
    return _fetch(input, init);
  };

  // One banner function to rule them all
  function showBanner(msg) {
    if (typeof window.showUpgradeBanner === "function") {
      window.showUpgradeBanner(msg);
      return;
    }
    alert(msg || "You’ve reached your plan limit. Upgrade to continue.");
  }

  // Minimal “is this a login redirect?” check
  function looksLikeLoginRedirect(res) {
    try {
      // If server bounced (302) to /account, fetch() follows to an HTML page
      // We detect it by URL and non-JSON content-type
      const url = String(res.url || "");
      const ct  = (res.headers.get("content-type") || "").toLowerCase();
      return url.includes("/account") && !ct.includes("application/json");
    } catch { return false; }
  }

  async function jsonFetch(url, opts = {}) {
    const res = await fetch(url, opts);
    const ct  = (res.headers.get("content-type") || "").toLowerCase();
    const isJSON = ct.includes("application/json");
    const body = isJSON ? await res.json() : await res.text();

    // Soft-login bounce: if we were redirected to /account, go there
    if (!isJSON && looksLikeLoginRedirect(res)) {
      const next = encodeURIComponent(location.pathname + location.search);
      location.href = `/account?next=${next}`;
      return null;
    }

    if (!res.ok) {
      const err = (isJSON && (body.error || body.code)) || "";
      const msg = (isJSON && (body.message || body.reply)) || (typeof body === "string" ? body : "Request failed");

      if (res.status === 401) {
        // Unauthorized: go to /account with next=
        const next = encodeURIComponent(location.pathname + location.search);
        location.href = `/account?next=${next}`;
        return null;
      }

      if (res.status === 402 || res.status === 429) {
        // Quota/abuse limits → show banner and throw a typed error
        showBanner(msg || "You’ve reached your plan limit. Upgrade to continue.");
        const e = new Error(msg || "limit");
        e.kind = "limit";
        throw e;
      }

      const e = new Error(msg || "Request failed");
      e.kind = "server";
      throw e;
    }

    return body;
  }

  // Post helper that always JSON-encodes
  async function postJSON(url, data) {
    return jsonFetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json", "Accept": "application/json" },
      body: JSON.stringify(data || {}),
    });
  }

  // Public surface
  window.jsonFetch = jsonFetch;

  // Consistent limit-aware POST (used by chat + analyzer)
  window.api = window.api || {};
  window.api.postWithLimit = async function postWithLimit(url, data) {
    try {
      return await postJSON(url, data);
    } catch (err) {
      if (err && err.kind === "limit") throw err; // already bannered
      throw err;
    }
  };
})();
