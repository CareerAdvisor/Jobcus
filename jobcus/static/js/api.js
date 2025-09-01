// jobcus/static/js/api.js
// Unified helpers for JSON API calls with quota/upgrade handling.
//
// What it handles (and shows the upgrade banner for):
// - 402 + { error: "quota_exceeded", ... }          → free tier limit reached
// - 429 + { error: "too_many_free_accounts" | "quota_exceeded" } → device/network guard or shared-limit cap
// - 403 + { error: "upgrade_required", ... }        → feature is gated to paid plans
//
// Anything else throws a { kind: "server", status, message, data } error.
// Callers can catch errors and branch on err.kind if needed.
//
// Usage (ES modules):
//   import { postWithLimit, getWithLimit } from "/static/js/api.js";
//   const data = await postWithLimit("/ask", { message, model });
//
// This file assumes base.html includes base.js (which defines window.showUpgradeBanner)
// before page-scoped <script type="module"> tags.

function _banner(text) {
  if (typeof window !== "undefined" && typeof window.showUpgradeBanner === "function") {
    window.showUpgradeBanner(text);
  } else {
    alert(text);
  }
}

/** Try to parse JSON even if server forgot content-type. */
async function parseJsonResponse(res) {
  const ct = (res.headers.get("content-type") || "").toLowerCase();
  if (ct.includes("application/json")) {
    try { return await res.json(); } catch { return null; }
  }
  // Fallback: attempt to parse text as JSON
  try { return JSON.parse(await res.text()); } catch { return null; }
}

function _isLimitStatus(res, data) {
  const err = (data && data.error) || "";
  return (
    (res.status === 402 && err === "quota_exceeded") ||
    (res.status === 429 && (err === "too_many_free_accounts" || err === "quota_exceeded"))
  );
}

function _isUpgradeRequired(res, data) {
  return res.status === 403 && (data && data.error) === "upgrade_required";
}

/**
 * Low-level request wrapper that:
 * - sets sensible JSON headers
 * - stringifies object bodies
 * - shows banner on limit/upgrade errors
 * - throws structured errors: { kind: "limit" | "upgrade" | "server", status, message, data }
 */
export async function requestWithLimit(url, options = {}) {
  const opts = { method: "GET", ...options };
  const headers = new Headers(opts.headers || {});
  if (!headers.has("Accept")) headers.set("Accept", "application/json");

  // Auto-JSON encode plain objects
  if (opts.body && typeof opts.body === "object" && !(opts.body instanceof FormData) && !(opts.body instanceof Blob)) {
    if (!headers.has("Content-Type")) headers.set("Content-Type", "application/json");
    if (headers.get("Content-Type")?.includes("application/json")) {
      opts.body = JSON.stringify(opts.body);
    }
  }
  opts.headers = headers;

  const res = await fetch(url, opts);
  const data = await parseJsonResponse(res);

  if (!res.ok) {
    // Free limit reached (402/429)
    if (_isLimitStatus(res, data)) {
      _banner(data?.message || "You have reached the limit for the free version, upgrade to enjoy more features");
      throw {
        kind: "limit",
        status: res.status,
        message: data?.message || "Free limit reached",
        data
      };
    }
    // Feature is gated (e.g., downloads/optimize)
    if (_isUpgradeRequired(res, data)) {
      _banner(data?.message || "This feature requires a paid plan.");
      throw {
        kind: "upgrade",
        status: res.status,
        message: data?.message || "Upgrade required",
        data
      };
    }
    // Everything else
    throw {
      kind: "server",
      status: res.status,
      message: data?.message || data?.reply || `Request failed (${res.status})`,
      data
    };
  }

  return data;
}

// Convenience wrappers
export async function getWithLimit(url, options = {}) {
  return requestWithLimit(url, { ...options, method: "GET" });
}

export async function postWithLimit(url, payload = {}, options = {}) {
  return requestWithLimit(url, { ...options, method: "POST", body: payload });
}

export async function putWithLimit(url, payload = {}, options = {}) {
  return requestWithLimit(url, { ...options, method: "PUT", body: payload });
}

export async function deleteWithLimit(url, payload = null, options = {}) {
  // Some APIs accept a JSON body for DELETE; pass null to omit.
  const base = { ...options, method: "DELETE" };
  if (payload !== null) base.body = payload;
  return requestWithLimit(url, base);
}

// Optional: tiny type guards you can use in catch blocks
export function isLimitError(err)   { return err && err.kind === "limit"; }
export function isUpgradeError(err) { return err && err.kind === "upgrade"; }
export function isServerError(err)  { return err && err.kind === "server"; }

// Optional: small helper to safely read JSON-ish content from non-API endpoints
export { parseJsonResponse };
