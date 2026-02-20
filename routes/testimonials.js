module.exports = function(app, pool, { authRequired, apiAuth, roleRequired, logActivity, servePage }) {

// ============== TESTIMONIALS CRUD ==============
app.get('/testimonials', authRequired, (req, res) => {
    servePage(res, 'testimonials');
});

app.get('/testimonial-studio', authRequired, (req, res) => {
    servePage(res, 'testimonial-studio');
});
app.get('/testimonial-studio/edit/:id', authRequired, (req, res) => {
    servePage(res, 'testimonial-studio');
});

app.get('/api/testimonials', apiAuth, async (req, res) => {
    try {
        const result = await pool.query('SELECT * FROM testimonials ORDER BY created_at DESC');
        res.json(result.rows);
    } catch (err) { res.status(500).json({ error: 'Server error' }); }
});

app.post('/api/testimonials', apiAuth, roleRequired('super_admin', 'editor'), async (req, res) => {
    try {
        const { patient_name, patient_country, patient_flag, treatment, specialty, destination, rating, quote, avatar_color, is_featured, status, title, source, images, treatment_date, google_review_id, google_review_date, google_review_url, doctor_id, hospital_id, specialty_id, treatment_id, patient_image } = req.body;
        let slug = req.body.slug;
        if (!slug) {
            const parts = [patient_name, treatment || specialty || '', destination || ''].filter(Boolean);
            slug = parts.join(' ').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/(^-|-$)/g, '');
        }
        const exists = await pool.query('SELECT id FROM testimonials WHERE slug = $1', [slug]);
        if (exists.rows.length) slug = slug + '-' + Date.now().toString(36).slice(-4);
        const result = await pool.query(
            `INSERT INTO testimonials (patient_name, patient_country, patient_flag, treatment, specialty, destination, rating, quote, avatar_color, is_featured, status, title, source, images, treatment_date, google_review_id, google_review_date, google_review_url, doctor_id, hospital_id, specialty_id, treatment_id, slug, patient_image)
             VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,$20,$21,$22,$23,$24) RETURNING *`,
            [patient_name, patient_country, patient_flag, treatment||'', specialty||'', destination||'', rating || 5, quote, avatar_color, is_featured || false, status || 'draft', title||null, source||'patient_direct', images||null, treatment_date||null, google_review_id||null, google_review_date||null, google_review_url||null, doctor_id||null, hospital_id||null, specialty_id||null, treatment_id||null, slug, patient_image||null]
        );
        await logActivity(req.user.id, 'create', 'testimonial', result.rows[0].id, `Created testimonial: ${patient_name}`);
        res.json(result.rows[0]);
    } catch (err) { res.status(500).json({ error: err.message }); }
});

app.put('/api/testimonials/:id', apiAuth, roleRequired('super_admin', 'editor'), async (req, res) => {
    try {
        const { patient_name, patient_country, patient_flag, treatment, specialty, destination, rating, quote, avatar_color, is_featured, status, title, source, images, treatment_date, google_review_id, google_review_date, google_review_url, doctor_id, hospital_id, specialty_id, treatment_id, patient_image } = req.body;
        let slug = req.body.slug;
        if (!slug) {
            const existing = await pool.query('SELECT slug FROM testimonials WHERE id = $1', [req.params.id]);
            slug = existing.rows[0]?.slug;
        }
        if (!slug) {
            const parts = [patient_name, treatment || specialty || '', destination || ''].filter(Boolean);
            slug = parts.join(' ').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/(^-|-$)/g, '');
            const exists = await pool.query('SELECT id FROM testimonials WHERE slug = $1 AND id != $2', [slug, req.params.id]);
            if (exists.rows.length) slug = slug + '-' + Date.now().toString(36).slice(-4);
        }
        const result = await pool.query(
            `UPDATE testimonials SET patient_name=$1, patient_country=$2, patient_flag=$3, treatment=$4, specialty=$5, destination=$6, rating=$7, quote=$8, avatar_color=$9, is_featured=$10, status=$11, title=$12, source=$13, images=$14, treatment_date=$15, google_review_id=$16, google_review_date=$17, google_review_url=$18, doctor_id=$19, hospital_id=$20, specialty_id=$21, treatment_id=$22, slug=$23, patient_image=$24, updated_at=NOW()
             WHERE id=$25 RETURNING *`,
            [patient_name, patient_country, patient_flag, treatment||'', specialty||'', destination||'', rating, quote, avatar_color, is_featured, status, title||null, source||'patient_direct', images||null, treatment_date||null, google_review_id||null, google_review_date||null, google_review_url||null, doctor_id||null, hospital_id||null, specialty_id||null, treatment_id||null, slug, patient_image||null, req.params.id]
        );
        await logActivity(req.user.id, 'update', 'testimonial', req.params.id, `Updated: ${patient_name}`);
        res.json(result.rows[0]);
    } catch (err) { res.status(500).json({ error: err.message }); }
});

app.post('/api/testimonials/bulk', apiAuth, roleRequired('super_admin', 'editor'), async (req, res) => {
    try {
        const { ids, action } = req.body;
        if (!ids || !ids.length) return res.status(400).json({ error: 'No items selected' });
        let count = 0;
        if (action === 'delete') {
            if (req.user.role !== 'super_admin') return res.status(403).json({ error: 'Only admins can delete' });
            const result = await pool.query('DELETE FROM testimonials WHERE id = ANY($1) RETURNING id', [ids]);
            count = result.rowCount; await logActivity(req.user.id, 'bulk_delete', 'testimonial', null, `Bulk deleted ${count} testimonials`);
        } else if (action === 'publish') {
            const result = await pool.query("UPDATE testimonials SET status='published', updated_at=NOW() WHERE id = ANY($1) RETURNING id", [ids]);
            count = result.rowCount; await logActivity(req.user.id, 'bulk_publish', 'testimonial', null, `Bulk published ${count} testimonials`);
        } else if (action === 'draft') {
            const result = await pool.query("UPDATE testimonials SET status='draft', updated_at=NOW() WHERE id = ANY($1) RETURNING id", [ids]);
            count = result.rowCount; await logActivity(req.user.id, 'bulk_draft', 'testimonial', null, `Bulk set ${count} testimonials to draft`);
        } else { return res.status(400).json({ error: 'Invalid action' }); }
        res.json({ success: true, count });
    } catch (err) { res.status(500).json({ error: err.message }); }
});

app.delete('/api/testimonials/:id', apiAuth, roleRequired('super_admin'), async (req, res) => {
    try {
        await pool.query('DELETE FROM testimonials WHERE id = $1', [req.params.id]);
        await logActivity(req.user.id, 'delete', 'testimonial', parseInt(req.params.id), 'Deleted testimonial');
        res.json({ success: true });
    } catch (err) { res.status(500).json({ error: 'Server error' }); }
});


};
