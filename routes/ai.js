const path = require('path');
const fs = require('fs');
const multer = require('multer');

module.exports = function(app, pool, { authRequired, apiAuth, roleRequired, logActivity, servePage, rootDir }) {

// Upload directory helper (same as media.js)
function getUploadDir() {
    const now = new Date();
    const year = now.getFullYear().toString();
    const month = (now.getMonth() + 1).toString().padStart(2, '0');
    const subdir = path.join('uploads', year, month);
    const fullPath = path.join(rootDir, subdir);
    if (!fs.existsSync(fullPath)) fs.mkdirSync(fullPath, { recursive: true });
    return { subdir, fullPath };
}

const storage = multer.diskStorage({
    destination: (req, file, cb) => { const { fullPath } = getUploadDir(); cb(null, fullPath); },
    filename: (req, file, cb) => {
        const ext = path.extname(file.originalname).toLowerCase();
        const base = path.basename(file.originalname, ext).toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').substring(0, 80) || 'file';
        cb(null, base + '-' + Date.now().toString(36) + ext);
    }
});
const docUpload = multer({ storage, limits: { fileSize: 20 * 1024 * 1024 }, fileFilter: (req, file, cb) => {
    const allowed = /docx|doc|txt|md/;
    cb(null, allowed.test(path.extname(file.originalname).toLowerCase()));
}});

// ============== CLAUDE AI ASSISTANT ==============
app.get('/ai-assistant', authRequired, roleRequired('super_admin', 'editor'), (req, res) => {
    servePage(res, 'ai-assistant');
});

// ============== DOCX IMPORT ==============
const mammoth = require('mammoth');

// Style map: Word heading levels → h2/h3 (H1 reserved for page title on public site)
// Tables come through natively from mammoth — no entry needed here
const MAMMOTH_STYLE_MAP = [
    "p[style-name='Heading 1'] => h2:fresh",
    "p[style-name='Heading 2'] => h2:fresh",
    "p[style-name='Heading 3'] => h3:fresh",
    "p[style-name='Heading 4'] => h3:fresh",
    "p[style-name='Heading 5'] => h3:fresh",
    "p[style-name='Heading 6'] => h3:fresh",
    "p[style-name='heading 1'] => h2:fresh",
    "p[style-name='heading 2'] => h2:fresh",
    "p[style-name='heading 3'] => h3:fresh",
].join('\n');

// Post-process: add .ginger-table class + .table-wrap responsive div, clean empty paragraphs
function postProcessHtml(html) {
    html = html.replace(/<table>/g,   '<div class="table-wrap"><table class="ginger-table">');
    html = html.replace(/<table /g,   '<div class="table-wrap"><table class="ginger-table" ');
    html = html.replace(/<\/table>/g, '<\/table><\/div>');
    html = html.replace(/<p><\/p>/g, '');
    html = html.replace(/<p>\s*<\/p>/g, '');
    html = html.replace(/<p>&nbsp;<\/p>/gi, '');
    html = html.replace(/(<br\s*\/?>\s*){3,}/gi, '<br>');
    return html;
}

// POST /api/import/docx — Import .docx with images converted to uploaded files
app.post('/api/import/docx', apiAuth, roleRequired('super_admin', 'editor'), docUpload.single('file'), async (req, res) => {
    try {
        if (!req.file) return res.status(400).json({ error: 'No file uploaded' });
        const filePath = req.file.path;
        let imageCount = 0;

        const result = await mammoth.convertToHtml(
            { path: filePath },
            {
                styleMap: MAMMOTH_STYLE_MAP,
                convertImage: mammoth.images.imgElement(async function(image) {
                    try {
                        const imageBuffer = await image.read();
                        const ext = image.contentType === 'image/png' ? '.png' : image.contentType === 'image/gif' ? '.gif' : '.jpg';
                        const filename = 'docx-import-' + Date.now() + '-' + (++imageCount) + ext;

                        // Save to uploads folder using same year/month structure
                        const now = new Date();
                        const year = now.getFullYear().toString();
                        const month = String(now.getMonth() + 1).padStart(2, '0');
                        const subdir = path.join('uploads', year, month);
                        const fs = require('fs');
                        if (!fs.existsSync(subdir)) fs.mkdirSync(subdir, { recursive: true });

                        const savePath = path.join(subdir, filename);
                        fs.writeFileSync(savePath, imageBuffer);

                        // Process with sharp if it's an image
                        let width = null, height = null, sizes = {};
                        try {
                            const sharp = require('sharp');
                            const meta = await sharp(imageBuffer).metadata();
                            width = meta.width;
                            height = meta.height;

                            // Generate thumbnail
                            const thumbName = filename.replace(/\.[^.]+$/, '-150x150' + ext);
                            await sharp(imageBuffer).resize(150, 150, { fit: 'cover' }).toFile(path.join(subdir, thumbName));
                            sizes.thumbnail = { url: '/' + subdir.replace(/\\/g,'/') + '/' + thumbName, width: 150, height: 150 };

                            // Generate medium
                            if (width > 300) {
                                const medName = filename.replace(/\.[^.]+$/, '-300x0' + ext);
                                await sharp(imageBuffer).resize(300, null).toFile(path.join(subdir, medName));
                                sizes.medium = { url: '/' + subdir.replace(/\\/g,'/') + '/' + medName, width: 300 };
                            }
                        } catch(sharpErr) {}

                        const url = '/' + savePath.replace(/\\/g, '/');

                        // Save to DB
                        await pool.query(
                            'INSERT INTO media (filename, original_name, mime_type, size, url, width, height, sizes, folder, uploaded_by) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)',
                            [filename, filename, image.contentType, imageBuffer.length, url, width, height, JSON.stringify(sizes), year + '/' + month, req.user.id]
                        );

                        return { src: url };
                    } catch(imgErr) {
                        console.error('Docx image error:', imgErr.message);
                        return { src: '' };
                    }
                })
            }
        );

        // Clean up uploaded docx file
        try { require('fs').unlinkSync(filePath); } catch(e) {}

        const html = postProcessHtml(result.value);
        res.json({ html, imageCount, messages: result.messages });
    } catch (err) {
        console.error('Docx import error:', err.message);
        res.status(500).json({ error: err.message });
    }
});

// POST /api/import/docx-text — Extract plain text from .docx (for AI context)
app.post('/api/import/docx-text', apiAuth, roleRequired('super_admin', 'editor'), docUpload.single('file'), async (req, res) => {
    try {
        if (!req.file) return res.status(400).json({ error: 'No file uploaded' });
        const result = await mammoth.extractRawText({ path: req.file.path });
        try { require('fs').unlinkSync(req.file.path); } catch(e) {}
        res.json({ text: result.value });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

app.post('/api/ai/generate', apiAuth, roleRequired('super_admin', 'editor'), async (req, res) => {
    try {
        const { prompt, type, context } = req.body;

        const systemPrompts = {
            blog: "You are a medical tourism content writer for Ginger Healthcare. Write engaging, informative, SEO-friendly blog posts. Use a warm, professional tone. Include relevant medical details but keep language accessible. Format in HTML for a blog post.",
            testimonial: "You are helping create realistic patient testimonial templates for Ginger Healthcare. Make them sound authentic, emotional, and specific about the medical tourism experience. Include details about savings, hospital quality, and care.",
            hospital: "You are writing hospital descriptions for Ginger Healthcare. Focus on accreditations, specialties, facilities, and what makes each hospital stand out for international patients.",
            doctor: "You are writing doctor profiles for Ginger Healthcare. Highlight qualifications, experience, specialties, and patient care philosophy.",
            page: "You are a copywriter for Ginger Healthcare's website. Write compelling, conversion-focused copy for medical tourism pages.",
            general: "You are an AI assistant for Ginger Healthcare's admin team. Help with content creation, editing, SEO optimization, and medical tourism industry knowledge."
        };

        const { Anthropic } = require('@anthropic-ai/sdk');
        const client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });

        const message = await client.messages.create({
            model: "claude-sonnet-4-20250514",
            max_tokens: 16000,
            system: systemPrompts[type] || systemPrompts.general,
            messages: [
                { role: "user", content: context ? `Context: ${context}\n\nRequest: ${prompt}` : prompt }
            ]
        });

        const responseText = message.content[0].text;
        const wasTruncated = message.stop_reason === 'max_tokens';
        if (wasTruncated) console.warn('[AI] Response hit max_tokens limit. Input prompt chars:', prompt.length);
        await logActivity(req.user.id, 'ai_generate', 'ai', null, `Type: ${type}, Prompt: ${prompt.substring(0, 100)}`);
        res.json({ content: responseText, truncated: wasTruncated });
    } catch (err) {
        console.error('Claude API error:', err);

        // Human-friendly messages for common Anthropic API errors
        const msg = err.message || '';
        let friendly = 'AI generation failed. Please try again.';

        if (!process.env.ANTHROPIC_API_KEY) {
            friendly = 'ANTHROPIC_API_KEY is not set. Add it to your Render environment variables.';
        } else if (msg.includes('529') || msg.toLowerCase().includes('overloaded')) {
            friendly = 'Claude is temporarily busy. Please wait 30 seconds and try again.';
        } else if (msg.includes('401') || msg.toLowerCase().includes('authentication')) {
            friendly = 'AI authentication failed. Check that ANTHROPIC_API_KEY is correct in Render.';
        } else if (msg.includes('429') || msg.toLowerCase().includes('rate limit')) {
            friendly = 'AI rate limit reached. Please wait a moment and try again.';
        } else if (msg.includes('400')) {
            friendly = 'Content may be too long for AI. Try with a shorter selection.';
        } else if (msg.match(/5[0-9]{2}/)) {
            friendly = 'Anthropic API is temporarily unavailable. Please try again in a minute.';
        }

        res.status(500).json({ error: friendly });
    }
});


};
