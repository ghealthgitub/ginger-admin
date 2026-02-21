module.exports = function(app, pool, { authRequired, apiAuth, roleRequired, logActivity, servePage, serveStudio }) {

// ─── CPT CONFIG ───────────────────────────────────────────────
const VIDEO_CONFIG = {
    cpt: 'video',
    label: 'Video',
    api: '/api/videos',
    editBase: '/video-studio/edit/',
    listUrl: '/videos',
    placeholder: 'e.g. Dr. Trehan explains CABG procedure...',
    noQuill: true,
    fieldRows: [
        [
            { id: 'youtube_url', label: 'YouTube URL *', type: 'text', placeholder: 'https://www.youtube.com/watch?v=...', flex: 3, onchange: 'extractYTThumb()' },
            { id: 'sort_order',  label: 'Sort Order',   type: 'number', width: '120px' },
        ],
        [
            { id: 'doctor_id',    label: 'Doctor',    type: 'select', source: '/api/doctors',    flex: 1 },
            { id: 'hospital_id',  label: 'Hospital',  type: 'select', source: '/api/hospitals',  flex: 1 },
            { id: 'specialty_id', label: 'Specialty', type: 'select', source: '/api/specialties', flex: 1 },
            { id: 'treatment_id', label: 'Treatment', type: 'select', source: '/api/treatments',  flex: 1 },
        ],
        [
            { id: 'description', label: 'Description', type: 'textarea', placeholder: 'Brief description of the video...', flex: 1, rows: 2 },
        ]
    ]
};

// ─── STUDIO ROUTES ────────────────────────────────────────────
app.get('/video-studio', authRequired, (req, res) => {
    serveStudio(res, VIDEO_CONFIG);
});
app.get('/video-studio/edit/:id', authRequired, (req, res) => {
    serveStudio(res, VIDEO_CONFIG);
});

// ─── LISTING PAGE ─────────────────────────────────────────────
app.get('/videos', authRequired, (req, res) => {
    servePage(res, 'videos');
});

// ─── API ──────────────────────────────────────────────────────
app.get('/api/videos', apiAuth, async (req, res) => {
    try {
        const result = await pool.query(
            `SELECT v.*, d.name as doctor_name, h.name as hospital_name,
                    s.name as specialty_name, t.name as treatment_name
             FROM videos v
             LEFT JOIN doctors d ON v.doctor_id = d.id
             LEFT JOIN hospitals h ON v.hospital_id = h.id
             LEFT JOIN specialties s ON v.specialty_id = s.id
             LEFT JOIN treatments t ON v.treatment_id = t.id
             ORDER BY v.sort_order ASC, v.created_at DESC`
        );
        res.json(result.rows);
    } catch (err) { res.status(500).json({ error: 'Server error' }); }
});

app.get('/api/videos/:id', apiAuth, async (req, res) => {
    try {
        const result = await pool.query(
            `SELECT v.*, d.name as doctor_name, h.name as hospital_name,
                    s.name as specialty_name, t.name as treatment_name
             FROM videos v
             LEFT JOIN doctors d ON v.doctor_id = d.id
             LEFT JOIN hospitals h ON v.hospital_id = h.id
             LEFT JOIN specialties s ON v.specialty_id = s.id
             LEFT JOIN treatments t ON v.treatment_id = t.id
             WHERE v.id = $1`, [req.params.id]
        );
        if (result.rows.length === 0) return res.status(404).json({ error: 'Not found' });
        res.json(result.rows[0]);
    } catch (err) { res.status(500).json({ error: err.message }); }
});

app.post('/api/videos', apiAuth, roleRequired('super_admin', 'editor'), async (req, res) => {
    try {
        const { title, slug, youtube_url, thumbnail, description, doctor_id, hospital_id,
                specialty_id, treatment_id, sort_order, is_featured, status } = req.body;
        if (!title || !youtube_url) return res.status(400).json({ error: 'Title and YouTube URL required' });
        const result = await pool.query(
            `INSERT INTO videos (title, slug, youtube_url, thumbnail, description,
              doctor_id, hospital_id, specialty_id, treatment_id, sort_order, is_featured, status)
             VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12) RETURNING *`,
            [title, slug, youtube_url, thumbnail, description,
             doctor_id||null, hospital_id||null, specialty_id||null, treatment_id||null,
             sort_order||0, is_featured||false, status||'draft']
        );
        await logActivity(req.user.id, 'create', 'video', result.rows[0].id, `Created: ${title}`);
        res.json(result.rows[0]);
    } catch (err) {
        if (err.code === '23505') return res.status(400).json({ error: 'A video with this slug already exists' });
        res.status(500).json({ error: err.message });
    }
});

app.put('/api/videos/:id', apiAuth, roleRequired('super_admin', 'editor'), async (req, res) => {
    try {
        const { title, slug, youtube_url, thumbnail, description, doctor_id, hospital_id,
                specialty_id, treatment_id, sort_order, is_featured, status } = req.body;
        const result = await pool.query(
            `UPDATE videos SET title=$1, slug=$2, youtube_url=$3, thumbnail=$4, description=$5,
              doctor_id=$6, hospital_id=$7, specialty_id=$8, treatment_id=$9, sort_order=$10,
              is_featured=$11, status=$12, updated_at=NOW()
             WHERE id=$13 RETURNING *`,
            [title, slug, youtube_url, thumbnail, description,
             doctor_id||null, hospital_id||null, specialty_id||null, treatment_id||null,
             sort_order||0, is_featured||false, status, req.params.id]
        );
        if (result.rows.length === 0) return res.status(404).json({ error: 'Not found' });
        await logActivity(req.user.id, 'update', 'video', parseInt(req.params.id), `Updated: ${title}`);
        res.json(result.rows[0]);
    } catch (err) {
        if (err.code === '23505') return res.status(400).json({ error: 'A video with this slug already exists' });
        res.status(500).json({ error: err.message });
    }
});

app.delete('/api/videos/:id', apiAuth, roleRequired('super_admin'), async (req, res) => {
    try {
        await pool.query('DELETE FROM videos WHERE id = $1', [req.params.id]);
        await logActivity(req.user.id, 'delete', 'video', parseInt(req.params.id), 'Deleted video');
        res.json({ success: true });
    } catch (err) { res.status(500).json({ error: 'Server error' }); }
});

};
