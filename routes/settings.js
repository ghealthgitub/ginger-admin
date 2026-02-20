const bcrypt = require('bcryptjs');

module.exports = function(app, pool, { authRequired, apiAuth, roleRequired, logActivity, servePage, rootDir }) {

// ============== SEED ENDPOINT (run once) ==============

// Simple seed page - just visit /seed in browser
app.get('/seed', authRequired, async (req, res) => {
    res.send(`<html><head><title>Seed Database</title><style>body{font-family:sans-serif;display:flex;justify-content:center;align-items:center;height:100vh;margin:0;background:#0B2545;color:#fff;text-align:center}.box{background:#fff;color:#333;padding:40px;border-radius:16px;max-width:500px}h1{color:#F26522}button{background:#F26522;color:#fff;border:none;padding:14px 32px;border-radius:8px;font-size:1rem;cursor:pointer;font-weight:700;margin-top:16px}button:hover{background:#d9531e}#result{margin-top:16px;padding:12px;border-radius:8px;display:none}</style></head><body><div class="box"><h1>🌱 Seed Database</h1><p>This will populate your database with 28 specialties, 23 treatments, 5 destinations, 10 hospitals, 5 doctors, 5 testimonials, and 13 static pages.</p><button onclick="runSeed()">🚀 Seed Now</button><div id="result"></div></div><script>async function runSeed(){const r=document.getElementById('result');r.style.display='block';r.style.background='#FEF3C7';r.textContent='⏳ Seeding... please wait...';try{const res=await fetch('/api/admin/seed',{method:'POST'});const d=await res.json();if(d.success){r.style.background='#D1FAE5';r.innerHTML='✅ '+d.message+'<br><br><a href="/">← Back to Dashboard</a>'}else{r.style.background='#FEE2E2';r.textContent='❌ Error: '+(d.error||'Unknown')}}catch(e){r.style.background='#FEE2E2';r.textContent='❌ '+e}}</script></body></html>`);
});

app.post('/api/admin/seed', apiAuth, roleRequired('super_admin'), async (req, res) => {
    try {
        // Run seed inline
        const { execSync } = require('child_process');
        execSync('node config/seed.js', { cwd: rootDir, env: process.env });
        await logActivity(req.user.id, 'seed', 'database', null, 'Database seeded with initial content');
        res.json({ success: true, message: 'Database seeded successfully!' });
    } catch (err) {
        res.status(500).json({ error: 'Seed failed: ' + err.message });
    }
});


// ============== DATABASE BACKUP ==============
app.get('/api/backup/status', apiAuth, roleRequired('super_admin'), async (req, res) => {
    try {
        const result = await pool.query("SELECT field_value FROM page_content WHERE page='system' AND section='backup' AND field_key='last_backup'");
        res.json({ last_backup: result.rows.length ? result.rows[0].field_value : null });
    } catch(e) { res.json({ last_backup: null }); }
});

app.get('/api/backup/download', apiAuth, roleRequired('super_admin'), async (req, res) => {
    try {
        const tables = [
            'users', 'blog_posts', 'specialties', 'treatments', 'destinations',
            'hospitals', 'doctors', 'testimonials', 'submissions', 'page_content',
            'media', 'activity_log', 'treatment_costs', 'static_pages',
            'hospital_specialties', 'doctor_treatments'
        ];
        const backup = {
            metadata: {
                created_at: new Date().toISOString(),
                created_by: req.user.name,
                version: '1.0',
                tables: tables.length
            }
        };
        for (const table of tables) {
            try {
                const result = await pool.query(`SELECT * FROM ${table} ORDER BY id`);
                backup[table] = {
                    count: result.rows.length,
                    rows: result.rows
                };
            } catch(e) {
                backup[table] = { count: 0, rows: [], error: e.message };
            }
        }
        // Save last backup timestamp
        await pool.query(`
            INSERT INTO page_content (page, section, field_key, field_value, field_type, updated_by)
            VALUES ('system', 'backup', 'last_backup', $1, 'text', $2)
            ON CONFLICT (page, section, field_key)
            DO UPDATE SET field_value = $1, updated_by = $2, updated_at = NOW()
        `, [new Date().toISOString(), req.user.id]);

        const filename = `ginger-backup-${new Date().toISOString().slice(0,10)}.json`;
        res.setHeader('Content-Type', 'application/json');
        res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
        await logActivity(req.user.id, 'download_backup', 'system', null, 'Downloaded full database backup');
        res.json(backup);
    } catch(err) {
        console.error('Backup error:', err.message);
        res.status(500).json({ error: 'Backup failed' });
    }
});

// ============== SETTINGS ==============
app.get('/settings', authRequired, roleRequired('super_admin'), (req, res) => {
    servePage(res, 'settings');
});
app.get('/master-control', authRequired, (req, res) => {
    res.redirect('/');
});

// Settings API - Get all settings
app.get('/api/settings', apiAuth, async (req, res) => {
    try {
        const result = await pool.query("SELECT field_key, field_value FROM page_content WHERE page='site' AND section='settings'");
        res.json(result.rows);
    } catch(e) { res.status(500).json({ error: e.message }); }
});

// Settings API - Save all settings
app.put('/api/settings', apiAuth, async (req, res) => {
    try {
        const settings = req.body;
        for (const [key, value] of Object.entries(settings)) {
            await pool.query(`
                INSERT INTO page_content (page, section, field_key, field_value, field_type, updated_by)
                VALUES ('site', 'settings', $1, $2, 'text', $3)
                ON CONFLICT (page, section, field_key)
                DO UPDATE SET field_value = $2, updated_by = $3, updated_at = NOW()
            `, [key, value, req.user.id]);
        }
        await logActivity(req.user.id, 'update_settings', 'settings', null, 'Updated site settings');
        res.json({ success: true });
    } catch(e) { res.status(500).json({ error: e.message }); }
});

// ============== THEME TEMPLATES ==============
app.get('/theme-templates', authRequired, roleRequired('super_admin'), (req, res) => {
    servePage(res, 'theme-templates');
});

app.get('/api/theme-templates', apiAuth, async (req, res) => {
    try {
        const result = await pool.query('SELECT * FROM theme_templates ORDER BY category, label');
        res.json(result.rows);
    } catch(e) { res.status(500).json({ error: e.message }); }
});

app.get('/api/theme-templates/:key', apiAuth, async (req, res) => {
    try {
        const result = await pool.query('SELECT * FROM theme_templates WHERE template_key=$1', [req.params.key]);
        if (result.rows.length === 0) return res.status(404).json({ error: 'Template not found' });
        res.json(result.rows[0]);
    } catch(e) { res.status(500).json({ error: e.message }); }
});

// Sample data for template preview
app.put('/api/theme-templates/:key', apiAuth, roleRequired('super_admin'), async (req, res) => {
    try {
        const { label, category, description, html_template, css, is_active } = req.body;
        const result = await pool.query(
            `INSERT INTO theme_templates (template_key, label, category, description, html_template, css, is_active, updated_by)
             VALUES ($1,$2,$3,$4,$5,$6,$7,$8)
             ON CONFLICT (template_key) DO UPDATE SET label=$2, category=$3, description=$4, html_template=$5, css=$6, is_active=$7, updated_by=$8, updated_at=NOW()
             RETURNING *`,
            [req.params.key, label, category || 'detail', description, html_template, css, is_active !== false, req.user.id]
        );
        await logActivity(req.user.id, 'update', 'theme_template', result.rows[0].id, `Updated template: ${label}`);
        res.json(result.rows[0]);
    } catch(e) { res.status(500).json({ error: e.message }); }
});

app.delete('/api/theme-templates/:key', apiAuth, roleRequired('super_admin'), async (req, res) => {
    try {
        await pool.query('DELETE FROM theme_templates WHERE template_key=$1', [req.params.key]);
        await logActivity(req.user.id, 'delete', 'theme_template', null, `Deleted template: ${req.params.key}`);
        res.json({ success: true });
    } catch(e) { res.status(500).json({ error: e.message }); }
});

// Public API for website to fetch templates
app.get('/api/public/templates', async (req, res) => {
    res.header('Access-Control-Allow-Origin', '*');
    try {
        const result = await pool.query('SELECT template_key, html_template, css FROM theme_templates WHERE is_active=true');
        const map = {};
        result.rows.forEach(r => { map[r.template_key] = { html: r.html_template, css: r.css }; });
        res.json(map);
    } catch(e) { res.json({}); }
});


};
