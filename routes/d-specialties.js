module.exports = function(app, pool, { authRequired, apiAuth, roleRequired, logActivity, servePage }) {

// ============== D. SPECIALTIES CRUD (Page A — Destination + Specialty combos) ==============
app.get('/d-specialties', authRequired, (req, res) => {
    servePage(res, 'd-specialties');
});
app.get('/d-specialty-studio', authRequired, (req, res) => {
    servePage(res, 'd-specialty-studio');
});
app.get('/d-specialty-studio/edit/:id', authRequired, (req, res) => {
    servePage(res, 'd-specialty-studio');
});

app.get('/api/d-specialties', apiAuth, async (req, res) => {
    try {
        const result = await pool.query(
            `SELECT ds.*, d.name as destination_name, d.flag as destination_flag, d.slug as destination_slug,
                    s.name as specialty_name, s.slug as specialty_slug, s.icon as specialty_icon
             FROM destination_specialties ds
             LEFT JOIN destinations d ON ds.destination_id = d.id
             LEFT JOIN specialties s ON ds.specialty_id = s.id
             ORDER BY d.name ASC, s.name ASC`
        );
        res.json(result.rows);
    } catch (err) { res.status(500).json({ error: 'Server error' }); }
});

app.get('/api/d-specialties/:id', apiAuth, async (req, res) => {
    try {
        const result = await pool.query(
            `SELECT ds.*, d.name as destination_name, d.flag as destination_flag, d.slug as destination_slug,
                    s.name as specialty_name, s.slug as specialty_slug, s.icon as specialty_icon
             FROM destination_specialties ds
             LEFT JOIN destinations d ON ds.destination_id = d.id
             LEFT JOIN specialties s ON ds.specialty_id = s.id
             WHERE ds.id = $1`, [req.params.id]
        );
        if (result.rows.length === 0) return res.status(404).json({ error: 'Not found' });
        res.json(result.rows[0]);
    } catch (err) { res.status(500).json({ error: err.message }); }
});

app.post('/api/d-specialties', apiAuth, roleRequired('super_admin', 'editor'), async (req, res) => {
    try {
        const { destination_id, specialty_id, name, slug, description, long_description, why_choose, image, hero_bg, meta_title, meta_description, status, display_order } = req.body;
        if (!destination_id || !specialty_id) return res.status(400).json({ error: 'Destination and Specialty required' });
        const result = await pool.query(
            `INSERT INTO destination_specialties (destination_id, specialty_id, name, slug, description, long_description, why_choose, image, hero_bg, meta_title, meta_description, status, display_order)
             VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13) RETURNING *`,
            [destination_id, specialty_id, name, slug, description, long_description, why_choose, image, hero_bg, meta_title, meta_description, status || 'draft', display_order || 0]
        );
        await logActivity(req.user.id, 'create', 'd-specialty', result.rows[0].id, `Created: ${name}`);
        res.json(result.rows[0]);
    } catch (err) {
        if (err.code === '23505') return res.status(400).json({ error: 'This destination + specialty combination already exists' });
        res.status(500).json({ error: err.message });
    }
});

app.put('/api/d-specialties/:id', apiAuth, roleRequired('super_admin', 'editor'), async (req, res) => {
    try {
        const { destination_id, specialty_id, name, slug, description, long_description, why_choose, image, hero_bg, meta_title, meta_description, status, display_order } = req.body;
        const result = await pool.query(
            `UPDATE destination_specialties SET destination_id=$1, specialty_id=$2, name=$3, slug=$4, description=$5, long_description=$6, why_choose=$7, image=$8, hero_bg=$9, meta_title=$10, meta_description=$11, status=$12, display_order=$13
             WHERE id=$14 RETURNING *`,
            [destination_id, specialty_id, name, slug, description, long_description, why_choose, image, hero_bg, meta_title, meta_description, status, display_order || 0, req.params.id]
        );
        if (result.rows.length === 0) return res.status(404).json({ error: 'Not found' });
        await logActivity(req.user.id, 'update', 'd-specialty', parseInt(req.params.id), `Updated: ${name}`);
        res.json(result.rows[0]);
    } catch (err) {
        if (err.code === '23505') return res.status(400).json({ error: 'This destination + specialty combination already exists' });
        res.status(500).json({ error: err.message });
    }
});

app.post('/api/d-specialties/bulk', apiAuth, roleRequired('super_admin', 'editor'), async (req, res) => {
    try {
        const { ids, action } = req.body;
        if (!ids || !ids.length) return res.status(400).json({ error: 'No items selected' });
        let count = 0;
        if (action === 'delete') {
            if (req.user.role !== 'super_admin') return res.status(403).json({ error: 'Only admins can delete' });
            const result = await pool.query('DELETE FROM destination_specialties WHERE id = ANY($1) RETURNING id', [ids]);
            count = result.rowCount; await logActivity(req.user.id, 'bulk_delete', 'd-specialty', null, `Bulk deleted ${count} d-specialties`);
        } else if (action === 'publish') {
            const result = await pool.query("UPDATE destination_specialties SET status='published' WHERE id = ANY($1) RETURNING id", [ids]);
            count = result.rowCount; await logActivity(req.user.id, 'bulk_publish', 'd-specialty', null, `Bulk published ${count} d-specialties`);
        } else if (action === 'draft') {
            const result = await pool.query("UPDATE destination_specialties SET status='draft' WHERE id = ANY($1) RETURNING id", [ids]);
            count = result.rowCount; await logActivity(req.user.id, 'bulk_draft', 'd-specialty', null, `Bulk set ${count} d-specialties to draft`);
        } else { return res.status(400).json({ error: 'Invalid action' }); }
        res.json({ success: true, count });
    } catch (err) { res.status(500).json({ error: err.message }); }
});

app.delete('/api/d-specialties/:id', apiAuth, roleRequired('super_admin'), async (req, res) => {
    try {
        await pool.query('DELETE FROM destination_specialties WHERE id = $1', [req.params.id]);
        await logActivity(req.user.id, 'delete', 'd-specialty', parseInt(req.params.id), 'Deleted d-specialty');
        res.json({ success: true });
    } catch (err) { res.status(500).json({ error: 'Server error' }); }
});


};
