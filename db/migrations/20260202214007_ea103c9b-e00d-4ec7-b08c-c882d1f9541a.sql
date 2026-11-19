
-- First, get the documentation page ID and delete existing blocks
DELETE FROM cms_page_blocks 
WHERE page_id = (SELECT id FROM cms_pages WHERE slug = 'documentation');

-- Insert the new blocks for documentation page
INSERT INTO cms_page_blocks (page_id, block_type, sort_order, is_visible, config)
SELECT 
  p.id,
  b.block_type,
  b.sort_order,
  true,
  b.config
FROM cms_pages p
CROSS JOIN (
  VALUES
    -- Hero section
    ('hero', 1, '{"badge": "Documentation", "title": "Matbex Documentation", "subtitle": "Everything you need to master Matbex and transform your restaurant operations", "variant": "light", "primaryButton": {"text": "Get Started", "link": "#quick-start"}, "secondaryButton": {"text": "API Reference", "link": "/api"}}'::jsonb),
    
    -- Documentation Cards Grid
    ('cards', 2, '{"title": "", "variant": "light", "columns": 3, "cards": [
      {
        "icon": "Zap",
        "title": "Quick Start",
        "description": "Get up and running with Matbex in minutes",
        "links": [
          {"text": "Installation", "url": "#installation"},
          {"text": "Configuration", "url": "#configuration"},
          {"text": "First Steps", "url": "#first-steps"}
        ]
      },
      {
        "icon": "BookOpen",
        "title": "User Guides",
        "description": "Comprehensive guides for all Matbex features",
        "links": [
          {"text": "Dashboard", "url": "#dashboard"},
          {"text": "Sales Management", "url": "#sales"},
          {"text": "Inventory Control", "url": "#inventory"}
        ]
      },
      {
        "icon": "Code",
        "title": "API Reference",
        "description": "Complete API documentation for developers",
        "links": [
          {"text": "Authentication", "url": "/api#auth"},
          {"text": "Endpoints", "url": "/api#endpoints"},
          {"text": "Webhooks", "url": "/api#webhooks"}
        ]
      },
      {
        "icon": "Database",
        "title": "Data Management",
        "description": "Learn how to manage and export your data",
        "links": [
          {"text": "Data Import", "url": "#import"},
          {"text": "Backups", "url": "#backups"},
          {"text": "Reports", "url": "#reports"}
        ]
      },
      {
        "icon": "Shield",
        "title": "Security",
        "description": "Security best practices and configurations",
        "links": [
          {"text": "MFA Setup", "url": "#mfa"},
          {"text": "Access Control", "url": "#access"},
          {"text": "Audit Logs", "url": "#audit"}
        ]
      },
      {
        "icon": "Link",
        "title": "Integrations",
        "description": "Connect Matbex with your existing tools",
        "links": [
          {"text": "POS Systems", "url": "/integrations#pos"},
          {"text": "Accounting", "url": "/integrations#accounting"},
          {"text": "Delivery Platforms", "url": "/integrations#delivery"}
        ]
      }
    ]}'::jsonb),
    
    -- Popular Articles section
    ('cards', 3, '{"title": "Popular Articles", "variant": "dark", "columns": 2, "style": "list", "cards": [
      {"icon": "FileText", "title": "How to set up your first restaurant", "url": "#setup-restaurant"},
      {"icon": "FileText", "title": "Understanding COGS and food cost tracking", "url": "#cogs-tracking"},
      {"icon": "FileText", "title": "Setting up staff permissions and roles", "url": "#staff-permissions"},
      {"icon": "FileText", "title": "Generating and analyzing profit reports", "url": "#profit-reports"},
      {"icon": "FileText", "title": "Configuring delivery platform integrations", "url": "#delivery-integrations"},
      {"icon": "FileText", "title": "Best practices for inventory management", "url": "#inventory-best-practices"}
    ]}'::jsonb),
    
    -- CTA section
    ('cta', 4, '{"icon": "Code", "title": "Building with Matbex?", "subtitle": "Explore our API documentation for seamless integrations", "buttonText": "View API Docs", "buttonLink": "/api", "variant": "light"}'::jsonb)
) AS b(block_type, sort_order, config)
WHERE p.slug = 'documentation';
