module.exports = function(app, pool, { authRequired, apiAuth, roleRequired, logActivity, servePage, serveStudio }) {

// ─── CPT CONFIG ───────────────────────────────────────────────
const DT_CONFIG = {
    cpt: 'd-treatment',
    label: 'D. Treatment',
    api: '/api/d-treatments',
    editBase: '/d-treatment-studio/edit/',
    listUrl: '/d-treatments',
    placeholder: 'e.g. CABG in India...',
    permalinkPrefix: 'ginger.healthcare/destinations/',
    permalinkDynamic: {
        selectId: 'destination_id',
        withSlug: 'ginger.healthcare/destinations/{slug}/',
        withoutSlug: 'ginger.healthcare/destinations/.../'
    },
    viewUrlBuilder: {
        selectId: 'destination_id',
        withParent: 'https://ginger.healthcare/destinations/{parent}/{specialty}/{slug}/',
        withoutParent: null,
        extraSelectId: 'specialty_id'
    },
    fieldRows: [
        [
            { id: 'destination_id', label: 'Destination *', type: 'select', source: '/api/destinations', flex: 2, onchange: 'updatePermalink()' },
            { id: 'specialty_id',   label: 'Specialty *',   type: 'select', source: '/api/specialties',  flex: 2 },
            { id: 'treatment_id',   label: 'Treatment *',   type: 'select', source: '/api/treatments',   flex: 2 },
        ],
        [
            { id: 'cost_min_usd', label: 'Cost From (USD)', type: 'number', width: '160px', placeholder: 'e.g. 3000' },
            { id: 'cost_max_usd', label: 'Cost To (USD)',   type: 'number', width: '160px', placeholder: 'e.g. 8000' },
            { id: 'hospital_stay', label: 'Hospital Stay',  type: 'text',   width: '180px', placeholder: 'e.g. 5-7 days' },
            { id: 'description',  label: 'Short Description', type: 'text', placeholder: 'Brief overview...', flex: 1 },
        ]
    ]
};

// ─── STUDIO ROUTES ────────────────────────────────────────────
app.get('/d-treatment-studio', authRequired, (req, res) => {
    serveStudio(res, DT_CONFIG);
});
app.get('/d-treatment-studio/edit/:id', authRequired, (req, res) => {
    serveStudio(res, DT_CONFIG);
});

// ─── LISTING PAGE ─────────────────────────────────────────────
app.get('/d-treatments', authRequired, (req, res) => {
    servePage(res, 'd-treatments');
});

// ─── API ──────────────────────────────────────────────────────
app.get('/api/d-treatments', apiAuth, async (req, res) => {
    try {
        const result = await pool.query(
            `SELECT dt.*, d.name as destination_name, d.flag as destination_flag, d.slug as destination_slug,
                    t.name as treatment_name, t.slug as treatment_slug,
                    s.name as specialty_name, s.slug as specialty_slug
             FROM destination_treatments dt
             LEFT JOIN destinations d ON dt.destination_id = d.id
             LEFT JOIN treatments t ON dt.treatment_id = t.id
             LEFT JOIN specialties s ON dt.specialty_id = s.id
             ORDER BY d.name ASC, s.name ASC, t.name ASC`
        );
        res.json(result.rows);
    } catch (err) { res.status(500).json({ error: 'Server error' }); }
});

app.get('/api/d-treatments/:id', apiAuth, async (req, res) => {
    try {
        const result = await pool.query(
            `SELECT dt.*, d.name as destination_name, d.flag as destination_flag, d.slug as destination_slug,
                    t.name as treatment_name, t.slug as treatment_slug,
                    s.name as specialty_name, s.slug as specialty_slug
             FROM destination_treatments dt
             LEFT JOIN destinations d ON dt.destination_id = d.id
             LEFT JOIN treatments t ON dt.treatment_id = t.id
             LEFT JOIN specialties s ON dt.specialty_id = s.id
             WHERE dt.id = $1`, [req.params.id]
        );
        if (result.rows.length === 0) return res.status(404).json({ error: 'Not found' });
        res.json(result.rows[0]);
    } catch (err) { res.status(500).json({ error: err.message }); }
});

app.post('/api/d-treatments', apiAuth, roleRequired('super_admin', 'editor'), async (req, res) => {
    try {
        const { destination_id, treatment_id, specialty_id, name, slug, description,
                long_description, image, hero_bg, cost_min_usd, cost_max_usd,
                cost_includes, hospital_stay, meta_title, meta_description, status, display_order } = req.body;
        if (!destination_id || !treatment_id) return res.status(400).json({ error: 'Destination and Treatment required' });
        // Auto-generate name and slug if missing
        let finalName = name, finalSlug = slug;
        if (!finalName || !finalSlug) {
            const dest = await pool.query('SELECT name FROM destinations WHERE id=$1', [destination_id]);
            const treat = await pool.query('SELECT name, slug FROM treatments WHERE id=$1', [treatment_id]);
            const dName = dest.rows[0]?.name || '';
            const tName = treat.rows[0]?.name || '';
            const tSlug = treat.rows[0]?.slug || '';
            finalName = finalName || (tName + ' in ' + dName);
            finalSlug = finalSlug || tSlug;
        }
        const result = await pool.query(
            `INSERT INTO destination_treatments
             (destination_id, treatment_id, specialty_id, name, slug, description, long_description,
              image, hero_bg, cost_min_usd, cost_max_usd, cost_includes, hospital_stay,
              meta_title, meta_description, status, display_order)
             VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17) RETURNING *`,
            [destination_id, treatment_id, specialty_id||null, finalName, finalSlug, description,
             long_description, image, hero_bg, cost_min_usd||null, cost_max_usd||null,
             cost_includes, hospital_stay, meta_title, meta_description, status||'draft', display_order||0]
        );
        await logActivity(req.user.id, 'create', 'd-treatment', result.rows[0].id, `Created: ${finalName}`);
        res.json(result.rows[0]);
    } catch (err) {
        if (err.code === '23505') return res.status(400).json({ error: 'This destination + treatment combination already exists' });
        res.status(500).json({ error: err.message });
    }
});

app.put('/api/d-treatments/:id', apiAuth, roleRequired('super_admin', 'editor'), async (req, res) => {
    try {
        const { destination_id, treatment_id, specialty_id, name, slug, description,
                long_description, image, hero_bg, cost_min_usd, cost_max_usd,
                cost_includes, hospital_stay, meta_title, meta_description, status, display_order } = req.body;
        const result = await pool.query(
            `UPDATE destination_treatments
             SET destination_id=$1, treatment_id=$2, specialty_id=$3, name=$4, slug=$5,
                 description=$6, long_description=$7, image=$8, hero_bg=$9,
                 cost_min_usd=$10, cost_max_usd=$11, cost_includes=$12, hospital_stay=$13,
                 meta_title=$14, meta_description=$15, status=$16, display_order=$17,
                 updated_at=NOW()
             WHERE id=$18 RETURNING *`,
            [destination_id, treatment_id, specialty_id||null, name, slug, description,
             long_description, image, hero_bg, cost_min_usd||null, cost_max_usd||null,
             cost_includes, hospital_stay, meta_title, meta_description, status, display_order||0,
             req.params.id]
        );
        if (result.rows.length === 0) return res.status(404).json({ error: 'Not found' });
        await logActivity(req.user.id, 'update', 'd-treatment', parseInt(req.params.id), `Updated: ${name}`);
        res.json(result.rows[0]);
    } catch (err) {
        if (err.code === '23505') return res.status(400).json({ error: 'This destination + treatment combination already exists' });
        res.status(500).json({ error: err.message });
    }
});

app.delete('/api/d-treatments/:id', apiAuth, roleRequired('super_admin'), async (req, res) => {
    try {
        await pool.query('DELETE FROM destination_treatments WHERE id = $1', [req.params.id]);
        await logActivity(req.user.id, 'delete', 'd-treatment', parseInt(req.params.id), 'Deleted d-treatment');
        res.json({ success: true });
    } catch (err) { res.status(500).json({ error: 'Server error' }); }
});

app.post('/api/d-treatments/bulk', apiAuth, roleRequired('super_admin', 'editor'), async (req, res) => {
    try {
        const { ids, action } = req.body;
        if (!ids || !ids.length) return res.status(400).json({ error: 'No items selected' });
        let count = 0;
        if (action === 'delete') {
            if (req.user.role !== 'super_admin') return res.status(403).json({ error: 'Only admins can delete' });
            const result = await pool.query('DELETE FROM destination_treatments WHERE id = ANY($1) RETURNING id', [ids]);
            count = result.rowCount;
        } else if (action === 'publish') {
            const result = await pool.query("UPDATE destination_treatments SET status='published' WHERE id = ANY($1) RETURNING id", [ids]);
            count = result.rowCount;
        } else if (action === 'draft') {
            const result = await pool.query("UPDATE destination_treatments SET status='draft' WHERE id = ANY($1) RETURNING id", [ids]);
            count = result.rowCount;
        } else return res.status(400).json({ error: 'Invalid action' });
        await logActivity(req.user.id, action, 'd-treatment', null, `Bulk ${action}: ${count} items`);
        res.json({ success: true, count });
    } catch (err) { res.status(500).json({ error: err.message }); }
});

};
