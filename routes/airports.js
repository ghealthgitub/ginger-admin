module.exports = function(app, pool, { authRequired, apiAuth, roleRequired, logActivity, servePage }) {

// ============== AIRPORTS CRUD ==============
app.get('/airports', authRequired, roleRequired('super_admin', 'editor'), (req, res) => {
    servePage(res, 'airports');
});
app.get('/airports/new', authRequired, roleRequired('super_admin', 'editor'), (req, res) => {
    servePage(res, 'airport-studio');
});
app.get('/airports/edit/:id', authRequired, roleRequired('super_admin', 'editor'), (req, res) => {
    servePage(res, 'airport-studio');
});

app.get('/api/airports', apiAuth, async (req, res) => {
    try {
        const result = await pool.query('SELECT * FROM airports ORDER BY country, city, name');
        res.json(result.rows);
    } catch (err) { res.status(500).json({ error: 'Server error' }); }
});

app.post('/api/airports', apiAuth, roleRequired('super_admin', 'editor'), async (req, res) => {
    try {
        const { name, code, city, country, latitude, longitude, arrival_instructions, photos, status } = req.body;
        if (!name || !city) return res.status(400).json({ error: 'Name and city are required' });
        const slug = (code ? code.toLowerCase() + '-' : '') + name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
        const result = await pool.query(
            'INSERT INTO airports (name, slug, code, city, country, latitude, longitude, arrival_instructions, photos, status) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10) RETURNING *',
            [name, slug, code||null, city, country||null, latitude||null, longitude||null, arrival_instructions||null, photos||[], status||'draft']
        );
        res.json(result.rows[0]);
    } catch (err) { res.status(500).json({ error: err.message }); }
});

app.put('/api/airports/:id', apiAuth, roleRequired('super_admin', 'editor'), async (req, res) => {
    try {
        const { name, code, city, country, latitude, longitude, arrival_instructions, photos, status } = req.body;
        const slug = (code ? code.toLowerCase() + '-' : '') + name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
        const result = await pool.query(
            'UPDATE airports SET name=$1, slug=$2, code=$3, city=$4, country=$5, latitude=$6, longitude=$7, arrival_instructions=$8, photos=$9, status=$10 WHERE id=$11 RETURNING *',
            [name, slug, code||null, city, country||null, latitude||null, longitude||null, arrival_instructions||null, photos||[], status||'draft', req.params.id]
        );
        res.json(result.rows[0]);
    } catch (err) { res.status(500).json({ error: err.message }); }
});

app.delete('/api/airports/:id', apiAuth, roleRequired('super_admin'), async (req, res) => {
    try {
        await pool.query('DELETE FROM airports WHERE id = $1', [req.params.id]);
        res.json({ success: true });
    } catch (err) { res.status(500).json({ error: 'Server error' }); }
});


};
