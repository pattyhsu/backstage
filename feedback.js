// feedback.js — the 意見箱, ported from the 出題台 to Backstage.
//
// A worker hits a defect while doing real work — a card showing the wrong spend, a
// page that spins, an ARV that reads obviously wrong — and until now had no way to
// say so from inside the tool. This is that channel: one button in the sidebar,
// above the user footer, on every page.
//
// SPLIT GATE (same doctrine as the 出題台's): everyone WRITES, only the owner READS
// the pile. Hiding the Inbox tab from workers is the courtesy half; the boundary is
// RLS on public.feedback — see supabase/migrations/20260901205924_feedback.sql in
// dotty-agents. Backstage talks to PostgREST directly, so there is no server route
// to hide behind: the policies ARE the guard.
//
// Contract:
//   - Page must define window.sb before this loads (every page already does).
//   - sidebar.js calls window.renderFeedback(sidebarEl) after it paints the nav;
//     nothing else needs to know this file exists.
//   - Reads window.CURRENT_USER_ROLE — must run after authGate() resolved.
//
// Self-contained styles: the sidebar CSS is duplicated inline across 17 pages, so
// this injects its own <style> once rather than adding an 18th copy of anything.

(function () {
  var CATEGORIES = [
    { key: 'bug',   label: 'Bug' },
    { key: 'data',  label: 'Wrong data' },
    { key: 'idea',  label: 'Idea' },
    { key: 'other', label: 'Other' },
  ];
  var CAT_LABEL = {};
  CATEGORIES.forEach(function (c) { CAT_LABEL[c.key] = c.label; });

  var state = {
    open: false,
    tab: 'write',
    category: 'bug',
    sending: false,
    openCount: 0,
    openOnly: true,
    items: [],
    loading: false,
  };
  var els = {};

  function esc(s) {
    return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
    });
  }

  function isOwner() { return window.CURRENT_USER_ROLE === 'owner'; }

  // Pathname + query string. Unlike the 出題台 — which strips `search` because its
  // query strings carry student keys — the query string here IS the context: it
  // names the deal or MLS the complaint is about. Shown in the form before sending,
  // never collected silently.
  function currentPage() {
    return (location.pathname + location.search).slice(0, 300);
  }

  // ── styles ────────────────────────────────────────────────────────────────
  function injectStyles() {
    if (document.getElementById('fbStyles')) return;
    var st = document.createElement('style');
    st.id = 'fbStyles';
    st.textContent = [
      '.fb-btn{display:flex;align-items:center;gap:10px;width:calc(100% - 24px);margin:auto 12px 4px;padding:8px 8px;background:none;border:none;border-radius:var(--radius,8px);cursor:pointer;font:inherit;font-size:13px;font-weight:500;color:var(--text-4,#85857E);text-align:left;}',
      '.fb-btn:hover{background:var(--bg-alt,#F2F1EF);color:var(--text-2,#3A3A35);}',
      '.fb-btn svg{width:16px;height:16px;flex:none;fill:none;stroke:currentColor;stroke-width:2;stroke-linecap:round;stroke-linejoin:round;}',
      '.fb-btn .fb-badge{margin-left:auto;min-width:18px;height:18px;padding:0 5px;border-radius:9px;background:var(--accent,#9C7C3C);color:#fff;font-size:11px;font-weight:700;display:flex;align-items:center;justify-content:center;}',
      '.bs-sidebar.collapsed .fb-btn{justify-content:center;width:auto;margin:auto auto 4px;}',
      // The footer claims the sidebar's free space with its own margin-top:auto. Hand
      // that job to the button instead, so the pair sits together at the bottom
      // rather than splitting the gap between them. Higher specificity than the
      // page's inline rule, and injected later, so it wins on both counts.
      '.bs-sidebar .side-footer{margin-top:0;}',
      '.bs-sidebar.collapsed .fb-btn .fb-label,.bs-sidebar.collapsed .fb-btn .fb-badge{display:none;}',

      '.fb-bg{position:fixed;inset:0;z-index:600;background:rgba(0,0,0,.22);backdrop-filter:blur(3px);display:none;align-items:center;justify-content:center;padding:20px;}',
      '.fb-bg.open{display:flex;}',
      '.fb-modal{background:var(--bg,#fff);border:1px solid var(--border,#E2E1DD);border-radius:var(--radius-lg,12px);box-shadow:var(--shadow-lg,0 12px 40px rgba(0,0,0,.10));width:100%;max-width:620px;max-height:86vh;display:flex;flex-direction:column;font-family:var(--sans,system-ui);color:var(--text,#1A1A18);}',
      '.fb-head{display:flex;align-items:center;gap:4px;padding:12px 14px;border-bottom:1px solid var(--border,#E2E1DD);}',
      '.fb-tab{background:none;border:none;cursor:pointer;font:inherit;font-size:14px;font-weight:600;color:var(--text-4,#85857E);padding:6px 10px;border-radius:var(--radius-sm,5px);}',
      '.fb-tab:hover{color:var(--text-2,#3A3A35);}',
      '.fb-tab.on{color:var(--text,#1A1A18);background:var(--bg-alt,#F2F1EF);}',
      '.fb-x{margin-left:auto;background:var(--bg-page,#F8F8F7);border:1px solid var(--border,#E2E1DD);border-radius:var(--radius,8px);width:28px;height:28px;cursor:pointer;color:var(--text-3,#5C5C55);font-size:14px;line-height:1;}',
      '.fb-body{padding:16px;overflow-y:auto;}',
      '.fb-chips{display:flex;gap:8px;flex-wrap:wrap;margin-bottom:12px;}',
      '.fb-chip{background:var(--bg-page,#F8F8F7);border:1px solid var(--border,#E2E1DD);border-radius:999px;padding:5px 13px;font:inherit;font-size:13px;font-weight:500;color:var(--text-3,#5C5C55);cursor:pointer;}',
      '.fb-chip.on{border-color:var(--accent,#9C7C3C);background:var(--accent-dim,rgba(156,124,60,.06));color:var(--accent,#9C7C3C);}',
      '.fb-ta{width:100%;min-height:150px;resize:vertical;padding:11px 12px;border:1px solid var(--border,#E2E1DD);border-radius:var(--radius,8px);font:inherit;font-size:14px;line-height:1.5;color:var(--text,#1A1A18);background:var(--bg,#fff);}',
      '.fb-ta:focus{outline:none;border-color:var(--accent,#9C7C3C);}',
      '.fb-meta{margin-top:9px;font-size:12px;color:var(--text-4,#85857E);}',
      '.fb-meta code{font-family:var(--mono,monospace);font-size:11px;background:var(--bg-alt,#F2F1EF);padding:2px 5px;border-radius:4px;word-break:break-all;}',
      '.fb-err{margin-top:9px;font-size:13px;color:var(--red,#C0392B);}',
      '.fb-actions{display:flex;align-items:center;gap:10px;margin-top:14px;}',
      '.fb-count{font-size:12px;color:var(--text-4,#85857E);margin-right:auto;}',
      '.fb-send{background:var(--accent,#9C7C3C);color:#fff;border:none;border-radius:var(--radius,8px);padding:9px 20px;font:inherit;font-size:14px;font-weight:600;cursor:pointer;}',
      '.fb-send:hover:not(:disabled){background:var(--accent-hover,#B08E48);}',
      '.fb-send:disabled{opacity:.45;cursor:default;}',
      '.fb-ghost{background:var(--bg-page,#F8F8F7);border:1px solid var(--border,#E2E1DD);border-radius:var(--radius,8px);padding:6px 13px;font:inherit;font-size:13px;font-weight:500;color:var(--text-2,#3A3A35);cursor:pointer;}',
      '.fb-ghost:hover{border-color:var(--border-hover,#CCCBC6);}',
      '.fb-thanks{text-align:center;padding:26px 10px;}',
      '.fb-thanks strong{display:block;font-size:16px;margin-bottom:5px;}',
      '.fb-thanks p{font-size:13px;color:var(--text-3,#5C5C55);margin-bottom:16px;}',

      '.fb-filter{display:flex;align-items:center;gap:7px;font-size:13px;color:var(--text-3,#5C5C55);margin-bottom:12px;cursor:pointer;}',
      '.fb-empty{font-size:13px;color:var(--text-4,#85857E);padding:22px 0;text-align:center;}',
      '.fb-list{list-style:none;display:flex;flex-direction:column;gap:10px;}',
      '.fb-item{border:1px solid var(--border,#E2E1DD);border-radius:var(--radius,8px);padding:11px 12px;}',
      '.fb-item.done{opacity:.55;}',
      '.fb-rowhead{display:flex;align-items:center;gap:8px;flex-wrap:wrap;font-size:12px;color:var(--text-4,#85857E);margin-bottom:6px;}',
      '.fb-cat{background:var(--bg-inset,#EBEAE7);color:var(--text-2,#3A3A35);border-radius:4px;padding:2px 7px;font-size:11px;font-weight:600;}',
      '.fb-who{font-weight:600;color:var(--text-2,#3A3A35);font-size:12px;}',
      '.fb-page{font-family:var(--mono,monospace);font-size:11px;background:var(--bg-alt,#F2F1EF);padding:2px 5px;border-radius:4px;max-width:100%;word-break:break-all;}',
      '.fb-rowhead .fb-ghost{margin-left:auto;padding:3px 10px;font-size:12px;}',
      '.fb-text{font-size:14px;line-height:1.55;color:var(--text,#1A1A18);white-space:pre-wrap;}',
    ].join('\n');
    document.head.appendChild(st);
  }

  // ── data ──────────────────────────────────────────────────────────────────
  // The badge: unresolved rows the caller is allowed to see. Owner-only by
  // policy AND by call site — a worker's own count is not news to them.
  async function refreshBadge() {
    if (!isOwner() || !window.sb) return;
    var r = await window.sb.from('feedback')
      .select('id', { count: 'exact', head: true })
      .is('resolved_at', null);
    if (r.error) return; // a badge that fails to load is not worth an error
    state.openCount = r.count || 0;
    paintButton();
    if (els.tabInbox) els.tabInbox.textContent = 'Inbox' + (state.openCount ? ' (' + state.openCount + ')' : '');
  }

  async function loadInbox() {
    if (!isOwner() || !window.sb) return;
    state.loading = true; paintBody();
    var q = window.sb.from('feedback')
      .select('id,created_at,author_email,author_role,page,category,body,resolved_at')
      .order('created_at', { ascending: false })
      .limit(200);
    if (state.openOnly) q = q.is('resolved_at', null);
    var r = await q;
    state.items = r.error ? [] : (r.data || []);
    state.loading = false;
    paintBody();
  }

  async function submit() {
    var text = (els.ta.value || '').trim();
    if (!text || state.sending) return;
    state.sending = true; paintBody();
    // Only these three columns travel. author / author_email / author_role are
    // stamped by a BEFORE INSERT trigger from the session — the client cannot
    // claim provenance it doesn't have.
    var r = await window.sb.from('feedback')
      .insert({ category: state.category, body: text, page: currentPage() })
      .select('id').single();
    state.sending = false;
    if (r.error) {
      state.err = 'Could not send — try again.';
      console.error('[feedback] insert failed', r.error);
      paintBody();
      return;
    }
    state.err = null;
    state.draft = '';   // cleared only on success — a failed send keeps their words
    state.sent = true;
    paintBody();
    refreshBadge();
  }

  async function toggleResolved(it) {
    var undo = !!it.resolved_at;
    var patch = undo
      ? { resolved_at: null, resolved_by: null }
      : { resolved_at: new Date().toISOString(), resolved_by: (window.CURRENT_USER || {}).id || null };
    var r = await window.sb.from('feedback').update(patch).eq('id', it.id)
      .select('id,resolved_at').single();
    if (r.error) { console.error('[feedback] resolve failed', r.error); return; }
    if (state.openOnly && !undo) {
      state.items = state.items.filter(function (p) { return p.id !== it.id; });
    } else {
      it.resolved_at = r.data.resolved_at;
    }
    paintBody();
    refreshBadge();
  }

  // ── paint ─────────────────────────────────────────────────────────────────
  function paintButton() {
    if (!els.btn) return;
    els.btn.innerHTML =
      '<svg viewBox="0 0 24 24"><path d="M21 15a2 2 0 01-2 2H7l-4 4V5a2 2 0 012-2h14a2 2 0 012 2z"/></svg>' +
      '<span class="fb-label">Feedback</span>' +
      (isOwner() && state.openCount > 0 ? '<span class="fb-badge">' + state.openCount + '</span>' : '');
  }

  function fmtDate(iso) {
    try {
      return new Date(iso).toLocaleString('en-US', {
        month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit',
      });
    } catch (e) { return iso; }
  }

  function paintBody() {
    var b = els.body;
    if (!b) return;

    if (state.tab === 'write') {
      if (state.sent) {
        b.innerHTML =
          '<div class="fb-thanks"><strong>Got it — thanks.</strong>' +
          '<p>Write it down the moment you see it. No need to save it up.</p>' +
          '<button type="button" class="fb-ghost" id="fbAgain">Write another</button></div>';
        b.querySelector('#fbAgain').onclick = function () {
          state.sent = false; paintBody();
        };
        return;
      }
      var chips = CATEGORIES.map(function (c) {
        return '<button type="button" class="fb-chip' + (state.category === c.key ? ' on' : '') +
          '" data-cat="' + c.key + '">' + esc(c.label) + '</button>';
      }).join('');
      var draft = state.draft || '';
      b.innerHTML =
        '<div class="fb-chips">' + chips + '</div>' +
        '<textarea class="fb-ta" id="fbTa" maxlength="2000" placeholder="What looked wrong? What were you doing when it happened?">' + esc(draft) + '</textarea>' +
        // Shown, not hidden: nobody should be surprised by what rides along.
        '<div class="fb-meta">Sent with this note: <code>' + esc(currentPage()) + '</code></div>' +
        (state.err ? '<div class="fb-err">' + esc(state.err) + '</div>' : '') +
        '<div class="fb-actions"><span class="fb-count" id="fbCount">' + draft.length + ' / 2000</span>' +
        '<button type="button" class="fb-send" id="fbSend"' + (state.sending || !draft.trim() ? ' disabled' : '') + '>' +
        (state.sending ? 'Sending…' : 'Send') + '</button></div>';

      els.ta = b.querySelector('#fbTa');
      b.querySelectorAll('.fb-chip').forEach(function (el) {
        el.onclick = function () { state.category = el.getAttribute('data-cat'); state.draft = els.ta.value; paintBody(); };
      });
      els.ta.oninput = function () {
        state.draft = els.ta.value;
        b.querySelector('#fbCount').textContent = els.ta.value.length + ' / 2000';
        b.querySelector('#fbSend').disabled = !els.ta.value.trim() || state.sending;
      };
      b.querySelector('#fbSend').onclick = function () { submit(); };
      els.ta.focus();
      return;
    }

    // Inbox
    var head = '<label class="fb-filter"><input type="checkbox" id="fbOpenOnly"' +
      (state.openOnly ? ' checked' : '') + '> Only unresolved</label>';
    var list;
    if (state.loading) {
      list = '<p class="fb-empty">Loading…</p>';
    } else if (!state.items.length) {
      list = '<p class="fb-empty">' + (state.openOnly ? 'Nothing unresolved.' : 'No feedback yet.') + '</p>';
    } else {
      list = '<ul class="fb-list">' + state.items.map(function (it, i) {
        return '<li class="fb-item' + (it.resolved_at ? ' done' : '') + '">' +
          '<div class="fb-rowhead">' +
            '<span class="fb-cat">' + esc(CAT_LABEL[it.category] || it.category) + '</span>' +
            '<span class="fb-who">' + esc(it.author_email || 'unknown') + '</span>' +
            '<span>' + esc(it.author_role) + '</span>' +
            '<span>' + esc(fmtDate(it.created_at)) + '</span>' +
            (it.page ? '<code class="fb-page">' + esc(it.page) + '</code>' : '') +
            '<button type="button" class="fb-ghost" data-i="' + i + '">' +
              (it.resolved_at ? 'Reopen' : 'Resolve') + '</button>' +
          '</div>' +
          '<p class="fb-text">' + esc(it.body) + '</p>' +
        '</li>';
      }).join('') + '</ul>';
    }
    b.innerHTML = head + list;
    b.querySelector('#fbOpenOnly').onchange = function (e) {
      state.openOnly = e.target.checked; loadInbox();
    };
    b.querySelectorAll('.fb-list .fb-ghost').forEach(function (el) {
      el.onclick = function () { toggleResolved(state.items[+el.getAttribute('data-i')]); };
    });
  }

  function ensureModal() {
    if (els.bg) return;
    var bg = document.createElement('div');
    bg.className = 'fb-bg';
    bg.innerHTML =
      '<div class="fb-modal" role="dialog" aria-modal="true" aria-label="Feedback">' +
        '<div class="fb-head">' +
          '<button type="button" class="fb-tab on" id="fbTabWrite">Write</button>' +
          (isOwner() ? '<button type="button" class="fb-tab" id="fbTabInbox">Inbox</button>' : '') +
          '<button type="button" class="fb-x" id="fbClose" aria-label="Close">✕</button>' +
        '</div>' +
        '<div class="fb-body" id="fbBody"></div>' +
      '</div>';
    document.body.appendChild(bg);
    els.bg = bg;
    els.body = bg.querySelector('#fbBody');
    els.tabWrite = bg.querySelector('#fbTabWrite');
    els.tabInbox = bg.querySelector('#fbTabInbox');
    bg.querySelector('#fbClose').onclick = close;
    bg.onmousedown = function (e) { if (e.target === bg) close(); };
    els.tabWrite.onclick = function () { setTab('write'); };
    if (els.tabInbox) els.tabInbox.onclick = function () { setTab('inbox'); };
    document.addEventListener('keydown', function (e) {
      if (e.key === 'Escape' && state.open) close();
    });
  }

  function setTab(t) {
    state.tab = t;
    els.tabWrite.classList.toggle('on', t === 'write');
    if (els.tabInbox) els.tabInbox.classList.toggle('on', t === 'inbox');
    if (t === 'inbox') loadInbox(); else paintBody();
  }

  function open() {
    ensureModal();
    state.open = true;
    state.sent = false;
    state.err = null;
    els.bg.classList.add('open');
    setTab('write');
  }

  function close() {
    state.open = false;
    if (els.bg) els.bg.classList.remove('open');
  }

  /** Mount point — called by sidebar.js right after it paints the nav. */
  function renderFeedback(sidebarEl) {
    injectStyles();
    var footer = sidebarEl.querySelector('.side-footer');
    var btn = document.createElement('button');
    btn.type = 'button';
    btn.className = 'fb-btn';
    btn.title = 'Report a problem or suggest something';
    btn.onclick = open;
    if (footer) sidebarEl.insertBefore(btn, footer); else sidebarEl.appendChild(btn);
    els.btn = btn;
    paintButton();
    refreshBadge();
  }

  window.renderFeedback = renderFeedback;
})();
