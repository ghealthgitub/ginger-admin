const { Pool } = require('pg');

const pool = new Pool({
    connectionString: process.env.DATABASE_URL,
    ssl: process.env.NODE_ENV === 'production' ? { rejectUnauthorized: false } : false
});

// Initialize all tables
async function initDB() {
    const client = await pool.connect();
    try {
        await client.query(`

            -- USERS & ROLES
            CREATE TABLE IF NOT EXISTS users (
                id SERIAL PRIMARY KEY,
                name VARCHAR(100) NOT NULL,
                email VARCHAR(255) UNIQUE NOT NULL,
                password VARCHAR(255) NOT NULL,
                role VARCHAR(20) DEFAULT 'editor' CHECK (role IN ('super_admin', 'editor', 'viewer')),
                avatar VARCHAR(500),
                is_active BOOLEAN DEFAULT true,
                last_login TIMESTAMP,
                created_at TIMESTAMP DEFAULT NOW(),
                updated_at TIMESTAMP DEFAULT NOW()
            );

            -- BLOG POSTS
            CREATE TABLE IF NOT EXISTS blog_posts (
                id SERIAL PRIMARY KEY,
                title VARCHAR(500) NOT NULL,
                slug VARCHAR(500) UNIQUE NOT NULL,
                excerpt TEXT,
                content TEXT,
                cover_image VARCHAR(500),
                category VARCHAR(100),
                tags TEXT[],
                status VARCHAR(20) DEFAULT 'draft' CHECK (status IN ('draft', 'published', 'archived')),
                read_time INTEGER,
                author_id INTEGER REFERENCES users(id),
                meta_title VARCHAR(500),
                meta_description TEXT,
                focus_keywords TEXT,
                published_at TIMESTAMP,
                created_at TIMESTAMP DEFAULT NOW(),
                updated_at TIMESTAMP DEFAULT NOW()
            );

            -- TESTIMONIALS
            CREATE TABLE IF NOT EXISTS testimonials (
                id SERIAL PRIMARY KEY,
                patient_name VARCHAR(200) NOT NULL,
                patient_country VARCHAR(100),
                patient_flag VARCHAR(10),
                treatment VARCHAR(200),
                specialty VARCHAR(200),
                destination VARCHAR(100),
                rating INTEGER DEFAULT 5 CHECK (rating >= 1 AND rating <= 5),
                quote TEXT NOT NULL,
                avatar_color VARCHAR(50),
                is_featured BOOLEAN DEFAULT false,
                status VARCHAR(20) DEFAULT 'draft' CHECK (status IN ('draft', 'published', 'archived')),
                created_at TIMESTAMP DEFAULT NOW(),
                updated_at TIMESTAMP DEFAULT NOW()
            );

            -- HOSPITALS
            CREATE TABLE IF NOT EXISTS hospitals (
                id SERIAL PRIMARY KEY,
                name VARCHAR(300) NOT NULL,
                slug VARCHAR(300) UNIQUE NOT NULL,
                country VARCHAR(100) NOT NULL,
                city VARCHAR(100),
                address TEXT,
                description TEXT,
                long_description TEXT,
                accreditations TEXT[],
                specialties TEXT[],
                beds INTEGER,
                established INTEGER,
                image VARCHAR(500),
                gallery TEXT[],
                rating DECIMAL(2,1),
                is_featured BOOLEAN DEFAULT false,
                status VARCHAR(20) DEFAULT 'draft' CHECK (status IN ('draft', 'published', 'archived')),
                created_at TIMESTAMP DEFAULT NOW(),
                updated_at TIMESTAMP DEFAULT NOW()
            );

            -- DOCTORS
            CREATE TABLE IF NOT EXISTS doctors (
                id SERIAL PRIMARY KEY,
                name VARCHAR(200) NOT NULL,
                slug VARCHAR(200) UNIQUE NOT NULL,
                title VARCHAR(100),
                specialty VARCHAR(200),
                hospital_id INTEGER REFERENCES hospitals(id),
                country VARCHAR(100),
                experience_years INTEGER,
                qualifications TEXT[],
                description TEXT,
                long_description TEXT,
                image VARCHAR(500),
                languages TEXT[],
                is_featured BOOLEAN DEFAULT false,
                status VARCHAR(20) DEFAULT 'draft' CHECK (status IN ('draft', 'published', 'archived')),
                created_at TIMESTAMP DEFAULT NOW(),
                updated_at TIMESTAMP DEFAULT NOW()
            );

            -- FORM SUBMISSIONS
            CREATE TABLE IF NOT EXISTS submissions (
                id SERIAL PRIMARY KEY,
                form_type VARCHAR(50) NOT NULL CHECK (form_type IN ('quote', 'consultation', 'contact', 'partner', 'career')),
                name VARCHAR(200),
                email VARCHAR(255),
                phone VARCHAR(50),
                country VARCHAR(100),
                treatment VARCHAR(200),
                message TEXT,
                form_data JSONB,
                status VARCHAR(20) DEFAULT 'new' CHECK (status IN ('new', 'in_progress', 'responded', 'closed')),
                notes TEXT,
                assigned_to INTEGER REFERENCES users(id),
                created_at TIMESTAMP DEFAULT NOW(),
                updated_at TIMESTAMP DEFAULT NOW()
            );

            -- PAGE CONTENT (key-value store for editable content)
            CREATE TABLE IF NOT EXISTS page_content (
                id SERIAL PRIMARY KEY,
                page VARCHAR(100) NOT NULL,
                section VARCHAR(100) NOT NULL,
                field_key VARCHAR(100) NOT NULL,
                field_value TEXT,
                field_type VARCHAR(50) DEFAULT 'text' CHECK (field_type IN ('text', 'number', 'html', 'image', 'json')),
                updated_by INTEGER REFERENCES users(id),
                created_at TIMESTAMP DEFAULT NOW(),
                updated_at TIMESTAMP DEFAULT NOW(),
                UNIQUE(page, section, field_key)
            );

            -- MEDIA LIBRARY
            CREATE TABLE IF NOT EXISTS media (
                id SERIAL PRIMARY KEY,
                filename VARCHAR(500) NOT NULL,
                original_name VARCHAR(500),
                mime_type VARCHAR(100),
                size INTEGER,
                url VARCHAR(1000) NOT NULL,
                alt_text VARCHAR(500),
                title VARCHAR(500),
                caption TEXT,
                description TEXT,
                width INTEGER,
                height INTEGER,
                sizes JSONB DEFAULT '{}',
                folder VARCHAR(200) DEFAULT 'general',
                uploaded_by INTEGER REFERENCES users(id),
                created_at TIMESTAMP DEFAULT NOW()
            );

            -- ACTIVITY LOG
            CREATE TABLE IF NOT EXISTS activity_log (
                id SERIAL PRIMARY KEY,
                user_id INTEGER REFERENCES users(id),
                action VARCHAR(100) NOT NULL,
                entity_type VARCHAR(50),
                entity_id INTEGER,
                details TEXT,
                created_at TIMESTAMP DEFAULT NOW()
            );

            -- SPECIALTIES
            CREATE TABLE IF NOT EXISTS specialties (
                id SERIAL PRIMARY KEY,
                name VARCHAR(200) NOT NULL,
                slug VARCHAR(200) UNIQUE NOT NULL,
                icon VARCHAR(10),
                category VARCHAR(50) CHECK (category IN ('surgical', 'medical', 'oncology', 'super_specialty')),
                description TEXT,
                long_description TEXT,
                treatment_count INTEGER DEFAULT 0,
                image VARCHAR(500),
                is_featured BOOLEAN DEFAULT false,
                display_order INTEGER DEFAULT 0,
                meta_title VARCHAR(500),
                meta_description TEXT,
                status VARCHAR(20) DEFAULT 'draft' CHECK (status IN ('draft', 'published', 'archived')),
                created_at TIMESTAMP DEFAULT NOW(),
                updated_at TIMESTAMP DEFAULT NOW()
            );

            -- TREATMENTS (belong to a specialty)
            CREATE TABLE IF NOT EXISTS treatments (
                id SERIAL PRIMARY KEY,
                name VARCHAR(300) NOT NULL,
                slug VARCHAR(300) UNIQUE NOT NULL,
                specialty_id INTEGER REFERENCES specialties(id),
                description TEXT,
                long_description TEXT,
                duration VARCHAR(100),
                recovery_time VARCHAR(100),
                success_rate VARCHAR(50),
                cost_range_usd VARCHAR(100),
                image VARCHAR(500),
                is_featured BOOLEAN DEFAULT false,
                meta_title VARCHAR(500),
                meta_description TEXT,
                status VARCHAR(20) DEFAULT 'draft' CHECK (status IN ('draft', 'published', 'archived')),
                created_at TIMESTAMP DEFAULT NOW(),
                updated_at TIMESTAMP DEFAULT NOW()
            );

            -- DESTINATIONS (countries)
            CREATE TABLE IF NOT EXISTS destinations (
                id SERIAL PRIMARY KEY,
                name VARCHAR(100) NOT NULL,
                slug VARCHAR(100) UNIQUE NOT NULL,
                flag VARCHAR(10),
                tagline VARCHAR(300),
                description TEXT,
                long_description TEXT,
                why_choose TEXT,
                image VARCHAR(500),
                gallery TEXT[],
                hospital_count INTEGER DEFAULT 0,
                doctor_count INTEGER DEFAULT 0,
                avg_savings VARCHAR(50),
                visa_info TEXT,
                travel_info TEXT,
                climate TEXT,
                language VARCHAR(200),
                currency VARCHAR(100),
                is_featured BOOLEAN DEFAULT false,
                display_order INTEGER DEFAULT 0,
                meta_title VARCHAR(500),
                meta_description TEXT,
                status VARCHAR(20) DEFAULT 'draft' CHECK (status IN ('draft', 'published', 'archived')),
                created_at TIMESTAMP DEFAULT NOW(),
                updated_at TIMESTAMP DEFAULT NOW()
            );

            -- TREATMENT COSTS (per treatment per destination)
            CREATE TABLE IF NOT EXISTS treatment_costs (
                id SERIAL PRIMARY KEY,
                treatment_id INTEGER REFERENCES treatments(id),
                destination_id INTEGER REFERENCES destinations(id),
                cost_min_usd INTEGER,
                cost_max_usd INTEGER,
                cost_local VARCHAR(100),
                includes TEXT,
                hospital_stay VARCHAR(100),
                notes TEXT,
                status VARCHAR(20) DEFAULT 'published',
                created_at TIMESTAMP DEFAULT NOW(),
                updated_at TIMESTAMP DEFAULT NOW(),
                UNIQUE(treatment_id, destination_id)
            );

            -- STATIC PAGES (About, FAQ, Contact, How It Works, etc.)
            CREATE TABLE IF NOT EXISTS static_pages (
                id SERIAL PRIMARY KEY,
                title VARCHAR(300) NOT NULL,
                slug VARCHAR(300) UNIQUE NOT NULL,
                page_type VARCHAR(50) DEFAULT 'page' CHECK (page_type IN ('page', 'legal', 'landing', 'form')),
                content TEXT,
                hero_title VARCHAR(500),
                hero_description TEXT,
                meta_title VARCHAR(500),
                meta_description TEXT,
                status VARCHAR(20) DEFAULT 'published',
                updated_by INTEGER REFERENCES users(id),
                created_at TIMESTAMP DEFAULT NOW(),
                updated_at TIMESTAMP DEFAULT NOW()
            );

            -- LINKING TABLES for many-to-many relationships
            CREATE TABLE IF NOT EXISTS hospital_specialties (
                hospital_id INTEGER REFERENCES hospitals(id) ON DELETE CASCADE,
                specialty_id INTEGER REFERENCES specialties(id) ON DELETE CASCADE,
                PRIMARY KEY (hospital_id, specialty_id)
            );

            CREATE TABLE IF NOT EXISTS doctor_treatments (
                doctor_id INTEGER REFERENCES doctors(id) ON DELETE CASCADE,
                treatment_id INTEGER REFERENCES treatments(id) ON DELETE CASCADE,
                PRIMARY KEY (doctor_id, treatment_id)
            );
        `);
        // Add focus_keywords column if not exists
        await client.query(`ALTER TABLE blog_posts ADD COLUMN IF NOT EXISTS focus_keywords TEXT`);

        // Theme Templates table
        await client.query(`
            CREATE TABLE IF NOT EXISTS theme_templates (
                id SERIAL PRIMARY KEY,
                template_key VARCHAR(100) UNIQUE NOT NULL,
                label VARCHAR(200) NOT NULL,
                category VARCHAR(50) NOT NULL DEFAULT 'detail',
                description TEXT,
                html_template TEXT NOT NULL,
                css TEXT,
                is_active BOOLEAN DEFAULT true,
                updated_by INTEGER REFERENCES users(id),
                created_at TIMESTAMP DEFAULT NOW(),
                updated_at TIMESTAMP DEFAULT NOW()
            );
        `);

        console.log('✅ Database tables initialized');

        // Migrations for existing databases
        const migrations = [
            "ALTER TABLE media ADD COLUMN IF NOT EXISTS title VARCHAR(500)",
            "ALTER TABLE media ADD COLUMN IF NOT EXISTS caption TEXT",
            "ALTER TABLE media ADD COLUMN IF NOT EXISTS description TEXT",
            "ALTER TABLE media ADD COLUMN IF NOT EXISTS width INTEGER",
            "ALTER TABLE media ADD COLUMN IF NOT EXISTS height INTEGER",
            "ALTER TABLE media ADD COLUMN IF NOT EXISTS sizes JSONB DEFAULT '{}'",
        ];
        for (const sql of migrations) {
            try { await client.query(sql); } catch(e) { /* column may already exist */ }
        }
        console.log('✅ Migrations applied');
    } catch (err) {
        console.error('❌ Database init error:', err.message);
        throw err;
    } finally {
        client.release();
    }
}

module.exports = { pool, initDB };
