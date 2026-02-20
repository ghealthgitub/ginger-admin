module.exports = function(app, pool, { authRequired, apiAuth, roleRequired, logActivity, servePage }) {

// ============== D. TREATMENTS CRUD (Page A — Destination + Treatment combos) ==============
app.get('/d-treatments', authRequired, (req, res) => {
    servePage(res, 'd-treatments');
});

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

app.post('/api/d-treatments', apiAuth, roleRequired('super_admin', 'editor'), async (req, res) => {
    try {
        const { destination_id, treatment_id, specialty_id, name, slug, description, long_description, image, hero_bg, cost_min_usd, cost_max_usd, cost_includes, hospital_stay, meta_title, meta_description, status, display_order } = req.body;
        if (!destination_id || !treatment_id) return res.status(400).json({ error: 'Destination and Treatment required' });
        const result = await pool.query(
            `INSERT INTO destination_treatments (destination_id, treatment_id, specialty_id, name, slug, description, long_description, image, hero_bg, cost_min_usd, cost_max_usd, cost_includes, hospital_stay, meta_title, meta_description, status, display_order)
             VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17) RETURNING *`,
            [destination_id, treatment_id, specialty_id, name, slug, description, long_description, image, hero_bg, cost_min_usd||null, cost_max_usd||null, cost_includes, hospital_stay, meta_title, meta_description, status || 'draft', display_order || 0]
        );
        await logActivity(req.user.id, 'create', 'destination_treatment', result.rows[0].id, `Created: ${name}`);
        res.json(result.rows[0]);
    } catch (err) {
        if (err.code === '23505') return res.status(400).json({ error: 'This destination + treatment combination already exists' });
        res.status(500).json({ error: err.message });
    }
});

app.put('/api/d-treatments/:id', apiAuth, roleRequired('super_admin', 'editor'), async (req, res) => {
    try {
        const { destination_id, treatment_id, specialty_id, name, slug, description, long_description, image, hero_bg, cost_min_usd, cost_max_usd, cost_includes, hospital_stay, meta_title, meta_description, status, display_order } = req.body;
        const result = await pool.query(
            `UPDATE destination_treatments SET destination_id=$1, treatment_id=$2, specialty_id=$3, name=$4, slug=$5, description=$6, long_description=$7, image=$8, hero_bg=$9, cost_min_usd=$10, cost_max_usd=$11, cost_includes=$12, hospital_stay=$13, meta_title=$14, meta_description=$15, status=$16, display_order=$17
             WHERE id=$18 RETURNING *`,
            [destination_id, treatment_id, specialty_id, name, slug, description, long_description, image, hero_bg, cost_min_usd||null, cost_max_usd||null, cost_includes, hospital_stay, meta_title, meta_description, status, display_order || 0, req.params.id]
        );
        if (result.rows.length === 0) return res.status(404).json({ error: 'Not found' });
        await logActivity(req.user.id, 'update', 'destination_treatment', parseInt(req.params.id), `Updated: ${name}`);
        res.json(result.rows[0]);
    } catch (err) {
        if (err.code === '23505') return res.status(400).json({ error: 'This destination + treatment combination already exists' });
        res.status(500).json({ error: err.message });
    }
});

app.delete('/api/d-treatments/:id', apiAuth, roleRequired('super_admin'), async (req, res) => {
    try {
        await pool.query('DELETE FROM destination_treatments WHERE id = $1', [req.params.id]);
        await logActivity(req.user.id, 'delete', 'destination_treatment', parseInt(req.params.id), 'Deleted destination treatment');
        res.json({ success: true });
    } catch (err) { res.status(500).json({ error: 'Server error' }); }
});


};
