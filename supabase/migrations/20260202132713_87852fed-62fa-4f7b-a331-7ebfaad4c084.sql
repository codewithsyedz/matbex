-- Delete existing about page blocks and insert new ones matching the static design
DELETE FROM cms_page_blocks 
WHERE page_id = (SELECT id FROM cms_pages WHERE slug = 'about');

-- Insert blocks matching the current static About page
INSERT INTO cms_page_blocks (page_id, block_type, sort_order, is_visible, config) VALUES
-- Hero Section
((SELECT id FROM cms_pages WHERE slug = 'about'), 'hero', 1, true, '{
  "badge": "About Us",
  "title": "Empowering Restaurants Worldwide",
  "subtitle": "Matbex was born from a simple belief: every restaurant deserves access to powerful management tools that were once only available to large chains.",
  "variant": "light"
}'::jsonb),

-- Stats Section
((SELECT id FROM cms_pages WHERE slug = 'about'), 'stats', 2, true, '{
  "stats": [
    { "value": "500+", "label": "Restaurants" },
    { "value": "15+", "label": "Countries" },
    { "value": "99.9%", "label": "Uptime" },
    { "value": "24/7", "label": "Support" }
  ]
}'::jsonb),

-- Story Section (Text Block)
((SELECT id FROM cms_pages WHERE slug = 'about'), 'text', 3, true, '{
  "title": "Our Story",
  "content": "Matbex started in 2024 when our founders, experienced restaurant operators themselves, realized that most restaurant management software was either too complex, too expensive, or simply not designed for real-world restaurant operations.\n\nWe set out to build something different - a unified operating system that brings together all the critical aspects of restaurant management: real-time COGS tracking, intelligent inventory management, streamlined payroll, and comprehensive analytics.\n\nToday, Matbex powers hundreds of restaurants across the globe, from cozy cafés to multi-location chains. Our mission remains the same: to give every restaurant the tools they need to operate with precision and grow with confidence.",
  "centered": true
}'::jsonb),

-- Values Section (Cards)
((SELECT id FROM cms_pages WHERE slug = 'about'), 'cards', 4, true, '{
  "title": "Our Values",
  "columns": 3,
  "cards": [
    { "icon": "Target", "title": "Precision", "description": "Every feature is built with accuracy in mind, giving restaurant owners the exact data they need." },
    { "icon": "Heart", "title": "Passion", "description": "We are passionate about helping restaurants thrive and succeed in a competitive industry." },
    { "icon": "Users", "title": "Partnership", "description": "We see ourselves as partners in your success, not just a software provider." },
    { "icon": "Globe", "title": "Accessibility", "description": "World-class restaurant management tools accessible to businesses of all sizes." },
    { "icon": "Zap", "title": "Innovation", "description": "Continuously evolving our platform to meet the changing needs of modern restaurants." },
    { "icon": "Shield", "title": "Trust", "description": "Your data security and privacy are fundamental to everything we build." }
  ]
}'::jsonb),

-- CTA Section
((SELECT id FROM cms_pages WHERE slug = 'about'), 'cta', 5, true, '{
  "title": "Ready to Transform Your Restaurant?",
  "subtitle": "Join hundreds of restaurants already using Matbex to streamline their operations.",
  "buttonText": "Get Started Free",
  "buttonLink": "/register"
}'::jsonb);