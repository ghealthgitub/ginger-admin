module.exports = function(app, pool, { authRequired, apiAuth, roleRequired, logActivity, servePage }) {

// ============== MAINTENANCE MODE ==============
// Get maintenance status (public - called by website)
app.get('/api/public/maintenance', async (req, res) => {
    try {
        // Set CORS headers so the website can call this
        res.header('Access-Control-Allow-Origin', '*');
        const result = await pool.query("SELECT field_value FROM page_content WHERE page='site' AND section='settings' AND field_key='maintenance_mode'");
        const isEnabled = result.rows.length > 0 && result.rows[0].field_value === 'true';
        res.json({ maintenance: isEnabled });
    } catch (err) {
        res.json({ maintenance: false });
    }
});

// Toggle maintenance mode (admin only)
app.put('/api/maintenance/toggle', apiAuth, roleRequired('super_admin'), async (req, res) => {
    try {
        const { enabled } = req.body;
        await pool.query(
            `INSERT INTO page_content (page, section, field_key, field_value, field_type, updated_by)
             VALUES ('site','settings','maintenance_mode',$1,'text',$2)
             ON CONFLICT (page, section, field_key) DO UPDATE SET field_value=$1, updated_by=$2, updated_at=NOW()`,
            [enabled ? 'true' : 'false', req.user.id]
        );
        await logActivity(req.user.id, enabled ? 'enable' : 'disable', 'maintenance', null, 'Maintenance mode ' + (enabled ? 'ON' : 'OFF'));
        res.json({ success: true, maintenance: enabled });
    } catch (err) { res.status(500).json({ error: err.message }); }
});

// Get maintenance status (admin)
app.get('/api/maintenance/status', apiAuth, async (req, res) => {
    try {
        const result = await pool.query("SELECT field_value FROM page_content WHERE page='site' AND section='settings' AND field_key='maintenance_mode'");
        const isEnabled = result.rows.length > 0 && result.rows[0].field_value === 'true';
        res.json({ maintenance: isEnabled });
    } catch (err) { res.json({ maintenance: false }); }
});

// ============== PAGE CONTENT ==============
app.get('/page-content', authRequired, roleRequired('super_admin', 'editor'), (req, res) => {
    servePage(res, 'page-content');
});

app.get('/api/page-content', apiAuth, async (req, res) => {
    try {
        const { page } = req.query;
        const query = page ? 'SELECT * FROM page_content WHERE page = $1 ORDER BY section, field_key' : 'SELECT * FROM page_content ORDER BY page, section, field_key';
        const result = await pool.query(query, page ? [page] : []);
        res.json(result.rows);
    } catch (err) { res.status(500).json({ error: 'Server error' }); }
});

app.put('/api/page-content', apiAuth, roleRequired('super_admin', 'editor'), async (req, res) => {
    try {
        const { page, section, field_key, field_value, field_type } = req.body;
        const result = await pool.query(
            `INSERT INTO page_content (page, section, field_key, field_value, field_type, updated_by)
             VALUES ($1,$2,$3,$4,$5,$6)
             ON CONFLICT (page, section, field_key) DO UPDATE SET field_value=$4, field_type=$5, updated_by=$6, updated_at=NOW()
             RETURNING *`,
            [page, section, field_key, field_value, field_type || 'text', req.user.id]
        );
        await logActivity(req.user.id, 'update', 'page_content', result.rows[0].id, `${page}/${section}/${field_key}`);
        res.json(result.rows[0]);
    } catch (err) { res.status(500).json({ error: err.message }); }
});


// ============== STATIC PAGES CRUD ==============
app.get('/static-pages', authRequired, (req, res) => {
    servePage(res, 'static-pages');
});

app.get('/api/static-pages', apiAuth, async (req, res) => {
    try {
        const result = await pool.query('SELECT * FROM static_pages ORDER BY page_type, title');
        res.json(result.rows);
    } catch (err) { res.status(500).json({ error: 'Server error' }); }
});

app.get('/api/static-pages/:id', apiAuth, async (req, res) => {
    try {
        const result = await pool.query('SELECT * FROM static_pages WHERE id = $1', [req.params.id]);
        if (result.rows.length === 0) return res.status(404).json({ error: 'Not found' });
        res.json(result.rows[0]);
    } catch (err) { res.status(500).json({ error: 'Server error' }); }
});

app.put('/api/static-pages/:id', apiAuth, roleRequired('super_admin', 'editor'), async (req, res) => {
    try {
        const { title, hero_title, hero_description, content, meta_title, meta_description, status } = req.body;
        const result = await pool.query(
            `UPDATE static_pages SET title=$1, hero_title=$2, hero_description=$3, content=$4, meta_title=$5, meta_description=$6, status=$7, updated_by=$8, updated_at=NOW()
             WHERE id=$9 RETURNING *`,
            [title, hero_title, hero_description, content, meta_title, meta_description, status, req.user.id, req.params.id]
        );
        await logActivity(req.user.id, 'update', 'static_page', req.params.id, `Updated: ${title}`);
        res.json(result.rows[0]);
    } catch (err) { res.status(500).json({ error: err.message }); }
});


};
