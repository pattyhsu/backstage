// sidebar.js — shared sectioned-sidebar renderer for every Backstage
// page. login.html does NOT include this (it's the sign-in surface).
//
// Contract:
//   - Page calls window.renderSidebar(activePageKey) AFTER auth.js has
//     populated window.CURRENT_USER_ROLE + window.CURRENT_USER (i.e.
//     after `await window.authGate()` resolves).
//   - Page provides an empty container: <div class="bs-sidebar" id="bsSidebar"></div>.
//   - activePageKey is a string matching one of the NAV entries' keys
//     (e.g. 'deals', 'comps', 'import'). The matching entry gets the
//     'active' class; others don't.
//   - renderSidebar() fills the container with the full sectioned nav
//     + footer widgets (collapse button + sign-out button) + dynamic
//     user display (avatar initial + display name).
//   - Owner-only sections (INSIGHTS + ADMIN) are omitted entirely when
//     window.CURRENT_USER_ROLE !== 'owner'. Not greyed — absent.
//
// No IIFE. The page owns when to render.

(function () {
  const NAV = [
    {
      label: 'Pipeline',
      items: [
        { key: 'pipeline', label: 'Pipeline', href: 'pipeline.html', icon: iconPipeline() },
      ],
    },
    {
      label: 'Acquisitions',
      items: [
        { key: 'deals', label: 'MLS Deals', href: 'mls-deals.html', icon: iconDeals() },
        { key: 'wholesaler', label: 'Wholesaler Deals', href: 'wholesaler-deals.html', icon: iconDeals() },
        { key: 'comps', label: 'Comp Check',  href: 'comps-db.html',  icon: iconComps() },
      ],
    },
    {
      label: 'Projects',
      items: [
        { key: 'construction', label: 'Construction', href: null, icon: iconConstruction() },
        { key: 'listings',     label: 'Listings',     href: null, icon: iconListings() },
      ],
    },
    {
      label: 'Data',
      items: [
        // Condition QA + Import Hub (CSV / Geocode / Schools / Dupes) are one
        // tabbed surface now — a single nav entry (keyed 'data') is active on
        // both condition-review.html and import.html; the in-page top tab strip
        // switches between them. Default landing is the Condition tab.
        { key: 'data', label: 'Condition', href: 'condition-review.html', icon: iconCondition() },
        // Area Insights is its own destination (per-city market writeups),
        // not part of the Condition/Import tab cluster.
        { key: 'areainsights', label: 'Area Insights', href: 'area-insights.html', icon: iconInsights() },
      ],
    },
    {
      label: 'Tools',
      items: [
        { key: 'quote', label: 'Quote', href: 'quote.html', icon: iconQuote() },
        { key: 'reduction', label: 'Reduction Letter', href: 'reduction-letter.html', icon: iconReduction() },
      ],
    },
    {
      label: 'Insights',
      ownerOnly: true,
      items: [
        { key: 'money', label: 'Money', href: 'money.html', icon: iconMoney() },
      ],
    },
    {
      label: 'Corporate Docs',
      ownerOnly: true,
      items: [
        { key: 'corpdocs', label: 'Corporate Docs', href: 'corporate-docs.html', icon: iconCorpDocs() },
      ],
    },
  ];

  function renderSidebar(activeKey) {
    const el = document.getElementById('bsSidebar');
    if (!el) { console.error('[sidebar] bsSidebar container not found'); return; }
    const role = window.CURRENT_USER_ROLE;
    const user = window.CURRENT_USER || {};

    let html = '<div class="side-brand"><div class="side-mark">D</div><span>Backstage</span></div>';

    for (const section of NAV) {
      if (section.ownerOnly && role !== 'owner') continue;
      html += '<div class="side-section">';
      html += '<div class="side-section-label">' + escapeHtml(section.label) + '</div>';
      for (const it of section.items) {
        const isActive = it.key === activeKey;
        const disabled = !it.href;
        const cls = 'side-item' + (isActive ? ' active' : '') + (disabled ? ' disabled' : '');
        if (disabled) {
          html += '<div class="' + cls + '"><div class="side-icon">' + it.icon + '</div><span class="side-label">' + escapeHtml(it.label) + '</span></div>';
        } else {
          html += '<a class="' + cls + '" href="' + it.href + '"><div class="side-icon">' + it.icon + '</div><span class="side-label">' + escapeHtml(it.label) + '</span></a>';
        }
      }
      html += '</div>';
    }

    // Footer: dynamic user + collapse + sign-out.
    // Fallback chain: user_metadata.full_name → user_metadata.name
    // → user_metadata.display_name → user_metadata.preferred_username
    // → top-level user.email prefix → 'User'. Google OAuth populates
    // at least one of the user_metadata.* paths; magic-link-only
    // sign-ins drop through to email prefix.
    const meta = (user && user.user_metadata) || {};
    const displayName = meta.full_name
      || meta.name
      || meta.display_name
      || meta.preferred_username
      || (user && user.email ? user.email.split('@')[0] : 'User');
    const initial = (displayName || 'U').charAt(0).toUpperCase();
    // One-time diagnostic so we can collapse the fallback chain to a
    // single canonical path once we know which one Google OAuth
    // actually populates. Fires only on the first render per session.
    if (!window.__SIDEBAR_USER_DEBUG_LOGGED__) {
      console.log('[sidebar] user shape:', JSON.stringify({
        has_user: !!user,
        email: user && user.email,
        metadata_keys: Object.keys(meta),
        metadata: meta,
      }, null, 2));
      window.__SIDEBAR_USER_DEBUG_LOGGED__ = true;
    }
    html += '<div class="side-footer">';
    html += '  <div class="side-user"><div class="side-avatar">' + escapeHtml(initial) + '</div><span class="side-user-name">' + escapeHtml(displayName) + '</span></div>';
    html += '  <button class="collapse-btn" onclick="document.getElementById(\'bsSidebar\').classList.toggle(\'collapsed\')" title="Collapse">◀</button>';
    html += '  <button class="lock-btn" onclick="signOut()" title="Sign out">';
    html += '    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M9 21H5a2 2 0 01-2-2V5a2 2 0 012-2h4"/><polyline points="16 17 21 12 16 7"/><line x1="21" y1="12" x2="9" y2="12"/></svg>';
    html += '  </button>';
    html += '</div>';

    el.innerHTML = html;
  }

  function escapeHtml(s) {
    return String(s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
  }

  function iconDeals()        { return '<svg viewBox="0 0 24 24"><path d="M22 3H2l8 9.46V19l4 2v-8.54L22 3z"/></svg>'; }
  function iconPipeline()     { return '<svg viewBox="0 0 24 24"><path d="M3 6h18M3 12h18M3 18h18"/></svg>'; }
  function iconCalendar()     { return '<svg viewBox="0 0 24 24"><rect x="3" y="4" width="18" height="18" rx="2"/><line x1="16" y1="2" x2="16" y2="6"/><line x1="8" y1="2" x2="8" y2="6"/><line x1="3" y1="10" x2="21" y2="10"/></svg>'; }
  function iconConstruction() { return '<svg viewBox="0 0 24 24"><path d="M3 21h18M5 21V7l7-4 7 4v14M9 9v12M15 9v12"/></svg>'; }
  function iconListings()     { return '<svg viewBox="0 0 24 24"><path d="M3 9l9-7 9 7v11a2 2 0 01-2 2H5a2 2 0 01-2-2z"/><polyline points="9 22 9 12 15 12 15 22"/></svg>'; }
  function iconComps()        { return '<svg viewBox="0 0 24 24"><ellipse cx="12" cy="5" rx="9" ry="3"/><path d="M21 12c0 1.66-4 3-9 3s-9-1.34-9-3"/><path d="M3 5v14c0 1.66 4 3 9 3s9-1.34 9-3V5"/></svg>'; }
  function iconCondition()    { return '<svg viewBox="0 0 24 24"><circle cx="12" cy="12" r="10"/><path d="M12 8v4l3 2"/></svg>'; }
  function iconInsights()     { return '<svg viewBox="0 0 24 24"><polygon points="1 6 1 22 8 18 16 22 23 18 23 2 16 6 8 2 1 6"/><line x1="8" y1="2" x2="8" y2="18"/><line x1="16" y1="6" x2="16" y2="22"/></svg>'; }
  function iconImport()       { return '<svg viewBox="0 0 24 24"><path d="M21 15v4a2 2 0 01-2 2H5a2 2 0 01-2-2v-4"/><polyline points="17 8 12 3 7 8"/><line x1="12" y1="3" x2="12" y2="15"/></svg>'; }
  function iconMoney()        { return '<svg viewBox="0 0 24 24"><circle cx="12" cy="12" r="10"/><line x1="12" y1="6" x2="12" y2="18"/><path d="M15.5 9H10.25a1.75 1.75 0 000 3.5h3.5a1.75 1.75 0 010 3.5H8.5"/></svg>'; }
  function iconCorpDocs()     { return '<svg viewBox="0 0 24 24"><rect x="2" y="7" width="20" height="14" rx="2"/><path d="M16 21V5a2 2 0 00-2-2h-4a2 2 0 00-2 2v16"/></svg>'; }
  function iconQuote()        { return '<svg viewBox="0 0 24 24"><path d="M14 2H6a2 2 0 00-2 2v16a2 2 0 002 2h12a2 2 0 002-2V8z"/><polyline points="14 2 14 8 20 8"/><line x1="8" y1="13" x2="16" y2="13"/><line x1="8" y1="17" x2="16" y2="17"/><line x1="8" y1="9" x2="10" y2="9"/></svg>'; }
  function iconReduction()    { return '<svg viewBox="0 0 24 24"><path d="M14 2H6a2 2 0 00-2 2v16a2 2 0 002 2h12a2 2 0 002-2V8z"/><polyline points="14 2 14 8 20 8"/><polyline points="16 13 12 17 8 13"/><line x1="12" y1="17" x2="12" y2="10"/></svg>'; }

  window.renderSidebar = renderSidebar;
})();
