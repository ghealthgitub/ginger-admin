module.exports = function(app, pool, { authRequired, apiAuth, roleRequired, logActivity, servePage }) {

// ============== HOSPITALS CRUD ==============
app.get('/hospitals', authRequired, (req, res) => {
    servePage(res, 'hospitals');
});

app.get('/api/hospitals', apiAuth, async (req, res) => {
    try {
        const result = await pool.query(
            `SELECT h.*, d.name as destination_name, d.slug as destination_slug
             FROM hospitals h LEFT JOIN destinations d ON h.destination_id = d.id
             ORDER BY h.name ASC`
        );
        res.json(result.rows);
    } catch (err) { res.status(500).json({ error: 'Server error' }); }
});

app.post('/api/hospitals', apiAuth, roleRequired('super_admin', 'editor'), async (req, res) => {
    try {
        const { name, slug, destination_id, country, city, address, latitude, longitude, airport_id, airport_distance, description, long_description, accreditations, specialties, beds, established, image, location_image, gallery, gallery_people, rating, is_featured, status } = req.body;
        if (!destination_id) return res.status(400).json({ error: 'Destination (country) is required' });
        const result = await pool.query(
            `INSERT INTO hospitals (name, slug, destination_id, country, city, address, latitude, longitude, airport_id, airport_distance, description, long_description, accreditations, specialties, beds, established, image, location_image, gallery, gallery_people, rating, is_featured, status)
             VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,$20,$21,$22,$23) RETURNING *`,
            [name, slug, destination_id, country, city, address, latitude||null, longitude||null, airport_id||null, airport_distance||null, description, long_description, accreditations || [], specialties || [], beds, established, image, location_image||null, gallery || [], gallery_people || [], rating, is_featured || false, status || 'draft']
        );
        await logActivity(req.user.id, 'create', 'hospital', result.rows[0].id, `Created: ${name}`);
        res.json(result.rows[0]);
    } catch (err) { res.status(500).json({ error: err.message }); }
});

app.put('/api/hospitals/:id', apiAuth, roleRequired('super_admin', 'editor'), async (req, res) => {
    try {
        const { name, slug, destination_id, country, city, address, latitude, longitude, airport_id, airport_distance, description, long_description, accreditations, specialties, beds, established, image, location_image, gallery, gallery_people, rating, is_featured, status } = req.body;
        if (!destination_id) return res.status(400).json({ error: 'Destination (country) is required' });
        const result = await pool.query(
            `UPDATE hospitals SET name=$1, slug=$2, destination_id=$3, country=$4, city=$5, address=$6, latitude=$7, longitude=$8, airport_id=$9, airport_distance=$10, description=$11, long_description=$12, accreditations=$13, specialties=$14, beds=$15, established=$16, image=$17, location_image=$18, gallery=$19, gallery_people=$20, rating=$21, is_featured=$22, status=$23, updated_at=NOW()
             WHERE id=$24 RETURNING *`,
            [name, slug, destination_id, country, city, address, latitude||null, longitude||null, airport_id||null, airport_distance||null, description, long_description, accreditations || [], specialties || [], beds, established, image, location_image||null, gallery || [], gallery_people || [], rating, is_featured, status, req.params.id]
        );
        await logActivity(req.user.id, 'update', 'hospital', req.params.id, `Updated: ${name}`);
        res.json(result.rows[0]);
    } catch (err) { res.status(500).json({ error: err.message }); }
});

// Hospitals bulk actions
app.post('/api/hospitals/bulk', apiAuth, roleRequired('super_admin', 'editor'), async (req, res) => {
    try {
        const { ids, action } = req.body;
        if (!ids || !ids.length) return res.status(400).json({ error: 'No items selected' });
        let count = 0;
        if (action === 'delete') {
            if (req.user.role !== 'super_admin') return res.status(403).json({ error: 'Only admins can delete' });
            const result = await pool.query('DELETE FROM hospitals WHERE id = ANY($1) RETURNING id', [ids]);
            count = result.rowCount; await logActivity(req.user.id, 'bulk_delete', 'hospital', null, `Bulk deleted ${count} hospitals`);
        } else if (action === 'publish') {
            const result = await pool.query("UPDATE hospitals SET status='published', updated_at=NOW() WHERE id = ANY($1) RETURNING id", [ids]);
            count = result.rowCount; await logActivity(req.user.id, 'bulk_publish', 'hospital', null, `Bulk published ${count} hospitals`);
        } else if (action === 'draft') {
            const result = await pool.query("UPDATE hospitals SET status='draft', updated_at=NOW() WHERE id = ANY($1) RETURNING id", [ids]);
            count = result.rowCount; await logActivity(req.user.id, 'bulk_draft', 'hospital', null, `Bulk set ${count} hospitals to draft`);
        } else { return res.status(400).json({ error: 'Invalid action' }); }
        res.json({ success: true, count });
    } catch (err) { res.status(500).json({ error: err.message }); }
});

app.delete('/api/hospitals/:id', apiAuth, roleRequired('super_admin'), async (req, res) => {
    try {
        await pool.query('DELETE FROM hospitals WHERE id = $1', [req.params.id]);
        await logActivity(req.user.id, 'delete', 'hospital', parseInt(req.params.id), 'Deleted hospital');
        res.json({ success: true });
    } catch (err) { res.status(500).json({ error: 'Server error' }); }
});

// Hospital Studio pages
app.get('/hospitals/new', authRequired, roleRequired('super_admin', 'editor'), (req, res) => {
    servePage(res, 'hospital-studio');
});
app.get('/hospitals/edit/:id', authRequired, roleRequired('super_admin', 'editor'), (req, res) => {
    servePage(res, 'hospital-studio');
});

// Single hospital GET (for studio editor)
app.get('/api/hospitals/:id', apiAuth, async (req, res) => {
    try {
        const result = await pool.query(
            `SELECT h.*, d.name as destination_name, d.slug as destination_slug,
                    a.name as airport_name, a.code as airport_code, a.latitude as airport_lat, a.longitude as airport_lng
             FROM hospitals h
             LEFT JOIN destinations d ON h.destination_id = d.id
             LEFT JOIN airports a ON h.airport_id = a.id
             WHERE h.id = $1`, [req.params.id]
        );
        if (result.rows.length === 0) return res.status(404).json({ error: 'Not found' });
        res.json(result.rows[0]);
    } catch (err) { res.status(500).json({ error: 'Server error' }); }
});

// ============== ACCREDITATIONS CRUD ==============
app.get('/accreditations-mgmt', authRequired, roleRequired('super_admin', 'editor'), (req, res) => {
    servePage(res, 'accreditations');
});
app.get('/api/accreditations', apiAuth, async (req, res) => {
    try { const result = await pool.query('SELECT * FROM accreditations ORDER BY name'); res.json(result.rows); }
    catch (err) { res.status(500).json({ error: err.message }); }
});
app.post('/api/accreditations', apiAuth, roleRequired('super_admin', 'editor'), async (req, res) => {
    try {
        const { name, short_name, full_name, icon, description, status } = req.body;
        if (!name) return res.status(400).json({ error: 'Name is required' });
        const slug = name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
        const result = await pool.query(
            'INSERT INTO accreditations (name, slug, short_name, full_name, icon, description, status) VALUES ($1,$2,$3,$4,$5,$6,$7) RETURNING *',
            [name, slug, short_name||null, full_name||null, icon||null, description||null, status||'published']
        );
        res.json(result.rows[0]);
    } catch (err) { res.status(500).json({ error: err.message }); }
});
app.put('/api/accreditations/:id', apiAuth, roleRequired('super_admin', 'editor'), async (req, res) => {
    try {
        const { name, short_name, full_name, icon, description, status } = req.body;
        const slug = name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
        const result = await pool.query(
            'UPDATE accreditations SET name=$1, slug=$2, short_name=$3, full_name=$4, icon=$5, description=$6, status=$7 WHERE id=$8 RETURNING *',
            [name, slug, short_name||null, full_name||null, icon||null, description||null, status||'published', req.params.id]
        );
        res.json(result.rows[0]);
    } catch (err) { res.status(500).json({ error: err.message }); }
});
app.delete('/api/accreditations/:id', apiAuth, roleRequired('super_admin'), async (req, res) => {
    try { await pool.query('DELETE FROM accreditations WHERE id = $1', [req.params.id]); res.json({ success: true }); }
    catch (err) { res.status(500).json({ error: 'Server error' }); }
});

// Hospital → Specialties junction
app.get('/api/hospitals/:id/specialties', apiAuth, async (req, res) => {
    try {
        const result = await pool.query(
            `SELECT s.* FROM specialties s JOIN hospital_specialties hs ON s.id = hs.specialty_id WHERE hs.hospital_id = $1 ORDER BY s.name`, [req.params.id]);
        res.json(result.rows);
    } catch (err) { res.json([]); }
});
app.put('/api/hospitals/:id/specialties', apiAuth, roleRequired('super_admin', 'editor'), async (req, res) => {
    try {
        const { specialty_ids } = req.body;
        await pool.query('DELETE FROM hospital_specialties WHERE hospital_id = $1', [req.params.id]);
        if (specialty_ids && specialty_ids.length > 0) {
            const values = specialty_ids.map((sid, i) => `($1, $${i+2})`).join(',');
            await pool.query(`INSERT INTO hospital_specialties (hospital_id, specialty_id) VALUES ${values}`, [req.params.id, ...specialty_ids]);
        }
        res.json({ success: true });
    } catch (err) { res.status(500).json({ error: err.message }); }
});

// Hospital → Accreditations junction
app.get('/api/hospitals/:id/accreditations', apiAuth, async (req, res) => {
    try {
        const result = await pool.query(
            `SELECT a.* FROM accreditations a JOIN hospital_accreditations ha ON a.id = ha.accreditation_id WHERE ha.hospital_id = $1 ORDER BY a.name`, [req.params.id]);
        res.json(result.rows);
    } catch (err) { res.json([]); }
});
app.put('/api/hospitals/:id/accreditations', apiAuth, roleRequired('super_admin', 'editor'), async (req, res) => {
    try {
        const { accreditation_ids } = req.body;
        await pool.query('DELETE FROM hospital_accreditations WHERE hospital_id = $1', [req.params.id]);
        if (accreditation_ids && accreditation_ids.length > 0) {
            const values = accreditation_ids.map((aid, i) => `($1, $${i+2})`).join(',');
            await pool.query(`INSERT INTO hospital_accreditations (hospital_id, accreditation_id) VALUES ${values}`, [req.params.id, ...accreditation_ids]);
        }
        res.json({ success: true });
    } catch (err) { res.status(500).json({ error: err.message }); }
});


};
