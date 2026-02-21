const multer = require('multer');
const path = require('path');
const fs = require('fs');

module.exports = function(app, pool, { authRequired, apiAuth, roleRequired, logActivity, servePage, rootDir }) {

// ============== MEDIA UPLOAD ==============
app.get('/media', authRequired, (req, res) => {
    servePage(res, 'media');
});

// ============== WORDPRESS-STYLE MEDIA SYSTEM ==============
// sharp is optional — image resizing degrades gracefully if not installed
let sharp = null;
try { sharp = require('sharp'); } catch(e) {
    console.warn('[media.js] sharp not installed — image subsizes/WebP will be skipped. Run: npm install sharp');
}

// Image sizes (like WordPress registered sizes)
const IMAGE_SIZES = {
    thumbnail: { width: 150, height: 150, crop: true },
    medium:    { width: 400, height: 400, crop: false },
    medium_large: { width: 768, height: 768, crop: false },
    large:     { width: 1200, height: 1200, crop: false }
};

// Get year/month upload directory (like WordPress /uploads/2026/02/)
function getUploadDir() {
    const now = new Date();
    const year = now.getFullYear().toString();
    const month = (now.getMonth() + 1).toString().padStart(2, '0');
    const subdir = path.join('uploads', year, month);
    const fullPath = path.join(rootDir, subdir);
    if (!fs.existsSync(fullPath)) fs.mkdirSync(fullPath, { recursive: true });
    return { subdir, fullPath };
}

// Sanitize filename (WordPress-style)
function sanitizeFilename(originalName) {
    const ext = path.extname(originalName).toLowerCase();
    let base = path.basename(originalName, path.extname(originalName))
        .toLowerCase()
        .replace(/['']/g, '')
        .replace(/[^a-z0-9]+/g, '-')
        .replace(/^-|-$/g, '')
        .substring(0, 80);
    if (!base) base = 'file';
    return { base, ext };
}

// Generate unique filename in directory (WordPress-style incrementing)
function uniqueFilename(dir, base, ext) {
    let finalName = base + ext;
    let counter = 1;
    while (fs.existsSync(path.join(dir, finalName))) {
        finalName = base + '-' + counter + ext;
        counter++;
    }
    return finalName;
}

// Generate image subsizes + WebP versions (like wp_create_image_subsizes)
async function createImageSubsizes(filePath, dir, base, ext) {
    if (!sharp) return { width: null, height: null, sizes: {} }; // sharp not installed
    const sizes = {};
    try {
        const image = sharp(filePath);
        const metadata = await image.metadata();

        // 1. Compress original (if JPEG/PNG, reduce quality)
        if (/\.(jpg|jpeg)$/i.test(ext)) {
            try {
                await sharp(filePath).jpeg({ quality: 82, progressive: true }).toFile(filePath + '.tmp');
                fs.renameSync(filePath + '.tmp', filePath);
            } catch(e) { /* keep original if compression fails */ }
        } else if (/\.png$/i.test(ext)) {
            try {
                await sharp(filePath).png({ quality: 85, compressionLevel: 8 }).toFile(filePath + '.tmp');
                fs.renameSync(filePath + '.tmp', filePath);
            } catch(e) { /* keep original */ }
        }

        // 2. Generate WebP of original (full size)
        try {
            const webpName = `${base}.webp`;
            const webpPath = path.join(dir, webpName);
            const webpInfo = await sharp(filePath).webp({ quality: 80 }).toFile(webpPath);
            sizes['full_webp'] = { file: webpName, width: webpInfo.width, height: webpInfo.height, size: webpInfo.size };
        } catch(e) { console.error('WebP full error:', e.message); }

        // 3. Generate each size in original format + WebP
        for (const [sizeName, sizeConfig] of Object.entries(IMAGE_SIZES)) {
            if (metadata.width <= sizeConfig.width && metadata.height <= sizeConfig.height) continue;

            const resizeOpts = sizeConfig.crop
                ? { width: sizeConfig.width, height: sizeConfig.height, fit: 'cover', position: 'centre' }
                : { width: sizeConfig.width, height: sizeConfig.height, fit: 'inside', withoutEnlargement: true };

            // Original format
            const sizeFilename = `${base}-${sizeConfig.width}x${sizeConfig.height}${ext}`;
            const sizePath = path.join(dir, sizeFilename);
            try {
                let resizer = sharp(filePath).resize(resizeOpts);
                if (/\.(jpg|jpeg)$/i.test(ext)) resizer = resizer.jpeg({ quality: 82, progressive: true });
                else if (/\.png$/i.test(ext)) resizer = resizer.png({ quality: 85, compressionLevel: 8 });
                const info = await resizer.toFile(sizePath);
                sizes[sizeName] = { file: sizeFilename, width: info.width, height: info.height, size: info.size };
            } catch(e) { console.error(`Failed to create ${sizeName}:`, e.message); }

            // WebP version
            const webpSizeName = `${base}-${sizeConfig.width}x${sizeConfig.height}.webp`;
            const webpSizePath = path.join(dir, webpSizeName);
            try {
                const webpInfo = await sharp(filePath).resize(resizeOpts).webp({ quality: 78 }).toFile(webpSizePath);
                sizes[`${sizeName}_webp`] = { file: webpSizeName, width: webpInfo.width, height: webpInfo.height, size: webpInfo.size };
            } catch(e) { console.error(`Failed to create ${sizeName} WebP:`, e.message); }
        }

        return { width: metadata.width, height: metadata.height, sizes };
    } catch(e) {
        console.error('Image processing error:', e.message);
        return { width: null, height: null, sizes: {} };
    }
}

// Multer storage with year/month directories
const storage = multer.diskStorage({
    destination: (req, file, cb) => {
        const { fullPath } = getUploadDir();
        cb(null, fullPath);
    },
    filename: (req, file, cb) => {
        const { base, ext } = sanitizeFilename(file.originalname);
        const { fullPath } = getUploadDir();
        cb(null, uniqueFilename(fullPath, base, ext));
    }
});
const upload = multer({ storage, limits: { fileSize: 10 * 1024 * 1024 }, fileFilter: (req, file, cb) => {
    const allowed = /jpeg|jpg|png|gif|webp|svg|pdf/;
    cb(null, allowed.test(path.extname(file.originalname).toLowerCase()));
}});

// Separate multer for document imports (accepts docx, doc, txt)
const docUpload = multer({ storage, limits: { fileSize: 20 * 1024 * 1024 }, fileFilter: (req, file, cb) => {
    const allowed = /docx|doc|txt|md/;
    cb(null, allowed.test(path.extname(file.originalname).toLowerCase()));
}});

// GET /api/media — List all media
app.get('/api/media', apiAuth, async (req, res) => {
    try {
        const result = await pool.query('SELECT * FROM media ORDER BY created_at DESC');
        res.json(result.rows);
    } catch (err) { res.status(500).json({ error: 'Server error' }); }
});

// POST /api/media/upload — Upload with auto-processing (like WordPress)
app.post('/api/media/upload', apiAuth, roleRequired('super_admin', 'editor'), upload.single('file'), async (req, res) => {
    try {
        if (!req.file) return res.status(400).json({ error: 'No file uploaded' });
        const { subdir } = getUploadDir();
        const url = `/${subdir}/${req.file.filename}`;
        const filePath = req.file.path;
        const isImage = /\.(jpg|jpeg|png|gif|webp)$/i.test(req.file.filename);
        // Auto-title from filename (like WordPress)
        const autoTitle = path.basename(req.file.originalname, path.extname(req.file.originalname))
            .replace(/[-_]+/g, ' ').replace(/\b\w/g, c => c.toUpperCase());

        let width = null, height = null, sizes = {};
        if (isImage) {
            const imgData = await createImageSubsizes(filePath, path.join(rootDir, subdir),
                path.basename(req.file.filename, path.extname(req.file.filename)), path.extname(req.file.filename));
            width = imgData.width;
            height = imgData.height;
            for (const [key, val] of Object.entries(imgData.sizes)) {
                sizes[key] = { ...val, url: `/${subdir}/${val.file}` };
            }
        }
        const result = await pool.query(
            `INSERT INTO media (filename, original_name, mime_type, size, url, alt_text, title, width, height, sizes, folder, uploaded_by)
             VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12) RETURNING *`,
            [req.file.filename, req.file.originalname, req.file.mimetype, req.file.size, url,
             '', autoTitle, width, height, JSON.stringify(sizes), req.body.folder || 'general', req.user.id]
        );
        await logActivity(req.user.id, 'upload', 'media', result.rows[0].id, `Uploaded: ${req.file.originalname}`);
        res.json(result.rows[0]);
    } catch (err) { res.status(500).json({ error: err.message }); }
});

// PUT /api/media/:id — Update metadata (alt, title, caption, description)
app.put('/api/media/:id', apiAuth, roleRequired('super_admin', 'editor'), async (req, res) => {
    try {
        const { alt_text, title, caption, description } = req.body;
        const result = await pool.query(
            `UPDATE media SET alt_text = COALESCE($1, alt_text), title = COALESCE($2, title),
             caption = COALESCE($3, caption), description = COALESCE($4, description)
             WHERE id = $5 RETURNING *`,
            [alt_text, title, caption, description, req.params.id]
        );
        if (result.rows.length === 0) return res.status(404).json({ error: 'Not found' });
        res.json(result.rows[0]);
    } catch (err) { res.status(500).json({ error: err.message }); }
});

// POST /api/media/:id/optimize — Reprocess a single image (generate missing sizes + WebP)
app.post('/api/media/:id/optimize', apiAuth, roleRequired('super_admin'), async (req, res) => {
    try {
        const result = await pool.query('SELECT * FROM media WHERE id = $1', [req.params.id]);
        if (result.rows.length === 0) return res.status(404).json({ error: 'Not found' });
        const media = result.rows[0];
        if (!media.mime_type || !media.mime_type.startsWith('image/') || /svg/i.test(media.mime_type)) {
            return res.json({ skipped: true, reason: 'Not a raster image' });
        }
        const filePath = path.join(rootDir, media.url);
        if (!fs.existsSync(filePath)) return res.status(404).json({ error: 'File not found on disk' });

        const dir = path.dirname(filePath);
        const ext = path.extname(media.filename);
        const base = path.basename(media.filename, ext);
        const imgData = await createImageSubsizes(filePath, dir, base, ext);

        const subdir = path.dirname(media.url);
        const sizes = {};
        for (const [key, val] of Object.entries(imgData.sizes)) {
            sizes[key] = { ...val, url: `${subdir}/${val.file}` };
        }
        await pool.query('UPDATE media SET sizes = $1, width = $2, height = $3 WHERE id = $4',
            [JSON.stringify(sizes), imgData.width, imgData.height, media.id]);

        const originalSize = fs.statSync(filePath).size;
        const webpSize = sizes.full_webp ? sizes.full_webp.size : null;
        const savings = webpSize ? Math.round((1 - webpSize / originalSize) * 100) : 0;

        res.json({ success: true, id: media.id, sizes: Object.keys(sizes).length, savings: savings + '% WebP savings' });
    } catch(e) { res.status(500).json({ error: e.message }); }
});

// POST /api/media/optimize-all — Bulk optimize all images (super_admin only)
app.post('/api/media/optimize-all', apiAuth, roleRequired('super_admin'), async (req, res) => {
    try {
        const result = await pool.query("SELECT * FROM media WHERE mime_type LIKE 'image/%' AND mime_type != 'image/svg+xml' ORDER BY id");
        const images = result.rows;
        let processed = 0, skipped = 0, errors = 0, totalSaved = 0;

        for (const media of images) {
            const filePath = path.join(rootDir, media.url);
            if (!fs.existsSync(filePath)) { skipped++; continue; }

            // Skip if already has WebP sizes
            const existingSizes = typeof media.sizes === 'string' ? JSON.parse(media.sizes || '{}') : (media.sizes || {});
            if (existingSizes.full_webp) { skipped++; continue; }

            const dir = path.dirname(filePath);
            const ext = path.extname(media.filename);
            const base = path.basename(media.filename, ext);

            try {
                const originalSize = fs.statSync(filePath).size;
                const imgData = await createImageSubsizes(filePath, dir, base, ext);
                const subdir = path.dirname(media.url);
                const sizes = {};
                for (const [key, val] of Object.entries(imgData.sizes)) {
                    sizes[key] = { ...val, url: `${subdir}/${val.file}` };
                }
                await pool.query('UPDATE media SET sizes = $1, width = $2, height = $3 WHERE id = $4',
                    [JSON.stringify(sizes), imgData.width, imgData.height, media.id]);

                const newSize = fs.statSync(filePath).size;
                totalSaved += (originalSize - newSize);
                processed++;
            } catch(e) { errors++; console.error(`Optimize ${media.id} error:`, e.message); }
        }

        res.json({
            success: true, total: images.length, processed, skipped, errors,
            totalSavedMB: (totalSaved / 1024 / 1024).toFixed(2) + ' MB'
        });
    } catch(e) { res.status(500).json({ error: e.message }); }
});

// DELETE /api/media/:id — Delete file + all subsizes
app.delete('/api/media/:id', apiAuth, roleRequired('super_admin'), async (req, res) => {
    try {
        const file = await pool.query('SELECT * FROM media WHERE id = $1', [req.params.id]);
        if (file.rows.length > 0) {
            const filePath = path.join(rootDir, file.rows[0].url);
            if (fs.existsSync(filePath)) fs.unlinkSync(filePath);
            const sizes = file.rows[0].sizes || {};
            for (const sizeData of Object.values(sizes)) {
                if (sizeData.url) {
                    const sizePath = path.join(rootDir, sizeData.url);
                    if (fs.existsSync(sizePath)) fs.unlinkSync(sizePath);
                }
            }
            await pool.query('DELETE FROM media WHERE id = $1', [req.params.id]);
            await logActivity(req.user.id, 'delete', 'media', parseInt(req.params.id), `Deleted: ${file.rows[0].original_name}`);
        }
        res.json({ success: true });
    } catch (err) { res.status(500).json({ error: 'Server error' }); }
});



};
