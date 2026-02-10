// Ginger Admin - Role-based Sidebar
// Include in every page: <script src="/js/sidebar.js" defer></script>
// Requires: <aside class="sidebar" id="sidebar"></aside> in HTML
// Exposes: window.gingerUser (Promise that resolves with user data)

window.gingerUser = (async function() {
    // Don't run on login page
    if (window.location.pathname === '/login') return null;
    
    const sidebar = document.getElementById('sidebar');

    let user = null;
    for (let attempt = 0; attempt < 3; attempt++) {
        try {
            const r = await fetch('/api/auth/me');
            if (r.ok) { user = await r.json(); break; }
            if (r.status === 429) { await new Promise(ok => setTimeout(ok, 1000 * (attempt + 1))); continue; }
            break;
        } catch(e) {
            if (attempt === 2) break;
            await new Promise(ok => setTimeout(ok, 1000));
        }
    }

    // If no sidebar element, just return user data
    if (!sidebar) return user;

    // If no user, show minimal sidebar with login link
    if (!user) {
        sidebar.innerHTML = `
            <div class="sidebar__logo">
                <div class="sidebar__logo-icon">G</div>
                <div class="sidebar__logo-text"><span>Ginger</span> <span>Admin</span></div>
            </div>
            <nav class="sidebar__nav">
                <a href="/login" class="sidebar__link"><span class="sidebar__link-icon">🔑</span> Login</a>
            </nav>`;
        return null;
    }

    const role = user.role;
    const initials = user.name ? user.name.split(' ').map(n => n[0]).join('').toUpperCase() : 'U';
    const path = window.location.pathname;

    const menu = [
        role === 'super_admin'
            ? { href: '/', icon: '🎛️', label: 'Command Center' }
            : { href: '/', icon: '📊', label: 'Dashboard' },
        { section: 'Content' },
        { href: '/blog', icon: '📝', label: 'Blog Posts', roles: ['super_admin', 'editor'] },
        { href: '/specialties-mgmt', icon: '🏷️', label: 'Specialties', roles: ['super_admin'] },
        { href: '/treatments', icon: '💊', label: 'Treatments', roles: ['super_admin'] },
        { href: '/destinations-mgmt', icon: '🌍', label: 'Destinations', roles: ['super_admin'] },
        { href: '/hospitals', icon: '🏥', label: 'Hospitals', roles: ['super_admin'] },
        { href: '/doctors', icon: '👨‍⚕️', label: 'Doctors', roles: ['super_admin'] },
        { href: '/testimonials', icon: '⭐', label: 'Testimonials', roles: ['super_admin', 'editor'] },
        { section: 'Management', roles: ['super_admin'] },
        { href: '/costs', icon: '💰', label: 'Cost Manager', roles: ['super_admin'] },
        { href: '/submissions', icon: '📋', label: 'Submissions', roles: ['super_admin'] },
        { href: '/static-pages', icon: '📄', label: 'Static Pages', roles: ['super_admin'] },
        { href: '/page-content', icon: '🔧', label: 'Page Content', roles: ['super_admin'] },
        { href: '/media', icon: '🖼️', label: 'Media Library', roles: ['super_admin', 'editor'] },
        { section: 'Tools', roles: ['super_admin'] },
        { href: '/ai-assistant', icon: '🤖', label: 'AI Assistant', roles: ['super_admin'] },
        { href: '/users', icon: '👥', label: 'Users', roles: ['super_admin'] },
        { href: '/settings', icon: '⚙️', label: 'Settings', roles: ['super_admin'] },
    ];

    let navHTML = '';
    menu.forEach(item => {
        if (item.section !== undefined && !item.href) {
            if (item.roles && !item.roles.includes(role)) return;
            if (item.section) navHTML += `<div class="sidebar__section">${item.section}</div>`;
            return;
        }
        if (item.roles && !item.roles.includes(role)) return;
        const isActive = path === item.href || 
            (item.href === '/blog' && path.startsWith('/blog/')) ||
            (item.href === '/' && path === '/');
        const activeClass = isActive ? ' sidebar__link--active' : '';
        navHTML += `<a href="${item.href}" class="sidebar__link${activeClass}"><span class="sidebar__link-icon">${item.icon}</span> ${item.label}</a>`;
    });

    sidebar.innerHTML = `
        <div class="sidebar__logo">
            <div class="sidebar__logo-icon">G</div>
            <div class="sidebar__logo-text"><span>Ginger</span> <span>Admin</span></div>
        </div>
        <nav class="sidebar__nav">${navHTML}</nav>
        <div class="sidebar__footer">
            <div class="sidebar__user">
                <div class="sidebar__user-avatar" id="userAvatar">${initials}</div>
                <div class="sidebar__user-info">
                    <div class="sidebar__user-name" id="userName">${user.name}</div>
                    <div class="sidebar__user-role" id="userRole">${role.replace('_', ' ').toUpperCase()}</div>
                </div>
            </div>
            <a href="/logout" class="sidebar__logout">Logout →</a>
        </div>`;

    return user;
})();
