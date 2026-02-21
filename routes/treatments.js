module.exports = function(app, pool, { authRequired, apiAuth, roleRequired, logActivity, servePage, serveStudio }) {

// ─── CPT CONFIG ───────────────────────────────────────────────
const TREATMENT_CONFIG = {
    cpt: 'treatment',
    label: 'Treatment',
    api: '/api/treatments',
    editBase: '/treatments/edit/',
    listUrl: '/treatments',
    viewBase: 'https://ginger.healthcare/treatments/',
    placeholder: 'Treatment name...',
    permalinkDynamic: {
        selectId: 'specialty_id',
        withSlug: 'ginger.healthcare/specialties/{slug}/',
        withoutSlug: 'ginger.healthcare/specialties/.../'
    },
    viewUrlBuilder: {
        selectId: 'specialty_id',
        withParent: 'https://ginger.healthcare/specialties/{parent}/{slug}/'
    },
    fieldRows: [
        [
            { id: 'specialty_id',  label: 'Specialty',        type: 'select', source: '/api/specialties', flex: 1, onchange: 'updatePermalink()' },
            { id: 'duration',      label: 'Duration',         type: 'text',   placeholder: 'e.g. 2-4 hrs',        width: '110px' },
            { id: 'recovery_time', label: 'Recovery',         type: 'text',   placeholder: 'e.g. 2-3 weeks',      width: '110px' }
        ],
        [
            { id: 'success_rate',   label: 'Success Rate',     type: 'text', placeholder: 'e.g. 95%',             width: '90px' },
            { id: 'cost_range_usd', label: 'Cost Range (USD)', type: 'text', placeholder: 'e.g. $5,000–$15,000',  width: '170px' },
            { id: 'description',    label: 'Short Description',type: 'text', placeholder: 'Brief overview...',    flex: 1 }
        ]
    ]
};

// ─── STUDIO ROUTES ────────────────────────────────────────────
app.get('/treatments/new', authRequired, roleRequired('super_admin', 'editor'), (req, res) => {
    serveStudio(res, TREATMENT_CONFIG);
});
app.get('/treatments/edit/:id', authRequired, roleRequired('super_admin', 'editor'), (req, res) => {
    serveStudio(res, TREATMENT_CONFIG);
});

// ─── LISTING ──────────────────────────────────────────────────
app.get('/treatments', authRequired, (req, res) => {
    servePage(res, 'treatments');
});

// ─── API ──────────────────────────────────────────────────────
app.get('/api/treatments', apiAuth, async (req, res) => {
    try {
        const result = await pool.query(
            `SELECT t.*, s.name as specialty_name FROM treatments t
             LEFT JOIN specialties s ON t.specialty_id = s.id
             ORDER BY s.name ASC, t.name ASC`
        );
        res.json(result.rows);
    } catch (err) { res.status(500).json({ error: 'Server error' }); }
});

app.get('/api/treatments/:id', apiAuth, async (req, res) => {
    try {
        const result = await pool.query(
            `SELECT t.*, s.name as specialty_name, s.slug as specialty_slug
             FROM treatments t
             LEFT JOIN specialties s ON t.specialty_id = s.id
             WHERE t.id = $1`, [req.params.id]
        );
        if (result.rows.length === 0) return res.status(404).json({ error: 'Not found' });
        res.json(result.rows[0]);
    } catch (err) { res.status(500).json({ error: err.message }); }
});

app.post('/api/treatments', apiAuth, roleRequired('super_admin', 'editor'), async (req, res) => {
    try {
        const { name, slug, specialty_id, description, long_description, duration,
                recovery_time, success_rate, cost_range_usd, image, is_featured,
                display_order, meta_title, meta_description, status } = req.body;
        const result = await pool.query(
            `INSERT INTO treatments (name, slug, specialty_id, description, long_description,
             duration, recovery_time, success_rate, cost_range_usd, image, is_featured,
             display_order, meta_title, meta_description, status)
             VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15) RETURNING *`,
            [name, slug, specialty_id, description, long_description, duration, recovery_time,
             success_rate, cost_range_usd, image, is_featured||false, display_order||0,
             meta_title, meta_description, status||'draft']
        );
        await logActivity(req.user.id, 'create', 'treatment', result.rows[0].id, `Created: ${name}`);
        res.json(result.rows[0]);
    } catch (err) { res.status(500).json({ error: err.message }); }
});

app.put('/api/treatments/:id', apiAuth, roleRequired('super_admin', 'editor'), async (req, res) => {
    try {
        const { name, slug, specialty_id, description, long_description, duration,
                recovery_time, success_rate, cost_range_usd, image, is_featured,
                display_order, meta_title, meta_description, status } = req.body;
        const result = await pool.query(
            `UPDATE treatments SET name=$1, slug=$2, specialty_id=$3, description=$4,
             long_description=$5, duration=$6, recovery_time=$7, success_rate=$8,
             cost_range_usd=$9, image=$10, is_featured=$11, display_order=$12,
             meta_title=$13, meta_description=$14, status=$15, updated_at=NOW()
             WHERE id=$16 RETURNING *`,
            [name, slug, specialty_id, description, long_description, duration, recovery_time,
             success_rate, cost_range_usd, image, is_featured, display_order||0,
             meta_title, meta_description, status, req.params.id]
        );
        await logActivity(req.user.id, 'update', 'treatment', req.params.id, `Updated: ${name}`);
        res.json(result.rows[0]);
    } catch (err) { res.status(500).json({ error: err.message }); }
});

app.post('/api/treatments/bulk', apiAuth, roleRequired('super_admin', 'editor'), async (req, res) => {
    try {
        const { ids, action } = req.body;
        if (!ids || !ids.length) return res.status(400).json({ error: 'No items selected' });
        let count = 0;
        if (action === 'delete') {
            if (req.user.role !== 'super_admin') return res.status(403).json({ error: 'Only admins can delete' });
            const result = await pool.query('DELETE FROM treatments WHERE id = ANY($1) RETURNING id', [ids]);
            count = result.rowCount;
            await logActivity(req.user.id, 'bulk_delete', 'treatment', null, `Bulk deleted ${count} treatments`);
        } else if (action === 'publish') {
            const result = await pool.query("UPDATE treatments SET status='published', updated_at=NOW() WHERE id = ANY($1) RETURNING id", [ids]);
            count = result.rowCount;
            await logActivity(req.user.id, 'bulk_publish', 'treatment', null, `Bulk published ${count} treatments`);
        } else if (action === 'draft') {
            const result = await pool.query("UPDATE treatments SET status='draft', updated_at=NOW() WHERE id = ANY($1) RETURNING id", [ids]);
            count = result.rowCount;
            await logActivity(req.user.id, 'bulk_draft', 'treatment', null, `Bulk set ${count} treatments to draft`);
        } else return res.status(400).json({ error: 'Invalid action' });
        res.json({ success: true, count });
    } catch (err) { res.status(500).json({ error: err.message }); }
});

app.delete('/api/treatments/:id', apiAuth, roleRequired('super_admin'), async (req, res) => {
    try {
        const id = req.params.id; const deps = [];
        const dt  = await pool.query('SELECT COUNT(*) FROM doctor_treatments WHERE treatment_id=$1', [id]);
        if (+dt.rows[0].count > 0) deps.push(`${dt.rows[0].count} doctor(s)`);
        const dst = await pool.query('SELECT COUNT(*) FROM destination_treatments WHERE treatment_id=$1', [id]);
        if (+dst.rows[0].count > 0) deps.push(`${dst.rows[0].count} destination treatment page(s)`);
        const tc  = await pool.query('SELECT COUNT(*) FROM treatment_costs WHERE treatment_id=$1', [id]);
        if (+tc.rows[0].count > 0) deps.push(`${tc.rows[0].count} cost record(s)`);
        if (deps.length) return res.status(409).json({ error: `Cannot delete — linked to ${deps.join(', ')}. Remove them first.` });
        await pool.query('DELETE FROM treatments WHERE id=$1', [id]);
        await logActivity(req.user.id, 'delete', 'treatment', parseInt(id), 'Deleted treatment');
        res.json({ success: true });
    } catch (err) { res.status(500).json({ error: 'Server error' }); }
});

};
