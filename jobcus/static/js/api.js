// static/js/api.js
;(function(){
  window.jsonFetch = async function jsonFetch(url, opts = {}) {
    const res = await fetch(url, { credentials: "same-origin", ...opts });
    const ct = (res.headers.get("content-type") || "").toLowerCase();
    const isJSON = ct.includes("application/json");
    const body = isJSON ? await res.json() : await res.text();

    if (!isJSON && res.url.includes("/account")) {
      location.href = "/account?next=" + encodeURIComponent(location.pathname);
      return null;
    }
    if (!res.ok) {
      const msg = (isJSON ? (body.message || body.error) : "") || "Request failed";
      throw new Error(msg);
    }
    return body;
  };
})();
