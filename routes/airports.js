module.exports = function(app, pool, { authRequired, apiAuth, roleRequired, logActivity, servePage, serveStudio }) {

const AIRPORT_CONFIG = {
    cpt: 'airport',
    label: 'Airport',
    api: '/api/airports',
    editBase: '/airports/edit/',
    listUrl: '/airports',
    placeholder: 'e.g. Indira Gandhi International Airport...',
    fieldRows: [
        [
            { id: 'code',    label: 'IATA Code', type: 'text',        placeholder: 'DEL', width: '100px' },
            { id: 'country', label: 'Country',   type: 'select-name', source: '/api/destinations', flex: 1 },
            { id: 'city',    label: 'City',       type: 'city-select', flex: 1 }
        ],
        [
            { id: 'latitude',  label: 'Latitude',  type: 'number', placeholder: '28.5562', width: '160px' },
            { id: 'longitude', label: 'Longitude', type: 'number', placeholder: '77.1000', width: '160px' }
        ]
    ]
};

// ============== PAGE ROUTES ==============
app.get('/airports', authRequired, roleRequired('super_admin', 'editor'), (req, res) => {
    servePage(res, 'airports');
});
app.get('/airports/new', authRequired, roleRequired('super_admin', 'editor'), (req, res) => {
    serveStudio(res, AIRPORT_CONFIG);
});
app.get('/airports/edit/:id', authRequired, roleRequired('super_admin', 'editor'), (req, res) => {
    serveStudio(res, AIRPORT_CONFIG);
});

// ============== API ROUTES ==============
app.get('/api/airports', apiAuth, async (req, res) => {
    try {
        const result = await pool.query('SELECT * FROM airports ORDER BY country, city, name');
        res.json(result.rows);
    } catch (err) { res.status(500).json({ error: 'Server error' }); }
});

// GET single airport by ID — required by universal studio loadItem()
app.get('/api/airports/:id', apiAuth, async (req, res) => {
    try {
        const result = await pool.query('SELECT * FROM airports WHERE id = $1', [req.params.id]);
        if (!result.rows.length) return res.status(404).json({ error: 'Airport not found' });
        res.json(result.rows[0]);
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
        await logActivity(req.user?.id, 'create', 'airport', result.rows[0].id, name);
        res.json(result.rows[0]);
    } catch (err) { res.status(500).json({ error: err.message }); }
});

app.put('/api/airports/:id', apiAuth, roleRequired('super_admin', 'editor'), async (req, res) => {
    try {
        const { name, code, city, country, latitude, longitude, arrival_instructions, photos, status } = req.body;
        if (!name || !city) return res.status(400).json({ error: 'Name and city are required' });
        const slug = (code ? code.toLowerCase() + '-' : '') + name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
        const result = await pool.query(
            'UPDATE airports SET name=$1, slug=$2, code=$3, city=$4, country=$5, latitude=$6, longitude=$7, arrival_instructions=$8, photos=$9, status=$10 WHERE id=$11 RETURNING *',
            [name, slug, code||null, city, country||null, latitude||null, longitude||null, arrival_instructions||null, photos||[], status||'draft', req.params.id]
        );
        await logActivity(req.user?.id, 'update', 'airport', req.params.id, name);
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
