// Seed script — run once to populate database with existing website content
// Usage: node config/seed.js

require('dotenv').config();
const { pool, initDB } = require('./database');

async function seed() {
    const client = await pool.connect();
    try {
        await initDB();
        console.log('🌱 Starting seed...');

        // ============== SPECIALTIES ==============
        const specialties = [
            { name: 'Cardiac Surgery', slug: 'cardiac-surgery', icon: '❤️', category: 'surgical', treatment_count: 15, description: 'Open-heart surgery, bypass (CABG), valve replacement, minimally invasive cardiac procedures, and pediatric heart surgery.' },
            { name: 'Neurosurgery', slug: 'neurosurgery', icon: '🧠', category: 'surgical', treatment_count: 12, description: 'Brain tumor removal, spinal surgery, deep brain stimulation, and complex neurological procedures.' },
            { name: 'Orthopedics', slug: 'orthopedics', icon: '🦴', category: 'surgical', treatment_count: 20, description: 'Joint replacements, sports medicine, spine surgery, arthroscopy, and fracture management.' },
            { name: 'Cosmetic & Plastic Surgery', slug: 'cosmetic-surgery', icon: '✨', category: 'surgical', treatment_count: 18, description: 'Rhinoplasty, liposuction, facelifts, breast augmentation, tummy tucks, and reconstructive surgery.' },
            { name: 'Bariatric & Metabolic Surgery', slug: 'bariatric-surgery', icon: '⚖️', category: 'surgical', treatment_count: 8, description: 'Gastric bypass, sleeve gastrectomy, and metabolic surgery for weight loss and diabetes reversal.' },
            { name: 'Breast Surgery', slug: 'breast-surgery', icon: '🎀', category: 'surgical', treatment_count: 8, description: 'Breast cancer surgery, mastectomy, breast reconstruction, and cosmetic breast procedures.' },
            { name: 'General Surgery', slug: 'general-surgery', icon: '🔪', category: 'surgical', treatment_count: 10, description: 'Hernia repair, appendectomy, cholecystectomy, and laparoscopic procedures.' },
            { name: 'Obstetrics & Gynecology', slug: 'gynecology', icon: '👶', category: 'surgical', treatment_count: 10, description: 'Hysterectomy, fibroid removal, fertility treatments, and high-risk pregnancy care.' },
            { name: 'Urology', slug: 'urology', icon: '💧', category: 'surgical', treatment_count: 10, description: 'Kidney stone treatment, prostate surgery, kidney transplant, and reconstructive urology.' },
            { name: 'ENT', slug: 'ent', icon: '👂', category: 'surgical', treatment_count: 8, description: 'Sinus surgery, cochlear implants, tonsillectomy, and head & neck procedures.' },
            { name: 'Ophthalmology', slug: 'ophthalmology', icon: '👁️', category: 'surgical', treatment_count: 10, description: 'LASIK, cataract surgery, retinal procedures, corneal transplant, and glaucoma treatment.' },
            { name: 'Vascular Surgery', slug: 'vascular-surgery', icon: '🫀', category: 'surgical', treatment_count: 6, description: 'Varicose veins, aneurysm repair, peripheral artery disease, and dialysis access.' },
            { name: 'Surgical Gastro, HPB & Transplant', slug: 'surgical-gastroenterology', icon: '🫁', category: 'surgical', treatment_count: 10, description: 'Liver transplant, pancreatic surgery, bile duct surgery, and GI oncology.' },
            { name: 'Dentistry', slug: 'dentistry', icon: '🦷', category: 'surgical', treatment_count: 14, description: 'Dental implants, veneers, root canal, crowns, orthodontics, and full-mouth rehabilitation.' },
            { name: 'Cardiology', slug: 'cardiology', icon: '💓', category: 'medical', treatment_count: 10, description: 'Angioplasty, pacemaker implantation, electrophysiology, and interventional cardiology.' },
            { name: 'Neurology', slug: 'neurology', icon: '⚡', category: 'medical', treatment_count: 8, description: 'Epilepsy treatment, stroke management, Parkinson\'s therapy, and neurological diagnostics.' },
            { name: 'Gastroenterology & Hepatobiliary', slug: 'gastroenterology', icon: '🏥', category: 'medical', treatment_count: 8, description: 'Endoscopy, colonoscopy, liver disease management, and GI diagnostics.' },
            { name: 'Dermatology', slug: 'dermatology', icon: '🧴', category: 'medical', treatment_count: 8, description: 'Skin cancer treatment, psoriasis therapy, laser treatments, and cosmetic dermatology.' },
            { name: 'Endocrinology & Diabetology', slug: 'endocrinology', icon: '🧬', category: 'medical', treatment_count: 6, description: 'Diabetes management, thyroid disorders, hormone therapy, and metabolic diseases.' },
            { name: 'Nephrology', slug: 'nephrology', icon: '🫘', category: 'medical', treatment_count: 6, description: 'Dialysis, kidney disease management, and pre/post kidney transplant care.' },
            { name: 'Pulmonology & Sleep Medicine', slug: 'pulmonology', icon: '🌬️', category: 'medical', treatment_count: 6, description: 'COPD treatment, asthma management, sleep apnea, and lung disease diagnostics.' },
            { name: 'Rheumatology', slug: 'rheumatology', icon: '🤲', category: 'medical', treatment_count: 5, description: 'Rheumatoid arthritis, lupus, autoimmune disorders, and joint inflammation treatment.' },
            { name: 'Medical Oncology', slug: 'medical-oncology', icon: '🎗️', category: 'oncology', treatment_count: 10, description: 'Chemotherapy, immunotherapy, targeted therapy, and comprehensive cancer care.' },
            { name: 'Surgical Oncology', slug: 'surgical-oncology', icon: '🔬', category: 'oncology', treatment_count: 10, description: 'Cancer tumor removal, lymph node dissection, and debulking surgeries.' },
            { name: 'Radiation Oncology', slug: 'radiation-oncology', icon: '☢️', category: 'oncology', treatment_count: 6, description: 'Radiotherapy, CyberKnife, proton therapy, and brachytherapy.' },
            { name: 'Hematology & BMT', slug: 'hematology-bmt', icon: '🩸', category: 'oncology', treatment_count: 8, description: 'Bone marrow transplant, blood cancer treatment, stem cell therapy, and blood disorders.' },
            { name: 'Infertility & IVF', slug: 'fertility', icon: '🍼', category: 'super_specialty', treatment_count: 10, description: 'In-vitro fertilization, ICSI, egg freezing, surrogacy support, and fertility diagnostics.' },
            { name: 'Interventional Neuroradiology', slug: 'interventional-neuroradiology', icon: '📡', category: 'super_specialty', treatment_count: 5, description: 'Brain aneurysm coiling, AVM embolization, and minimally invasive neurovascular procedures.' },
        ];

        for (let i = 0; i < specialties.length; i++) {
            const s = specialties[i];
            await client.query(
                `INSERT INTO specialties (name, slug, icon, category, treatment_count, description, is_featured, display_order, status)
                 VALUES ($1,$2,$3,$4,$5,$6,$7,$8,'published')
                 ON CONFLICT (slug) DO NOTHING`,
                [s.name, s.slug, s.icon, s.category, s.treatment_count, s.description, i < 8, i + 1]
            );
        }
        console.log('✅ 28 Specialties seeded');

        // ============== DESTINATIONS ==============
        const destinations = [
            { name: 'India', slug: 'india', flag: '🇮🇳', tagline: 'World-class care at the most affordable prices', description: 'India is the #1 medical tourism destination globally, offering JCI-accredited hospitals, English-speaking doctors, and savings of 60-90% compared to the US/UK.', avg_savings: '70-90%', hospital_count: 25, doctor_count: 100, language: 'English, Hindi', currency: 'INR (₹)' },
            { name: 'Turkey', slug: 'turkey', flag: '🇹🇷', tagline: 'Europe-quality healthcare at Asian prices', description: 'Turkey bridges East and West, offering world-class hospitals specializing in hair transplants, cosmetic surgery, dental work, and cardiac care.', avg_savings: '50-70%', hospital_count: 10, doctor_count: 40, language: 'Turkish, English', currency: 'TRY (₺)' },
            { name: 'Thailand', slug: 'thailand', flag: '🇹🇭', tagline: 'Where healthcare meets hospitality', description: 'Thailand pioneered medical tourism in Asia. Bangkok hospitals like Bumrungrad serve over 1 million international patients annually.', avg_savings: '50-75%', hospital_count: 8, doctor_count: 35, language: 'Thai, English', currency: 'THB (฿)' },
            { name: 'UAE', slug: 'uae', flag: '🇦🇪', tagline: 'Premium healthcare in the Middle East hub', description: 'The UAE offers ultra-modern hospitals with premium patient experience, ideal for patients seeking luxury alongside treatment.', avg_savings: '30-50%', hospital_count: 6, doctor_count: 25, language: 'Arabic, English', currency: 'AED' },
            { name: 'Singapore', slug: 'singapore', flag: '🇸🇬', tagline: 'Asia\'s most advanced medical hub', description: 'Singapore consistently ranks among the world\'s best healthcare systems with cutting-edge technology and the highest safety standards.', avg_savings: '25-40%', hospital_count: 5, doctor_count: 20, language: 'English, Mandarin, Malay', currency: 'SGD' },
        ];

        for (let i = 0; i < destinations.length; i++) {
            const d = destinations[i];
            await client.query(
                `INSERT INTO destinations (name, slug, flag, tagline, description, avg_savings, hospital_count, doctor_count, language, currency, is_featured, display_order, status)
                 VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,true,$11,'published')
                 ON CONFLICT (slug) DO NOTHING`,
                [d.name, d.slug, d.flag, d.tagline, d.description, d.avg_savings, d.hospital_count, d.doctor_count, d.language, d.currency, i + 1]
            );
        }
        console.log('✅ 5 Destinations seeded');

        // ============== SAMPLE TREATMENTS ==============
        // Get specialty IDs
        const specRows = await client.query('SELECT id, slug FROM specialties');
        const specMap = {};
        specRows.rows.forEach(r => specMap[r.slug] = r.id);

        const treatments = [
            // Cardiac Surgery
            { name: 'Coronary Artery Bypass Grafting (CABG)', slug: 'cabg', specialty: 'cardiac-surgery', cost_range_usd: '$3,500 - $7,000', duration: '4-6 hours', recovery_time: '6-8 weeks' },
            { name: 'Heart Valve Replacement', slug: 'heart-valve-replacement', specialty: 'cardiac-surgery', cost_range_usd: '$5,000 - $9,000', duration: '3-5 hours', recovery_time: '6-8 weeks' },
            { name: 'TAVR / TAVI', slug: 'tavr-tavi', specialty: 'cardiac-surgery', cost_range_usd: '$15,000 - $25,000', duration: '1-2 hours', recovery_time: '1-2 weeks' },
            { name: 'Angioplasty with Stent', slug: 'angioplasty-stent', specialty: 'cardiology', cost_range_usd: '$3,000 - $5,000', duration: '1-2 hours', recovery_time: '1 week' },
            // Orthopedics
            { name: 'Total Knee Replacement', slug: 'total-knee-replacement', specialty: 'orthopedics', cost_range_usd: '$4,000 - $6,500', duration: '2-3 hours', recovery_time: '6-12 weeks' },
            { name: 'Total Hip Replacement', slug: 'total-hip-replacement', specialty: 'orthopedics', cost_range_usd: '$5,000 - $8,000', duration: '2-3 hours', recovery_time: '6-12 weeks' },
            { name: 'Spinal Fusion Surgery', slug: 'spinal-fusion', specialty: 'orthopedics', cost_range_usd: '$5,000 - $10,000', duration: '3-6 hours', recovery_time: '3-6 months' },
            { name: 'ACL Reconstruction', slug: 'acl-reconstruction', specialty: 'orthopedics', cost_range_usd: '$3,000 - $5,000', duration: '1-2 hours', recovery_time: '6-9 months' },
            // Cosmetic
            { name: 'Rhinoplasty (Nose Job)', slug: 'rhinoplasty', specialty: 'cosmetic-surgery', cost_range_usd: '$2,000 - $4,500', duration: '2-3 hours', recovery_time: '2-3 weeks' },
            { name: 'Liposuction', slug: 'liposuction', specialty: 'cosmetic-surgery', cost_range_usd: '$1,500 - $3,500', duration: '1-3 hours', recovery_time: '2-4 weeks' },
            { name: 'Tummy Tuck (Abdominoplasty)', slug: 'tummy-tuck', specialty: 'cosmetic-surgery', cost_range_usd: '$3,000 - $5,500', duration: '2-4 hours', recovery_time: '4-6 weeks' },
            { name: 'Hair Transplant (FUE)', slug: 'hair-transplant-fue', specialty: 'cosmetic-surgery', cost_range_usd: '$1,500 - $3,000', duration: '6-8 hours', recovery_time: '2 weeks' },
            // Bariatric
            { name: 'Gastric Sleeve Surgery', slug: 'gastric-sleeve', specialty: 'bariatric-surgery', cost_range_usd: '$4,000 - $6,000', duration: '1-2 hours', recovery_time: '2-4 weeks' },
            { name: 'Gastric Bypass (Roux-en-Y)', slug: 'gastric-bypass', specialty: 'bariatric-surgery', cost_range_usd: '$5,000 - $7,500', duration: '2-3 hours', recovery_time: '3-5 weeks' },
            // Neurosurgery
            { name: 'Brain Tumor Removal', slug: 'brain-tumor-removal', specialty: 'neurosurgery', cost_range_usd: '$6,000 - $12,000', duration: '4-8 hours', recovery_time: '4-8 weeks' },
            { name: 'Spinal Disc Surgery (Laminectomy)', slug: 'laminectomy', specialty: 'neurosurgery', cost_range_usd: '$4,000 - $7,000', duration: '2-3 hours', recovery_time: '4-6 weeks' },
            // Oncology
            { name: 'Chemotherapy (per cycle)', slug: 'chemotherapy', specialty: 'medical-oncology', cost_range_usd: '$500 - $2,000', duration: '2-6 hours', recovery_time: 'Varies' },
            { name: 'Bone Marrow Transplant', slug: 'bone-marrow-transplant', specialty: 'hematology-bmt', cost_range_usd: '$20,000 - $40,000', duration: '4-6 hours', recovery_time: '3-6 months' },
            // Dentistry
            { name: 'Dental Implants (per tooth)', slug: 'dental-implants', specialty: 'dentistry', cost_range_usd: '$400 - $1,000', duration: '1-2 hours', recovery_time: '3-6 months' },
            { name: 'Full Mouth Rehabilitation', slug: 'full-mouth-rehab', specialty: 'dentistry', cost_range_usd: '$3,000 - $8,000', duration: 'Multiple visits', recovery_time: '2-4 weeks' },
            // IVF
            { name: 'IVF Cycle', slug: 'ivf-cycle', specialty: 'fertility', cost_range_usd: '$2,500 - $4,500', duration: '2-3 weeks', recovery_time: '1-2 days' },
            // Ophthalmology
            { name: 'LASIK Eye Surgery', slug: 'lasik', specialty: 'ophthalmology', cost_range_usd: '$500 - $1,500', duration: '30 min', recovery_time: '1-2 days' },
            { name: 'Cataract Surgery', slug: 'cataract-surgery', specialty: 'ophthalmology', cost_range_usd: '$800 - $2,000', duration: '30-45 min', recovery_time: '1-2 weeks' },
        ];

        for (const t of treatments) {
            const specId = specMap[t.specialty];
            if (!specId) continue;
            await client.query(
                `INSERT INTO treatments (name, slug, specialty_id, cost_range_usd, duration, recovery_time, status)
                 VALUES ($1,$2,$3,$4,$5,$6,'published')
                 ON CONFLICT (slug) DO NOTHING`,
                [t.name, t.slug, specId, t.cost_range_usd, t.duration, t.recovery_time]
            );
        }
        console.log('✅ 23 Treatments seeded');

        // ============== SAMPLE HOSPITALS ==============
        const hospitals = [
            { name: 'Indraprastha Apollo Hospital', slug: 'apollo-delhi', country: 'India', city: 'New Delhi', beds: 710, established: 1996, rating: 4.8, description: 'Flagship hospital of Asia\'s largest healthcare group. JCI accredited with 52 specialties and centers of excellence in cardiac, neuro, and oncology.', accreditations: ['JCI', 'NABH', 'NABL'] },
            { name: 'Medanta - The Medicity', slug: 'medanta-gurgaon', country: 'India', city: 'Gurugram', beds: 1600, established: 2009, rating: 4.9, description: 'Founded by Dr. Naresh Trehan. One of India\'s largest multi-specialty hospitals with 45+ specialties and advanced robotics.', accreditations: ['JCI', 'NABH'] },
            { name: 'Fortis Memorial Research Institute', slug: 'fortis-gurgaon', country: 'India', city: 'Gurugram', beds: 1000, established: 2001, rating: 4.7, description: 'Premier multi-specialty hospital known for transplant programs, cardiac care, and neurosciences.', accreditations: ['JCI', 'NABH'] },
            { name: 'Max Super Speciality Hospital', slug: 'max-saket', country: 'India', city: 'New Delhi', beds: 500, established: 2006, rating: 4.7, description: 'Part of Max Healthcare network. Known for oncology, cardiac sciences, and orthopedics.', accreditations: ['NABH', 'NABL'] },
            { name: 'BLK-Max Super Speciality Hospital', slug: 'blk-max-delhi', country: 'India', city: 'New Delhi', beds: 700, established: 1959, rating: 4.6, description: 'One of the largest hospitals in India with a dedicated bone marrow transplant unit.', accreditations: ['NABH', 'NABL'] },
            { name: 'Bumrungrad International Hospital', slug: 'bumrungrad-bangkok', country: 'Thailand', city: 'Bangkok', beds: 580, established: 1980, rating: 4.8, description: 'Internationally renowned hospital serving over 1.1 million patients annually from 190 countries.', accreditations: ['JCI', 'HA'] },
            { name: 'Acibadem Healthcare Group', slug: 'acibadem-istanbul', country: 'Turkey', city: 'Istanbul', beds: 900, established: 1991, rating: 4.7, description: 'Turkey\'s largest private healthcare provider with 23 hospitals and cutting-edge technology.', accreditations: ['JCI'] },
            { name: 'Memorial Hospital', slug: 'memorial-istanbul', country: 'Turkey', city: 'Istanbul', beds: 600, established: 2000, rating: 4.6, description: 'Leading Turkish hospital known for oncology, cardiac surgery, and organ transplants.', accreditations: ['JCI'] },
            { name: 'Cleveland Clinic Abu Dhabi', slug: 'cleveland-clinic-abudhabi', country: 'UAE', city: 'Abu Dhabi', beds: 364, established: 2015, rating: 4.9, description: 'Extension of the world-famous Cleveland Clinic. Premium multi-specialty care in the Middle East.', accreditations: ['JCI'] },
            { name: 'Mount Elizabeth Hospital', slug: 'mount-elizabeth-singapore', country: 'Singapore', city: 'Singapore', beds: 345, established: 1979, rating: 4.8, description: 'Leading private hospital in Singapore known for cardiac surgery, oncology, and neurosciences.', accreditations: ['JCI'] },
        ];

        for (const h of hospitals) {
            await client.query(
                `INSERT INTO hospitals (name, slug, country, city, beds, established, rating, description, accreditations, is_featured, status)
                 VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,true,'published')
                 ON CONFLICT (slug) DO NOTHING`,
                [h.name, h.slug, h.country, h.city, h.beds, h.established, h.rating, h.description, h.accreditations]
            );
        }
        console.log('✅ 10 Hospitals seeded');

        // ============== SAMPLE DOCTORS ==============
        const doctors = [
            { name: 'Dr. Naresh Trehan', slug: 'naresh-trehan', title: 'Chairman & Managing Director', specialty: 'Cardiac Surgery', country: 'India', experience_years: 40, description: 'World-renowned cardiovascular surgeon. Founded Medanta. Performed over 48,000 heart surgeries.' },
            { name: 'Dr. Ashok Rajgopal', slug: 'ashok-rajgopal', title: 'Chairman - Knee & Hip Surgery', specialty: 'Orthopedics', country: 'India', experience_years: 35, description: 'India\'s leading joint replacement surgeon. Performed over 35,000 knee replacements.' },
            { name: 'Dr. Rana Patir', slug: 'rana-patir', title: 'Chairman - Neurosurgery', specialty: 'Neurosurgery', country: 'India', experience_years: 30, description: 'Leading neurosurgeon specializing in brain tumors, spine surgery, and functional neurosurgery.' },
            { name: 'Dr. Harit Chaturvedi', slug: 'harit-chaturvedi', title: 'Chairman - Cancer Care', specialty: 'Surgical Oncology', country: 'India', experience_years: 28, description: 'One of India\'s top oncologists specializing in breast cancer and head & neck cancers.' },
            { name: 'Dr. Subhash Gupta', slug: 'subhash-gupta', title: 'Chairman - Liver Transplant', specialty: 'Surgical Gastroenterology', country: 'India', experience_years: 25, description: 'World record holder for most liver transplants. Pioneer of living donor liver transplant in India.' },
        ];

        for (const d of doctors) {
            await client.query(
                `INSERT INTO doctors (name, slug, title, specialty, country, experience_years, description, is_featured, status)
                 VALUES ($1,$2,$3,$4,$5,$6,$7,true,'published')
                 ON CONFLICT (slug) DO NOTHING`,
                [d.name, d.slug, d.title, d.specialty, d.country, d.experience_years, d.description]
            );
        }
        console.log('✅ 5 Doctors seeded');

        // ============== STATIC PAGES ==============
        const staticPages = [
            { title: 'About Ginger Healthcare', slug: 'about', page_type: 'page', hero_title: 'About Ginger Healthcare', hero_description: 'We connect international patients with the best hospitals in 5 countries.' },
            { title: 'How It Works', slug: 'how-it-works', page_type: 'page', hero_title: 'How It Works', hero_description: 'Your medical tourism journey in 4 simple steps.' },
            { title: 'Contact Us', slug: 'contact', page_type: 'page', hero_title: 'Contact Us', hero_description: 'Get in touch with our medical tourism specialists.' },
            { title: 'FAQ', slug: 'faq', page_type: 'page', hero_title: 'Frequently Asked Questions', hero_description: 'Answers to common questions about medical tourism.' },
            { title: 'Get a Free Quote', slug: 'get-quote', page_type: 'form', hero_title: 'Get a Free Quote', hero_description: 'Tell us about your treatment needs and get a personalized estimate.' },
            { title: 'Book a Consultation', slug: 'book-consultation', page_type: 'form', hero_title: 'Book a Consultation', hero_description: 'Connect with top doctors for an expert medical opinion.' },
            { title: 'Cost Calculator', slug: 'cost-calculator', page_type: 'page', hero_title: 'Medical Tourism Cost Calculator', hero_description: 'Estimate your treatment costs across 5 countries.' },
            { title: 'Careers', slug: 'careers', page_type: 'page', hero_title: 'Join Our Team', hero_description: 'Help us revolutionize healthcare access worldwide.' },
            { title: 'Partner With Us', slug: 'partners', page_type: 'page', hero_title: 'Partner With Ginger Healthcare', hero_description: 'Hospital and agent partnership opportunities.' },
            { title: 'Privacy Policy', slug: 'privacy-policy', page_type: 'legal', hero_title: 'Privacy Policy', hero_description: '' },
            { title: 'Terms & Conditions', slug: 'terms', page_type: 'legal', hero_title: 'Terms & Conditions', hero_description: '' },
            { title: 'Disclaimer', slug: 'disclaimer', page_type: 'legal', hero_title: 'Medical Disclaimer', hero_description: '' },
            { title: 'Testimonials', slug: 'testimonials', page_type: 'page', hero_title: 'Patient Testimonials', hero_description: 'Real stories from real patients.' },
        ];

        for (const p of staticPages) {
            await client.query(
                `INSERT INTO static_pages (title, slug, page_type, hero_title, hero_description, status)
                 VALUES ($1,$2,$3,$4,$5,'published')
                 ON CONFLICT (slug) DO NOTHING`,
                [p.title, p.slug, p.page_type, p.hero_title, p.hero_description]
            );
        }
        console.log('✅ 13 Static Pages seeded');

        // ============== SAMPLE TESTIMONIALS ==============
        const testimonials = [
            { patient_name: 'David Miller', patient_country: 'USA', patient_flag: '🇺🇸', treatment: 'Knee Replacement', specialty: 'Orthopedics', destination: 'India', rating: 5, quote: 'I saved over $45,000 on my bilateral knee replacement at Medanta. The quality of care was exceptional — better than what I experienced in the US. Dr. Rajgopal and his team were outstanding.' },
            { patient_name: 'Sarah Thompson', patient_country: 'UK', patient_flag: '🇬🇧', treatment: 'Heart Valve Replacement', specialty: 'Cardiac Surgery', destination: 'India', rating: 5, quote: 'After being told I\'d wait 8 months on the NHS, Ginger Healthcare arranged my valve replacement in New Delhi within 3 weeks. The hospital was world-class and I saved £25,000.' },
            { patient_name: 'Ahmed Al-Rashid', patient_country: 'Iraq', patient_flag: '🇮🇶', treatment: 'Brain Tumor Removal', specialty: 'Neurosurgery', destination: 'India', rating: 5, quote: 'My father\'s brain tumor surgery at Fortis was life-saving. The neurosurgery team was incredible, and the total cost was a fraction of what we were quoted elsewhere.' },
            { patient_name: 'Maria Santos', patient_country: 'Brazil', patient_flag: '🇧🇷', treatment: 'Gastric Sleeve', specialty: 'Bariatric Surgery', destination: 'Turkey', rating: 5, quote: 'Istanbul was amazing for my bariatric surgery. The hospital felt like a 5-star hotel, the surgeon was brilliant, and I\'ve lost 40kg in 6 months. Total game-changer!' },
            { patient_name: 'John Peterson', patient_country: 'Australia', patient_flag: '🇦🇺', treatment: 'Hair Transplant', specialty: 'Cosmetic Surgery', destination: 'Turkey', rating: 5, quote: 'Got 4000 grafts FUE in Istanbul for $2,500 — the same procedure was quoted at $15,000 in Sydney. Results after 8 months are incredible. Worth every penny.' },
        ];

        for (const t of testimonials) {
            await client.query(
                `INSERT INTO testimonials (patient_name, patient_country, patient_flag, treatment, specialty, destination, rating, quote, status)
                 VALUES ($1,$2,$3,$4,$5,$6,$7,$8,'published')`,
                [t.patient_name, t.patient_country, t.patient_flag, t.treatment, t.specialty, t.destination, t.rating, t.quote]
            );
        }
        console.log('✅ 5 Testimonials seeded');

        console.log('\n🎉 DATABASE FULLY SEEDED!');
        console.log('Summary:');
        console.log('  28 Specialties');
        console.log('  23 Treatments');
        console.log('  5 Destinations');
        console.log('  10 Hospitals');
        console.log('  5 Doctors');
        console.log('  5 Testimonials');
        console.log('  13 Static Pages');

    } catch (err) {
        console.error('❌ Seed error:', err);
    } finally {
        client.release();
        await pool.end();
    }
}

seed();
