module.exports = function(app, pool, { authRequired, apiAuth, roleRequired, logActivity, servePage, serveStudio }) {

// ─── CPT CONFIG ───────────────────────────────────────────────
const DESTINATION_CONFIG = {
    cpt: 'destination',
    label: 'Destination',
    api: '/api/destinations',
    editBase: '/destinations/edit/',
    listUrl: '/destinations',
    viewBase: 'https://ginger.healthcare/destinations/',
    placeholder: 'Country name...',
    permalinkPrefix: 'ginger.healthcare/destinations/',
    fieldRows: [
        [
            { id: 'flag',          label: 'Flag',           type: 'emoji', placeholder: '🇮🇳'                        },
            { id: 'tagline',       label: 'Tagline',        type: 'text',  placeholder: 'e.g. World-class care at 70% less cost', flex: 1 },
            { id: 'avg_savings',   label: 'Avg Savings',    type: 'text',  placeholder: 'e.g. 70%',    width: '80px'  }
        ],
        [
            { id: 'hospital_count', label: 'Hospitals',     type: 'number', default: 0, width: '80px'  },
            { id: 'doctor_count',   label: 'Doctors',       type: 'number', default: 0, width: '80px'  },
            { id: 'language',       label: 'Language',      type: 'text',  placeholder: 'e.g. Hindi, English', width: '160px' },
            { id: 'currency',       label: 'Currency',      type: 'text',  placeholder: 'e.g. INR',    width: '80px'  },
            { id: 'description',    label: 'Short Description', type: 'text', placeholder: 'Brief overview...', flex: 1 }
        ]
    ]
};

// ─── LEGACY REDIRECT ──────────────────────────────────────────
app.get('/destinations-mgmt', authRequired, (req, res) => {
    res.redirect(301, '/destinations');
});

// ─── STUDIO ROUTES ────────────────────────────────────────────
app.get('/destinations/new', authRequired, roleRequired('super_admin', 'editor'), (req, res) => {
    serveStudio(res, DESTINATION_CONFIG);
});
app.get('/destinations/edit/:id', authRequired, roleRequired('super_admin', 'editor'), (req, res) => {
    serveStudio(res, DESTINATION_CONFIG);
});

// ─── LISTING ──────────────────────────────────────────────────
app.get('/destinations', authRequired, (req, res) => {
    servePage(res, 'destinations');
});

// ─── API ──────────────────────────────────────────────────────
app.get('/api/destinations', apiAuth, async (req, res) => {
    try {
        const result = await pool.query('SELECT * FROM destinations ORDER BY display_order ASC, name ASC');
        res.json(result.rows);
    } catch (err) { res.status(500).json({ error: 'Server error' }); }
});

app.get('/api/destinations/:id', apiAuth, async (req, res) => {
    try {
        const result = await pool.query('SELECT * FROM destinations WHERE id=$1', [req.params.id]);
        if (result.rows.length === 0) return res.status(404).json({ error: 'Not found' });
        res.json(result.rows[0]);
    } catch (err) { res.status(500).json({ error: err.message }); }
});

app.post('/api/destinations', apiAuth, roleRequired('super_admin', 'editor'), async (req, res) => {
    try {
        const { name, slug, flag, tagline, description, long_description, why_choose,
                image, avg_savings, hospital_count, doctor_count, language, currency,
                visa_info, travel_info, climate, is_featured, display_order,
                meta_title, meta_description, status } = req.body;
        const result = await pool.query(
            `INSERT INTO destinations (name, slug, flag, tagline, description, long_description,
             why_choose, image, avg_savings, hospital_count, doctor_count, language, currency,
             visa_info, travel_info, climate, is_featured, display_order, meta_title, meta_description, status)
             VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,$20,$21) RETURNING *`,
            [name, slug, flag, tagline, description, long_description, why_choose,
             image, avg_savings, hospital_count||0, doctor_count||0, language, currency,
             visa_info, travel_info, climate, is_featured||false, display_order||0,
             meta_title, meta_description, status||'draft']
        );
        await logActivity(req.user.id, 'create', 'destination', result.rows[0].id, `Created: ${name}`);
        res.json(result.rows[0]);
    } catch (err) { res.status(500).json({ error: err.message }); }
});

app.put('/api/destinations/:id', apiAuth, roleRequired('super_admin', 'editor'), async (req, res) => {
    try {
        const { name, slug, flag, tagline, description, long_description, why_choose,
                image, avg_savings, hospital_count, doctor_count, language, currency,
                visa_info, travel_info, climate, is_featured, display_order,
                meta_title, meta_description, status } = req.body;
        const result = await pool.query(
            `UPDATE destinations SET name=$1, slug=$2, flag=$3, tagline=$4, description=$5,
             long_description=$6, why_choose=$7, image=$8, avg_savings=$9, hospital_count=$10,
             doctor_count=$11, language=$12, currency=$13, visa_info=$14, travel_info=$15,
             climate=$16, is_featured=$17, display_order=$18, meta_title=$19, meta_description=$20,
             status=$21, updated_at=NOW() WHERE id=$22 RETURNING *`,
            [name, slug, flag, tagline, description, long_description, why_choose,
             image, avg_savings, hospital_count||0, doctor_count||0, language, currency,
             visa_info, travel_info, climate, is_featured, display_order||0,
             meta_title, meta_description, status, req.params.id]
        );
        await logActivity(req.user.id, 'update', 'destination', req.params.id, `Updated: ${name}`);
        res.json(result.rows[0]);
    } catch (err) { res.status(500).json({ error: err.message }); }
});

app.delete('/api/destinations/:id', apiAuth, roleRequired('super_admin'), async (req, res) => {
    try {
        const id = req.params.id; const deps = [];
        const h  = await pool.query('SELECT COUNT(*) FROM hospitals WHERE destination_id=$1', [id]);
        if (+h.rows[0].count  > 0) deps.push(`${h.rows[0].count} hospital(s)`);
        const d  = await pool.query('SELECT COUNT(*) FROM doctors WHERE destination_id=$1', [id]);
        if (+d.rows[0].count  > 0) deps.push(`${d.rows[0].count} doctor(s)`);
        const ds = await pool.query('SELECT COUNT(*) FROM destination_specialties WHERE destination_id=$1', [id]);
        if (+ds.rows[0].count > 0) deps.push(`${ds.rows[0].count} destination specialty page(s)`);
        const dt = await pool.query('SELECT COUNT(*) FROM destination_treatments WHERE destination_id=$1', [id]);
        if (+dt.rows[0].count > 0) deps.push(`${dt.rows[0].count} destination treatment page(s)`);
        if (deps.length) return res.status(409).json({ error: `Cannot delete — linked to ${deps.join(', ')}. Remove them first.` });
        await pool.query('DELETE FROM destinations WHERE id=$1', [id]);
        await logActivity(req.user.id, 'delete', 'destination', parseInt(id), 'Deleted destination');
        res.json({ success: true });
    } catch (err) { res.status(500).json({ error: 'Server error' }); }
});

};
