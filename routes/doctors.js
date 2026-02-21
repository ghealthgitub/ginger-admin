module.exports = function(app, pool, { authRequired, apiAuth, roleRequired, logActivity, servePage, serveStudio }) {

// ─── CPT CONFIG ───────────────────────────────────────────────
const DOCTOR_CONFIG = {
    cpt: 'doctor',
    label: 'Doctor',
    api: '/api/doctors',
    editBase: '/doctors/edit/',
    listUrl: '/doctors',
    placeholder: 'Doctor full name...',
    permalinkPrefix: 'ginger.healthcare/destinations/',
    permalinkDynamic: {
        selectId: 'destination_id',
        withSlug: 'ginger.healthcare/destinations/{slug}/doctors/',
        withoutSlug: 'ginger.healthcare/destinations/.../doctors/'
    },
    fieldRows: [
        [
            { id: 'destination_id', label: 'Destination *', type: 'select', source: '/api/destinations', flex: 2, onchange: 'updatePermalink()' },
            { id: 'hospital_id',    label: 'Hospital',      type: 'select', source: '/api/hospitals',    flex: 3 },
            { id: 'specialty_id',   label: 'Specialty',     type: 'select', source: '/api/specialties',  flex: 2 },
        ],
        [
            { id: 'title',            label: 'Title',       type: 'text',   placeholder: 'Dr.',    width: '70px'  },
            { id: 'experience_years', label: 'Experience',  type: 'number', placeholder: '15',     width: '90px'  },
            { id: 'city',             label: 'City',        type: 'text',   placeholder: 'Mumbai', width: '120px' },
            { id: 'description',      label: 'Short Bio',   type: 'text',   placeholder: 'Brief overview of the doctor...', flex: 1 },
        ]
    ]
};

// ─── STUDIO ROUTES ────────────────────────────────────────────
app.get('/doctors/new', authRequired, roleRequired('super_admin', 'editor'), (req, res) => {
    serveStudio(res, DOCTOR_CONFIG);
});
app.get('/doctors/edit/:id', authRequired, roleRequired('super_admin', 'editor'), (req, res) => {
    serveStudio(res, DOCTOR_CONFIG);
});

// ─── LISTING ──────────────────────────────────────────────────
app.get('/doctors', authRequired, (req, res) => {
    servePage(res, 'doctors');
});

// ─── API ──────────────────────────────────────────────────────
app.get('/api/doctors', apiAuth, async (req, res) => {
    try {
        const result = await pool.query(
            `SELECT d.*, h.name as hospital_name,
                    dest.name as destination_name, dest.slug as destination_slug,
                    sp.name as specialty_name_fk, sp.slug as specialty_slug
             FROM doctors d
             LEFT JOIN hospitals h ON d.hospital_id = h.id
             LEFT JOIN destinations dest ON d.destination_id = dest.id
             LEFT JOIN specialties sp ON d.specialty_id = sp.id
             ORDER BY d.name ASC`
        );
        res.json(result.rows);
    } catch (err) { res.status(500).json({ error: 'Server error' }); }
});

app.get('/api/doctors/:id', apiAuth, async (req, res) => {
    try {
        const result = await pool.query(
            `SELECT d.*, h.name as hospital_name, h.country as hospital_country,
                    dest.name as destination_name, dest.slug as destination_slug,
                    sp.name as specialty_name_fk
             FROM doctors d
             LEFT JOIN hospitals h ON d.hospital_id = h.id
             LEFT JOIN destinations dest ON d.destination_id = dest.id
             LEFT JOIN specialties sp ON d.specialty_id = sp.id
             WHERE d.id = $1`, [req.params.id]
        );
        if (result.rows.length === 0) return res.status(404).json({ error: 'Not found' });
        res.json(result.rows[0]);
    } catch (err) { res.status(500).json({ error: 'Server error' }); }
});

app.post('/api/doctors', apiAuth, roleRequired('super_admin', 'editor'), async (req, res) => {
    try {
        const { name, slug, title, specialty, specialty_id, specialties, hospital_id,
                destination_id, country, city, experience_years, qualifications,
                description, long_description, image, languages, is_featured, status,
                treatments, meta_title, meta_description } = req.body;
        const result = await pool.query(
            `INSERT INTO doctors (name, slug, title, specialty, specialty_id, specialties,
             hospital_id, destination_id, country, city, experience_years, qualifications,
             description, long_description, image, languages, is_featured, status, treatments,
             meta_title, meta_description)
             VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,$20,$21) RETURNING *`,
            [name, slug, title||null, specialty||null, specialty_id||null, specialties||[],
             hospital_id||null, destination_id||null, country||null, city||null,
             experience_years||null, qualifications||[], description, long_description,
             image, languages||[], is_featured||false, status||'draft', treatments||[],
             meta_title||null, meta_description||null]
        );
        await logActivity(req.user.id, 'create', 'doctor', result.rows[0].id, `Created: ${name}`);
        res.json(result.rows[0]);
    } catch (err) { res.status(500).json({ error: err.message }); }
});

app.put('/api/doctors/:id', apiAuth, roleRequired('super_admin', 'editor'), async (req, res) => {
    try {
        const { name, slug, title, specialty, specialty_id, specialties, hospital_id,
                destination_id, country, city, experience_years, qualifications,
                description, long_description, image, languages, is_featured, status,
                treatments, meta_title, meta_description } = req.body;
        const result = await pool.query(
            `UPDATE doctors SET name=$1, slug=$2, title=$3, specialty=$4, specialty_id=$5,
             specialties=$6, hospital_id=$7, destination_id=$8, country=$9, city=$10,
             experience_years=$11, qualifications=$12, description=$13, long_description=$14,
             image=$15, languages=$16, is_featured=$17, status=$18, treatments=$19,
             meta_title=$20, meta_description=$21, updated_at=NOW()
             WHERE id=$22 RETURNING *`,
            [name, slug, title||null, specialty||null, specialty_id||null, specialties||[],
             hospital_id||null, destination_id||null, country||null, city||null,
             experience_years||null, qualifications||[], description, long_description,
             image, languages||[], is_featured, status, treatments||[],
             meta_title||null, meta_description||null, req.params.id]
        );
        await logActivity(req.user.id, 'update', 'doctor', req.params.id, `Updated: ${name}`);
        res.json(result.rows[0]);
    } catch (err) { res.status(500).json({ error: err.message }); }
});

app.post('/api/doctors/bulk', apiAuth, roleRequired('super_admin', 'editor'), async (req, res) => {
    try {
        const { ids, action } = req.body;
        if (!ids || !ids.length) return res.status(400).json({ error: 'No items selected' });
        let count = 0;
        if (action === 'delete') {
            if (req.user.role !== 'super_admin') return res.status(403).json({ error: 'Only admins can delete' });
            const result = await pool.query('DELETE FROM doctors WHERE id = ANY($1) RETURNING id', [ids]);
            count = result.rowCount; await logActivity(req.user.id, 'bulk_delete', 'doctor', null, `Bulk deleted ${count} doctors`);
        } else if (action === 'publish') {
            const result = await pool.query("UPDATE doctors SET status='published', updated_at=NOW() WHERE id = ANY($1) RETURNING id", [ids]);
            count = result.rowCount; await logActivity(req.user.id, 'bulk_publish', 'doctor', null, `Bulk published ${count} doctors`);
        } else if (action === 'draft') {
            const result = await pool.query("UPDATE doctors SET status='draft', updated_at=NOW() WHERE id = ANY($1) RETURNING id", [ids]);
            count = result.rowCount; await logActivity(req.user.id, 'bulk_draft', 'doctor', null, `Bulk set ${count} doctors to draft`);
        } else { return res.status(400).json({ error: 'Invalid action' }); }
        res.json({ success: true, count });
    } catch (err) { res.status(500).json({ error: err.message }); }
});

app.delete('/api/doctors/:id', apiAuth, roleRequired('super_admin'), async (req, res) => {
    try {
        const id = req.params.id; const deps = [];
        const v = await pool.query('SELECT COUNT(*) FROM videos WHERE doctor_id=$1', [id]);
        if (+v.rows[0].count > 0) deps.push(`${v.rows[0].count} video(s)`);
        const t = await pool.query('SELECT COUNT(*) FROM testimonials WHERE doctor_id=$1', [id]);
        if (+t.rows[0].count > 0) deps.push(`${t.rows[0].count} testimonial(s)`);
        if (deps.length) return res.status(409).json({ error: `Cannot delete — linked to ${deps.join(', ')}. Remove them first.` });
        await pool.query('DELETE FROM doctor_treatments WHERE doctor_id=$1', [id]);
        await pool.query('DELETE FROM doctors WHERE id=$1', [id]);
        await logActivity(req.user.id, 'delete', 'doctor', parseInt(id), 'Deleted doctor');
        res.json({ success: true });
    } catch (err) { res.status(500).json({ error: 'Server error' }); }
});

// ─── SLUG CHECK ───────────────────────────────────────────────
app.get('/api/doctor-slug-check/:slug', apiAuth, async (req, res) => {
    try {
        const excludeId = req.query.exclude || 0;
        const result = await pool.query('SELECT id, name FROM doctors WHERE slug=$1 AND id!=$2', [req.params.slug, excludeId]);
        res.json({ available: result.rows.length === 0, existing: result.rows[0] || null });
    } catch (err) { res.status(500).json({ error: 'Server error' }); }
});

// ─── JUNCTION: Doctor ↔ Treatments ───────────────────────────
app.get('/api/doctor-treatments/:doctorId', apiAuth, async (req, res) => {
    try {
        const result = await pool.query('SELECT treatment_id FROM doctor_treatments WHERE doctor_id=$1', [req.params.doctorId]);
        res.json(result.rows);
    } catch (err) { res.json([]); }
});
app.put('/api/doctor-treatments/:doctorId', apiAuth, roleRequired('super_admin', 'editor'), async (req, res) => {
    try {
        const { treatment_ids } = req.body;
        const doctorId = req.params.doctorId;
        await pool.query('DELETE FROM doctor_treatments WHERE doctor_id=$1', [doctorId]);
        if (treatment_ids && treatment_ids.length) {
            const values = treatment_ids.map((tid, i) => `($1, $${i+2})`).join(',');
            await pool.query(`INSERT INTO doctor_treatments (doctor_id, treatment_id) VALUES ${values} ON CONFLICT DO NOTHING`, [doctorId, ...treatment_ids]);
        }
        res.json({ success: true, count: (treatment_ids||[]).length });
    } catch (err) { res.status(500).json({ error: err.message }); }
});

};
