module.exports = function(app, pool, { authRequired, apiAuth, roleRequired, logActivity, servePage }) {

// ============== SPECIALTIES CRUD ==============
app.get('/specialties-mgmt', authRequired, (req, res) => {
    servePage(res, 'specialties');
});
app.get('/specialties/new', authRequired, roleRequired('super_admin', 'editor'), (req, res) => {
    servePage(res, 'specialty-studio');
});
app.get('/specialties/edit/:id', authRequired, roleRequired('super_admin', 'editor'), (req, res) => {
    servePage(res, 'specialty-studio');
});

app.get('/api/specialties', apiAuth, async (req, res) => {
    try {
        const result = await pool.query('SELECT * FROM specialties ORDER BY display_order ASC, name ASC');
        res.json(result.rows);
    } catch (err) { res.status(500).json({ error: 'Server error' }); }
});

app.get('/api/specialties/:id', apiAuth, async (req, res) => {
    try {
        const result = await pool.query('SELECT * FROM specialties WHERE id = $1', [req.params.id]);
        if (result.rows.length === 0) return res.status(404).json({ error: 'Not found' });
        res.json(result.rows[0]);
    } catch (err) { res.status(500).json({ error: 'Server error' }); }
});

app.post('/api/specialties', apiAuth, roleRequired('super_admin', 'editor'), async (req, res) => {
    try {
        const { name, slug, icon, category, description, long_description, treatment_count, image, is_featured, display_order, meta_title, meta_description, status } = req.body;
        const result = await pool.query(
            `INSERT INTO specialties (name, slug, icon, category, description, long_description, treatment_count, image, is_featured, display_order, meta_title, meta_description, status)
             VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13) RETURNING *`,
            [name, slug, icon, category, description, long_description, treatment_count || 0, image, is_featured || false, display_order || 0, meta_title, meta_description, status || 'draft']
        );
        await logActivity(req.user.id, 'create', 'specialty', result.rows[0].id, `Created: ${name}`);
        res.json(result.rows[0]);
    } catch (err) { res.status(500).json({ error: err.message }); }
});

app.put('/api/specialties/:id', apiAuth, roleRequired('super_admin', 'editor'), async (req, res) => {
    try {
        const { name, slug, icon, category, description, long_description, treatment_count, image, is_featured, display_order, meta_title, meta_description, status } = req.body;
        const result = await pool.query(
            `UPDATE specialties SET name=$1, slug=$2, icon=$3, category=$4, description=$5, long_description=$6, treatment_count=$7, image=$8, is_featured=$9, display_order=$10, meta_title=$11, meta_description=$12, status=$13, updated_at=NOW()
             WHERE id=$14 RETURNING *`,
            [name, slug, icon, category, description, long_description, treatment_count, image, is_featured, display_order, meta_title, meta_description, status, req.params.id]
        );
        await logActivity(req.user.id, 'update', 'specialty', req.params.id, `Updated: ${name}`);
        res.json(result.rows[0]);
    } catch (err) { res.status(500).json({ error: err.message }); }
});

// Specialties bulk actions
app.post('/api/specialties/bulk', apiAuth, roleRequired('super_admin', 'editor'), async (req, res) => {
    try {
        const { ids, action } = req.body;
        if (!ids || !ids.length) return res.status(400).json({ error: 'No items selected' });
        let count = 0;
        if (action === 'delete') {
            if (req.user.role !== 'super_admin') return res.status(403).json({ error: 'Only admins can delete' });
            const result = await pool.query('DELETE FROM specialties WHERE id = ANY($1) RETURNING id', [ids]);
            count = result.rowCount;
            await logActivity(req.user.id, 'bulk_delete', 'specialty', null, `Bulk deleted ${count} specialties`);
        } else if (action === 'publish') {
            const result = await pool.query("UPDATE specialties SET status='published', updated_at=NOW() WHERE id = ANY($1) RETURNING id", [ids]);
            count = result.rowCount;
            await logActivity(req.user.id, 'bulk_publish', 'specialty', null, `Bulk published ${count} specialties`);
        } else if (action === 'draft') {
            const result = await pool.query("UPDATE specialties SET status='draft', updated_at=NOW() WHERE id = ANY($1) RETURNING id", [ids]);
            count = result.rowCount;
            await logActivity(req.user.id, 'bulk_draft', 'specialty', null, `Bulk set ${count} specialties to draft`);
        } else { return res.status(400).json({ error: 'Invalid action' }); }
        res.json({ success: true, count });
    } catch (err) { res.status(500).json({ error: err.message }); }
});

app.delete('/api/specialties/:id', apiAuth, roleRequired('super_admin'), async (req, res) => {
    try {
        const id = req.params.id;
        const deps = [];
        const t = await pool.query('SELECT COUNT(*) FROM treatments WHERE specialty_id = $1', [id]);
        if (+t.rows[0].count > 0) deps.push(`${t.rows[0].count} treatment(s)`);
        const d = await pool.query('SELECT COUNT(*) FROM doctors WHERE specialty_id = $1', [id]);
        if (+d.rows[0].count > 0) deps.push(`${d.rows[0].count} doctor(s)`);
        const ds = await pool.query('SELECT COUNT(*) FROM destination_specialties WHERE specialty_id = $1', [id]);
        if (+ds.rows[0].count > 0) deps.push(`${ds.rows[0].count} destination specialty page(s)`);
        if (deps.length > 0) {
            return res.status(409).json({ error: `Cannot delete — linked to ${deps.join(', ')}. Remove them first.` });
        }
        await pool.query('DELETE FROM specialties WHERE id = $1', [id]);
        await logActivity(req.user.id, 'delete', 'specialty', parseInt(id), 'Deleted specialty');
        res.json({ success: true });
    } catch (err) { res.status(500).json({ error: 'Server error' }); }
});


};
