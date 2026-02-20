module.exports = function(app, pool, { authRequired, apiAuth, roleRequired, logActivity, servePage }) {

// ============== DESTINATIONS CRUD ==============
app.get('/destinations-mgmt', authRequired, (req, res) => {
    servePage(res, 'destinations');
});

app.get('/api/destinations', apiAuth, async (req, res) => {
    try {
        const result = await pool.query('SELECT * FROM destinations ORDER BY display_order ASC');
        res.json(result.rows);
    } catch (err) { res.status(500).json({ error: 'Server error' }); }
});

app.post('/api/destinations', apiAuth, roleRequired('super_admin', 'editor'), async (req, res) => {
    try {
        const { name, slug, flag, tagline, description, long_description, why_choose, image, hospital_count, doctor_count, avg_savings, visa_info, travel_info, language, currency, is_featured, display_order, meta_title, meta_description, status } = req.body;
        const result = await pool.query(
            `INSERT INTO destinations (name, slug, flag, tagline, description, long_description, why_choose, image, hospital_count, doctor_count, avg_savings, visa_info, travel_info, language, currency, is_featured, display_order, meta_title, meta_description, status)
             VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,$20) RETURNING *`,
            [name, slug, flag, tagline, description, long_description, why_choose, image, hospital_count, doctor_count, avg_savings, visa_info, travel_info, language, currency, is_featured || false, display_order || 0, meta_title, meta_description, status || 'draft']
        );
        await logActivity(req.user.id, 'create', 'destination', result.rows[0].id, `Created: ${name}`);
        res.json(result.rows[0]);
    } catch (err) { res.status(500).json({ error: err.message }); }
});

app.put('/api/destinations/:id', apiAuth, roleRequired('super_admin', 'editor'), async (req, res) => {
    try {
        const { name, slug, flag, tagline, description, long_description, why_choose, image, hospital_count, doctor_count, avg_savings, visa_info, travel_info, language, currency, is_featured, display_order, meta_title, meta_description, status } = req.body;
        const result = await pool.query(
            `UPDATE destinations SET name=$1, slug=$2, flag=$3, tagline=$4, description=$5, long_description=$6, why_choose=$7, image=$8, hospital_count=$9, doctor_count=$10, avg_savings=$11, visa_info=$12, travel_info=$13, language=$14, currency=$15, is_featured=$16, display_order=$17, meta_title=$18, meta_description=$19, status=$20, updated_at=NOW()
             WHERE id=$21 RETURNING *`,
            [name, slug, flag, tagline, description, long_description, why_choose, image, hospital_count, doctor_count, avg_savings, visa_info, travel_info, language, currency, is_featured, display_order, meta_title, meta_description, status, req.params.id]
        );
        await logActivity(req.user.id, 'update', 'destination', req.params.id, `Updated: ${name}`);
        res.json(result.rows[0]);
    } catch (err) { res.status(500).json({ error: err.message }); }
});

// Destinations bulk actions
app.post('/api/destinations/bulk', apiAuth, roleRequired('super_admin', 'editor'), async (req, res) => {
    try {
        const { ids, action } = req.body;
        if (!ids || !ids.length) return res.status(400).json({ error: 'No items selected' });
        let count = 0;
        if (action === 'delete') {
            if (req.user.role !== 'super_admin') return res.status(403).json({ error: 'Only admins can delete' });
            const result = await pool.query('DELETE FROM destinations WHERE id = ANY($1) RETURNING id', [ids]);
            count = result.rowCount;
            await logActivity(req.user.id, 'bulk_delete', 'destination', null, `Bulk deleted ${count} destinations`);
        } else if (action === 'publish') {
            const result = await pool.query("UPDATE destinations SET status='published', updated_at=NOW() WHERE id = ANY($1) RETURNING id", [ids]);
            count = result.rowCount;
            await logActivity(req.user.id, 'bulk_publish', 'destination', null, `Bulk published ${count} destinations`);
        } else if (action === 'draft') {
            const result = await pool.query("UPDATE destinations SET status='draft', updated_at=NOW() WHERE id = ANY($1) RETURNING id", [ids]);
            count = result.rowCount;
            await logActivity(req.user.id, 'bulk_draft', 'destination', null, `Bulk set ${count} destinations to draft`);
        } else { return res.status(400).json({ error: 'Invalid action' }); }
        res.json({ success: true, count });
    } catch (err) { res.status(500).json({ error: err.message }); }
});

app.delete('/api/destinations/:id', apiAuth, roleRequired('super_admin'), async (req, res) => {
    try {
        const id = req.params.id;
        // Check for dependent records
        const deps = [];
        const h = await pool.query('SELECT COUNT(*) FROM hospitals WHERE destination_id = $1', [id]);
        if (+h.rows[0].count > 0) deps.push(`${h.rows[0].count} hospital(s)`);
        const d = await pool.query('SELECT COUNT(*) FROM doctors WHERE destination_id = $1', [id]);
        if (+d.rows[0].count > 0) deps.push(`${d.rows[0].count} doctor(s)`);
        const ds = await pool.query('SELECT COUNT(*) FROM destination_specialties WHERE destination_id = $1', [id]);
        if (+ds.rows[0].count > 0) deps.push(`${ds.rows[0].count} destination specialty page(s)`);
        const dt = await pool.query('SELECT COUNT(*) FROM destination_treatments WHERE destination_id = $1', [id]);
        if (+dt.rows[0].count > 0) deps.push(`${dt.rows[0].count} destination treatment page(s)`);
        if (deps.length > 0) {
            return res.status(409).json({ error: `Cannot delete — linked to ${deps.join(', ')}. Remove them first.` });
        }
        await pool.query('DELETE FROM destinations WHERE id = $1', [id]);
        await logActivity(req.user.id, 'delete', 'destination', parseInt(id), 'Deleted destination');
        res.json({ success: true });
    } catch (err) { res.status(500).json({ error: 'Server error' }); }
});


};
