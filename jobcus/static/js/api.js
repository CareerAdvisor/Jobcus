// ──────────────────────────────────────────────────────────────
// Server call helper (handles limit + generic errors)
// ──────────────────────────────────────────────────────────────
async function sendMessage(payload) {
  const res = await fetch('/ask', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  });

  let data = null;
  const ct = res.headers.get('content-type') || '';
  if (ct.includes('application/json')) {
    data = await res.json().catch(() => null);
  } else {
    try { data = JSON.parse(await res.text()); } catch { /* ignore */ }
  }

  // New unified “free limit reached” handling:
  // - 402 with quota_exceeded (legacy)
  // - 429 with too_many_free_accounts (device/network guard)
  // - 429 with quota_exceeded (some routes now use 429)
  if (!res.ok) {
    if ((res.status === 402 && data?.error === 'quota_exceeded') ||
        (res.status === 429 && (data?.error === 'too_many_free_accounts' || data?.error === 'quota_exceeded'))) {
      showUpgradeBanner('You have reached the limit for the free version, upgrade to enjoy more features');
      throw { kind: 'limit', message: data?.message || 'Free limit reached' };
    }
    // Other errors
    throw { kind: 'server', message: (data?.message || data?.reply || `Request failed (${res.status})`) };
  }

  return data; // { reply, modelUsed }
}
