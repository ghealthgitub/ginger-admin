// Ginger Admin - Role-based Sidebar
// Include in every page: <script src="/js/sidebar.js" defer></script>
// Requires: <aside class="sidebar" id="sidebar"></aside> in HTML
// Exposes: window.gingerUser (Promise that resolves with user data)

window.gingerUser = (async function() {
    // Don't run on login page
    if (window.location.pathname === '/login') return null;
    
    const sidebar = document.getElementById('sidebar');

    let user = null;
    
    // Check if dashboard already loaded user data
    if (window._dashboardUser) {
        user = window._dashboardUser;
    } else {
        // Fetch with retry
        for (let attempt = 0; attempt < 3; attempt++) {
            try {
                const r = await fetch('/api/auth/me');
                if (r.ok) { user = await r.json(); break; }
                if (r.status === 429) { await new Promise(ok => setTimeout(ok, 1500 * (attempt + 1))); continue; }
                break;
            } catch(e) {
                if (attempt === 2) break;
                await new Promise(ok => setTimeout(ok, 1500));
            }
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
        { href: '/specialties-mgmt', icon: '🏷️', label: 'Specialties', roles: ['super_admin', 'editor'] },
        { href: '/treatments', icon: '💊', label: 'Treatments', roles: ['super_admin', 'editor'] },
        { href: '/destinations-mgmt', icon: '🌍', label: 'Destinations', roles: ['super_admin', 'editor'] },
        { href: '/hospitals', icon: '🏥', label: 'Hospitals', roles: ['super_admin', 'editor'] },
        { href: '/doctors', icon: '👨‍⚕️', label: 'Doctors', roles: ['super_admin', 'editor'] },
        { href: '/testimonials', icon: '⭐', label: 'Testimonials', roles: ['super_admin', 'editor'] },
        { section: 'Management', roles: ['super_admin', 'editor'] },
        { href: '/costs', icon: '💰', label: 'Cost Manager', roles: ['super_admin', 'editor'] },
        { href: '/submissions', icon: '📋', label: 'Submissions', roles: ['super_admin'] },
        { href: '/static-pages', icon: '📄', label: 'Static Pages', roles: ['super_admin', 'editor'] },
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
            ${role === 'super_admin' ? '<a id="sidebarBackupBtn" style="display:block;padding:10px 16px;margin:0 12px 8px;border-radius:8px;font-size:.82rem;font-weight:600;cursor:pointer;text-align:center;text-decoration:none;transition:all .2s">💾 Download Backup</a>' : ''}
            <div class="sidebar__user">
                <div class="sidebar__user-avatar" id="userAvatar">${initials}</div>
                <div class="sidebar__user-info">
                    <div class="sidebar__user-name" id="userName">${user.name}</div>
                    <div class="sidebar__user-role" id="userRole">${role.replace('_', ' ').toUpperCase()}</div>
                </div>
            </div>
            <a href="/logout" class="sidebar__logout">Logout →</a>
        </div>`;

    // Smart backup button logic
    if (role === 'super_admin') {
        const bBtn = document.getElementById('sidebarBackupBtn');
        if (bBtn) {
            // Check if backup is due
            function isBackupDue(lastBackup) {
                if (!lastBackup) return true;
                const last = new Date(lastBackup);
                const now = new Date();
                // Build today's 5:00 PM IST (11:30 UTC)
                const todayDeadline = new Date(now);
                todayDeadline.setUTCHours(11, 30, 0, 0);
                // If it's past 5 PM IST and last backup was before today's deadline
                if (now >= todayDeadline && last < todayDeadline) return true;
                // If last backup was before yesterday's deadline
                const yesterdayDeadline = new Date(todayDeadline);
                yesterdayDeadline.setDate(yesterdayDeadline.getDate() - 1);
                if (last < yesterdayDeadline) return true;
                return false;
            }

            function setNormal() {
                bBtn.style.background = 'rgba(14,165,160,.08)';
                bBtn.style.border = '1px solid rgba(14,165,160,.2)';
                bBtn.style.color = 'var(--teal)';
                bBtn.style.animation = 'none';
            }
            function setUrgent() {
                bBtn.style.background = '#FEF3C7';
                bBtn.style.border = '1.5px solid #F59E0B';
                bBtn.style.color = '#92400E';
                bBtn.style.animation = 'backupPulse 2s ease-in-out infinite';
                bBtn.textContent = '⚠️ Backup Due!';
            }

            // Add pulse animation
            if (!document.getElementById('backupPulseStyle')) {
                const style = document.createElement('style');
                style.id = 'backupPulseStyle';
                style.textContent = '@keyframes backupPulse{0%,100%{box-shadow:0 0 0 0 rgba(245,158,11,.3)}50%{box-shadow:0 0 12px 4px rgba(245,158,11,.4)}}';
                document.head.appendChild(style);
            }

            // Check status
            fetch('/api/backup/status').then(r=>r.json()).then(data=>{
                if (isBackupDue(data.last_backup)) { setUrgent(); } else { setNormal(); }
            }).catch(()=>{ setNormal(); });

            // Click handler
            bBtn.onclick = async function() {
                bBtn.textContent = '⏳ Downloading...';
                bBtn.style.animation = 'none';
                try {
                    const r = await fetch('/api/backup/download');
                    const bl = await r.blob();
                    const u = URL.createObjectURL(bl);
                    const a = document.createElement('a');
                    a.href = u;
                    a.download = 'ginger-backup-' + new Date().toISOString().slice(0,10) + '.json';
                    a.click();
                    URL.revokeObjectURL(u);
                    bBtn.textContent = '✅ Backup Complete!';
                    setNormal();
                    bBtn.style.background = '#D1FAE5';
                    bBtn.style.border = '1.5px solid #059669';
                    bBtn.style.color = '#065F46';
                    setTimeout(() => { bBtn.textContent = '💾 Download Backup'; setNormal(); }, 4000);
                } catch(e) {
                    alert('Backup failed');
                    bBtn.textContent = '💾 Download Backup';
                    setNormal();
                }
            };
        }
    }

    return user;
})();
