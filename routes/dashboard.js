module.exports = function(app, pool, { authRequired, apiAuth, roleRequired, logActivity, servePage }) {

// ============== DASHBOARD ==============
app.get('/', authRequired, (req, res) => {
    servePage(res, 'unified-dashboard');
});

// COMBINED init endpoint - returns everything the dashboard needs in ONE call
app.get('/api/dashboard/init', apiAuth, async (req, res) => {
    try {
        const userId = req.user.id;
        const [userResult, posts, testimonials, hospitals, doctors, submissions, newSubs, settings] = await Promise.all([
            pool.query('SELECT id, name, email, role, avatar, last_login FROM users WHERE id = $1', [userId]),
            pool.query("SELECT COUNT(*) FROM blog_posts"),
            pool.query("SELECT COUNT(*) FROM testimonials"),
            pool.query("SELECT COUNT(*) FROM hospitals"),
            pool.query("SELECT COUNT(*) FROM doctors"),
            pool.query("SELECT COUNT(*) FROM submissions"),
            pool.query("SELECT COUNT(*) FROM submissions WHERE status = 'new'"),
            pool.query("SELECT * FROM page_content WHERE page = 'master'")
        ]);
        res.json({
            user: userResult.rows[0],
            stats: {
                blog_posts: parseInt(posts.rows[0].count),
                testimonials: parseInt(testimonials.rows[0].count),
                hospitals: parseInt(hospitals.rows[0].count),
                doctors: parseInt(doctors.rows[0].count),
                total_submissions: parseInt(submissions.rows[0].count),
                new_submissions: parseInt(newSubs.rows[0].count)
            },
            settings: settings.rows
        });
    } catch (err) {
        console.error('Dashboard init error:', err.message);
        res.status(500).json({ error: 'Server error' });
    }
});

// Dashboard stats API
app.get('/api/dashboard/stats', apiAuth, async (req, res) => {
    try {
        const [posts, testimonials, hospitals, doctors, submissions, newSubs] = await Promise.all([
            pool.query("SELECT COUNT(*) FROM blog_posts"),
            pool.query("SELECT COUNT(*) FROM testimonials"),
            pool.query("SELECT COUNT(*) FROM hospitals"),
            pool.query("SELECT COUNT(*) FROM doctors"),
            pool.query("SELECT COUNT(*) FROM submissions"),
            pool.query("SELECT COUNT(*) FROM submissions WHERE status = 'new'")
        ]);
        res.json({
            blog_posts: parseInt(posts.rows[0].count),
            testimonials: parseInt(testimonials.rows[0].count),
            hospitals: parseInt(hospitals.rows[0].count),
            doctors: parseInt(doctors.rows[0].count),
            total_submissions: parseInt(submissions.rows[0].count),
            new_submissions: parseInt(newSubs.rows[0].count)
        });
    } catch (err) {
        res.status(500).json({ error: 'Server error' });
    }
});

// Recent activity
app.get('/api/dashboard/activity', apiAuth, async (req, res) => {
    try {
        const { page = 1, limit = 50, user_id, action, entity_type } = req.query;
        const offset = (page - 1) * limit;
        let where = [];
        let params = [];
        let i = 1;
        if (user_id) { where.push(`al.user_id = $${i++}`); params.push(user_id); }
        if (action) { where.push(`al.action = $${i++}`); params.push(action); }
        if (entity_type) { where.push(`al.entity_type = $${i++}`); params.push(entity_type); }
        const whereClause = where.length ? 'WHERE ' + where.join(' AND ') : '';
        const countResult = await pool.query(`SELECT COUNT(*) FROM activity_log al ${whereClause}`, params);
        const total = parseInt(countResult.rows[0].count);
        params.push(limit, offset);
        const result = await pool.query(
            `SELECT al.*, u.name as user_name, u.email as user_email, u.role as user_role FROM activity_log al
             LEFT JOIN users u ON al.user_id = u.id
             ${whereClause}
             ORDER BY al.created_at DESC LIMIT $${i++} OFFSET $${i++}`,
            params
        );
        res.json({ activities: result.rows, total, page: parseInt(page), pages: Math.ceil(total / limit) });
    } catch (err) {
        res.status(500).json({ error: 'Server error' });
    }
});


// ============== UPDATED DASHBOARD STATS ==============
// Override the original stats route with expanded version
app.get('/api/dashboard/stats-full', apiAuth, async (req, res) => {
    try {
        const [posts, testimonials, hospitals, doctors, submissions, newSubs, specialties, treatments, destinations, costs, pages] = await Promise.all([
            pool.query("SELECT COUNT(*) FROM blog_posts"),
            pool.query("SELECT COUNT(*) FROM testimonials"),
            pool.query("SELECT COUNT(*) FROM hospitals"),
            pool.query("SELECT COUNT(*) FROM doctors"),
            pool.query("SELECT COUNT(*) FROM submissions"),
            pool.query("SELECT COUNT(*) FROM submissions WHERE status = 'new'"),
            pool.query("SELECT COUNT(*) FROM specialties"),
            pool.query("SELECT COUNT(*) FROM treatments"),
            pool.query("SELECT COUNT(*) FROM destinations"),
            pool.query("SELECT COUNT(*) FROM treatment_costs"),
            pool.query("SELECT COUNT(*) FROM static_pages"),
        ]);
        res.json({
            blog_posts: parseInt(posts.rows[0].count),
            testimonials: parseInt(testimonials.rows[0].count),
            hospitals: parseInt(hospitals.rows[0].count),
            doctors: parseInt(doctors.rows[0].count),
            total_submissions: parseInt(submissions.rows[0].count),
            new_submissions: parseInt(newSubs.rows[0].count),
            specialties: parseInt(specialties.rows[0].count),
            treatments: parseInt(treatments.rows[0].count),
            destinations: parseInt(destinations.rows[0].count),
            treatment_costs: parseInt(costs.rows[0].count),
            static_pages: parseInt(pages.rows[0].count),
        });
    } catch (err) { res.status(500).json({ error: 'Server error' }); }
});


};
