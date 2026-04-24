// auth.js — shared session gate for every Backstage page that
// requires a signed-in user. login.html does NOT include this
// (it's the sign-in surface).
//
// Contract:
//   - Including page must define `window.sb` (Supabase client) BEFORE
//     loading this file. Every page already does `const sb =
//     supabase.createClient(URL, KEY)`; we read from window.sb so
//     the const is still usable.
//   - Including page must call `window.authGate()` explicitly before
//     running any data fetches. The gate:
//       1. Hides <body> until verdict is reached.
//       2. Checks for a session; redirects to login.html if missing.
//       3. Calls current_user_role() RPC.
//       4. If role is NULL — signs out, flags not_invited, redirects
//          to login.html. This is the invite-only backstop.
//       5. On success — stashes role on window.CURRENT_USER_ROLE
//          (consumed by future briefs S / U / X) and unhides <body>.
//   - `window.signOut()` is exposed for the Lock button.
//
// No IIFE on load: explicit call keeps the ordering unambiguous and
// makes it obvious in each page where the gate fires.

(function () {
  // Hide <body> as early as possible. CSS var stays minimal — we
  // unhide once the gate resolves. visibility:hidden (not
  // display:none) preserves layout so there's no reflow on unhide.
  var style = document.createElement('style');
  style.textContent = 'body { visibility: hidden; }';
  style.setAttribute('data-auth-gate', '1');
  document.head.appendChild(style);

  function unhideBody() {
    var s = document.querySelector('style[data-auth-gate="1"]');
    if (s) s.remove();
  }

  async function authGate() {
    var sb = window.sb;
    if (!sb) {
      console.error('[auth] window.sb not defined before authGate() call');
      unhideBody();
      return;
    }

    var sessionResp;
    try {
      sessionResp = await sb.auth.getSession();
    } catch (e) {
      console.error('[auth] getSession threw', e);
      location.replace('/login.html');
      return;
    }
    var session = sessionResp && sessionResp.data && sessionResp.data.session;
    if (!session) {
      location.replace('/login.html');
      return;
    }

    var rpc;
    try {
      rpc = await sb.rpc('current_user_role');
    } catch (e) {
      console.error('[auth] current_user_role rpc threw', e);
      await sb.auth.signOut();
      sessionStorage.setItem('auth_rejection', 'not_invited');
      location.replace('/login.html');
      return;
    }

    // Shape-probe: Supabase JS v2 returns { data, error } where data
    // is the RPC's direct return (for `returns text`, a string or
    // null). Keep a defensive accessor in case the shape drifts, and
    // log the observed shape once so we can simplify later.
    if (!window.__AUTH_SHAPE_LOGGED__) {
      console.log('[auth] rpc shape observed:', JSON.stringify({
        hasError: !!rpc.error,
        dataType: typeof rpc.data,
        dataIsArray: Array.isArray(rpc.data),
        dataValue: rpc.data
      }));
      window.__AUTH_SHAPE_LOGGED__ = true;
    }

    var role = null;
    if (!rpc.error) {
      if (typeof rpc.data === 'string') {
        role = rpc.data;
      } else if (Array.isArray(rpc.data) && rpc.data.length) {
        role = rpc.data[0].current_user_role || rpc.data[0].role || null;
      } else if (rpc.data && typeof rpc.data === 'object') {
        role = rpc.data.current_user_role || rpc.data.role || null;
      }
    }

    if (rpc.error || !role) {
      // Authenticated but not invited (no user_roles row, or the RPC
      // errored in a way we can't recover from). Sign out + bounce.
      await sb.auth.signOut();
      sessionStorage.setItem('auth_rejection', 'not_invited');
      location.replace('/login.html');
      return;
    }

    window.CURRENT_USER_ROLE = role;
    unhideBody();
  }

  async function signOut() {
    var sb = window.sb;
    if (sb) {
      try { await sb.auth.signOut(); } catch (e) { /* ignore */ }
    }
    location.replace('/login.html');
  }

  window.authGate = authGate;
  window.signOut = signOut;
})();
