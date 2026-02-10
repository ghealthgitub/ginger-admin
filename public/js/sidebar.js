// Ginger Admin - Role-based Sidebar
// Include in every page: <script src="/js/sidebar.js"></script>
// Requires: <aside class="sidebar" id="sidebar"></aside> in HTML

(async function() {
    let user = { name: 'Admin', role: 'editor', email: '' };
    try {
        const r = await fetch('/api/auth/me');
        if (!r.ok) { window.location.href = '/login'; return; }
        user = await r.json();
    } catch(e) { window.location.href = '/login'; return; }

    const role = user.role;
    const isSuperAdmin = role === 'super_admin';
    const isEditor = role === 'editor';
    const isViewer = role === 'viewer';
    const initials = user.name.split(' ').map(n => n[0]).join('').toUpperCase();
    const path = window.location.pathname;

    // Define menu items with role access
    const menu = [
        // Top link
        isSuperAdmin
            ? { href: '/master-control', icon: '🎛️', label: 'Command Center', section: null }
            : { href: '/', icon: '📊', label: 'Dashboard', section: null },

        // Content section
        { section: 'Content' },
        { href: '/blog', icon: '📝', label: 'Blog Posts', roles: ['super_admin', 'editor'] },
        { href: '/specialties-mgmt', icon: '🏷️', label: 'Specialties', roles: ['super_admin'] },
        { href: '/treatments', icon: '💊', label: 'Treatments', roles: ['super_admin'] },
        { href: '/destinations-mgmt', icon: '🌍', label: 'Destinations', roles: ['super_admin'] },
        { href: '/hospitals', icon: '🏥', label: 'Hospitals', roles: ['super_admin'] },
        { href: '/doctors', icon: '👨‍⚕️', label: 'Doctors', roles: ['super_admin'] },
        { href: '/testimonials', icon: '⭐', label: 'Testimonials', roles: ['super_admin', 'editor'] },

        // Management section
        { section: 'Management', roles: ['super_admin'] },
        { href: '/costs', icon: '💰', label: 'Cost Manager', roles: ['super_admin'] },
        { href: '/submissions', icon: '📋', label: 'Submissions', roles: ['super_admin'] },
        { href: '/static-pages', icon: '📄', label: 'Static Pages', roles: ['super_admin'] },
        { href: '/page-content', icon: '🔧', label: 'Page Content', roles: ['super_admin'] },
        { href: '/media', icon: '🖼️', label: 'Media Library', roles: ['super_admin', 'editor'] },

        // Tools section
        { section: 'Tools', roles: ['super_admin'] },
        { href: '/ai-assistant', icon: '🤖', label: 'AI Assistant', roles: ['super_admin'] },
        { href: '/users', icon: '👥', label: 'Users', roles: ['super_admin'] },
        { href: '/settings', icon: '⚙️', label: 'Settings', roles: ['super_admin'] },
    ];

    // Build sidebar HTML
    let navHTML = '';
    menu.forEach(item => {
        // Section header
        if (item.section !== undefined && !item.href) {
            if (item.roles && !item.roles.includes(role)) return;
            if (item.section) navHTML += `<div class="sidebar__section">${item.section}</div>`;
            return;
        }
        // Check role access
        if (item.roles && !item.roles.includes(role)) return;
        // Active state
        const isActive = path === item.href || 
            (item.href === '/blog' && path.startsWith('/blog/')) ||
            (item.href === '/master-control' && path === '/master-control');
        const activeClass = isActive ? ' sidebar__link--active' : '';
        navHTML += `<a href="${item.href}" class="sidebar__link${activeClass}"><span class="sidebar__link-icon">${item.icon}</span> ${item.label}</a>`;
    });

    const sidebar = document.getElementById('sidebar');
    if (!sidebar) return;

    sidebar.innerHTML = `
        <div class="sidebar__logo">
            <div class="sidebar__logo-icon">G</div>
            <div class="sidebar__logo-text"><span>Ginger</span> <span>Admin</span></div>
        </div>
        <nav class="sidebar__nav">${navHTML}</nav>
        <div class="sidebar__footer">
            <div class="sidebar__user">
                <div class="sidebar__user-avatar">${initials}</div>
                <div class="sidebar__user-info">
                    <div class="sidebar__user-name">${user.name}</div>
                    <div class="sidebar__user-role">${role.replace('_', ' ').toUpperCase()}</div>
                </div>
            </div>
            <a href="/logout" class="sidebar__logout">Logout →</a>
        </div>`;

    // Also update any page elements that show user info
    const nameEl = document.getElementById('userName');
    const roleEl = document.getElementById('userRole');
    const avatarEl = document.getElementById('userAvatar');
    if (nameEl) nameEl.textContent = user.name;
    if (roleEl) roleEl.textContent = role.replace('_', ' ').toUpperCase();
    if (avatarEl) avatarEl.textContent = initials;
})();
