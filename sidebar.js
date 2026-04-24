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
      label: 'Acquisitions',
      items: [
        { key: 'deals',    label: 'MLS Deals', href: 'mls-deals.html', icon: iconDeals() },
        { key: 'pipeline', label: 'Pipeline',  href: null,             icon: iconPipeline() },
        { key: 'offers',   label: 'Offers',    href: null,             icon: iconOffers() },
        { key: 'showings', label: 'Showings',  href: null,             icon: iconShowings() },
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
        { key: 'comps',       label: 'Comps DB',    href: 'comps-db.html',         icon: iconComps() },
        { key: 'agents',      label: 'Agents',      href: null,                    icon: iconAgents() },
        { key: 'flip-review', label: 'Flip Review', href: 'flip-review.html',      icon: iconFlipReview() },
        { key: 'condition',   label: 'Condition',   href: 'condition-review.html', icon: iconCondition() },
        { key: 'map',         label: 'Map',         href: 'mls-map.html',          icon: iconMap() },
        { key: 'import',      label: 'Import Hub',  href: 'import.html',           icon: iconImport() },
      ],
    },
    {
      label: 'Insights',
      ownerOnly: true,
      items: [
        { key: 'reports', label: 'Reports', href: null, icon: iconReports() },
        { key: 'capital', label: 'Capital', href: null, icon: iconCapital() },
      ],
    },
    {
      label: 'Admin',
      ownerOnly: true,
      items: [
        { key: 'admin', label: 'Users & Settings', href: null, icon: iconAdmin() },
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

    // Chat as a separated row (not in a section).
    html += '<div class="side-section">';
    html += '<div class="side-item disabled"><div class="side-icon">' + iconChat() + '</div><span class="side-label">Chat</span></div>';
    html += '</div>';

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
  function iconOffers()       { return '<svg viewBox="0 0 24 24"><path d="M4 4h16v4H4zM4 12h16v4H4zM4 20h16"/></svg>'; }
  function iconShowings()     { return '<svg viewBox="0 0 24 24"><rect x="3" y="4" width="18" height="18" rx="2"/><line x1="16" y1="2" x2="16" y2="6"/><line x1="8" y1="2" x2="8" y2="6"/><line x1="3" y1="10" x2="21" y2="10"/></svg>'; }
  function iconConstruction() { return '<svg viewBox="0 0 24 24"><path d="M3 21h18M5 21V7l7-4 7 4v14M9 9v12M15 9v12"/></svg>'; }
  function iconListings()     { return '<svg viewBox="0 0 24 24"><path d="M3 9l9-7 9 7v11a2 2 0 01-2 2H5a2 2 0 01-2-2z"/><polyline points="9 22 9 12 15 12 15 22"/></svg>'; }
  function iconComps()        { return '<svg viewBox="0 0 24 24"><ellipse cx="12" cy="5" rx="9" ry="3"/><path d="M21 12c0 1.66-4 3-9 3s-9-1.34-9-3"/><path d="M3 5v14c0 1.66 4 3 9 3s9-1.34 9-3V5"/></svg>'; }
  function iconAgents()       { return '<svg viewBox="0 0 24 24"><path d="M17 21v-2a4 4 0 00-4-4H5a4 4 0 00-4 4v2"/><circle cx="9" cy="7" r="4"/><path d="M23 21v-2a4 4 0 00-3-3.87M16 3.13a4 4 0 010 7.75"/></svg>'; }
  function iconFlipReview()   { return '<svg viewBox="0 0 24 24"><path d="M9 11l3 3L22 4"/><path d="M21 12v7a2 2 0 01-2 2H5a2 2 0 01-2-2V5a2 2 0 012-2h11"/></svg>'; }
  function iconCondition()    { return '<svg viewBox="0 0 24 24"><circle cx="12" cy="12" r="10"/><path d="M12 8v4l3 2"/></svg>'; }
  function iconMap()          { return '<svg viewBox="0 0 24 24"><polygon points="1 6 1 22 8 18 16 22 23 18 23 2 16 6 8 2 1 6"/><line x1="8" y1="2" x2="8" y2="18"/><line x1="16" y1="6" x2="16" y2="22"/></svg>'; }
  function iconImport()       { return '<svg viewBox="0 0 24 24"><path d="M21 15v4a2 2 0 01-2 2H5a2 2 0 01-2-2v-4"/><polyline points="17 8 12 3 7 8"/><line x1="12" y1="3" x2="12" y2="15"/></svg>'; }
  function iconReports()      { return '<svg viewBox="0 0 24 24"><line x1="12" y1="20" x2="12" y2="10"/><line x1="18" y1="20" x2="18" y2="4"/><line x1="6" y1="20" x2="6" y2="16"/></svg>'; }
  function iconCapital()      { return '<svg viewBox="0 0 24 24"><line x1="12" y1="1" x2="12" y2="23"/><path d="M17 5H9.5a3.5 3.5 0 000 7h5a3.5 3.5 0 010 7H6"/></svg>'; }
  function iconAdmin()        { return '<svg viewBox="0 0 24 24"><circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.65 1.65 0 00.33 1.82l.06.06a2 2 0 11-2.83 2.83l-.06-.06a1.65 1.65 0 00-1.82-.33 1.65 1.65 0 00-1 1.51V21a2 2 0 11-4 0v-.09A1.65 1.65 0 009 19.4a1.65 1.65 0 00-1.82.33l-.06.06a2 2 0 11-2.83-2.83l.06-.06a1.65 1.65 0 00.33-1.82 1.65 1.65 0 00-1.51-1H3a2 2 0 110-4h.09A1.65 1.65 0 004.6 9a1.65 1.65 0 00-.33-1.82l-.06-.06a2 2 0 112.83-2.83l.06.06a1.65 1.65 0 001.82.33H9a1.65 1.65 0 001-1.51V3a2 2 0 114 0v.09a1.65 1.65 0 001 1.51 1.65 1.65 0 001.82-.33l.06-.06a2 2 0 112.83 2.83l-.06.06a1.65 1.65 0 00-.33 1.82V9a1.65 1.65 0 001.51 1H21a2 2 0 110 4h-.09a1.65 1.65 0 00-1.51 1z"/></svg>'; }
  function iconChat()         { return '<svg viewBox="0 0 24 24"><path d="M21 15a2 2 0 01-2 2H7l-4 4V5a2 2 0 012-2h14a2 2 0 012 2z"/></svg>'; }

  window.renderSidebar = renderSidebar;
})();
