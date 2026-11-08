-- First delete existing blocks for help-center page
DELETE FROM cms_page_blocks WHERE page_id = (SELECT id FROM cms_pages WHERE slug = 'help-center');

-- Insert new blocks matching the screenshot design
INSERT INTO cms_page_blocks (page_id, block_type, sort_order, is_visible, config)
SELECT 
  id,
  'hero',
  1,
  true,
  '{
    "title": "How can we help?",
    "subtitle": "Search our knowledge base or browse categories below",
    "variant": "light",
    "showSearch": true,
    "searchPlaceholder": "Search for help articles..."
  }'::jsonb
FROM cms_pages WHERE slug = 'help-center';

INSERT INTO cms_page_blocks (page_id, block_type, sort_order, is_visible, config)
SELECT 
  id,
  'cards',
  2,
  true,
  '{
    "columns": 3,
    "style": "links",
    "cards": [
      {
        "icon": "BookOpen",
        "title": "Getting Started",
        "description": "Learn the basics of Matbex and set up your restaurant",
        "links": [
          {"text": "Quick Start Guide", "url": "/docs"},
          {"text": "Account Setup", "url": "/docs"},
          {"text": "First Steps", "url": "/docs"}
        ]
      },
      {
        "icon": "HelpCircle",
        "title": "FAQs",
        "description": "Find answers to commonly asked questions",
        "links": [
          {"text": "Billing Questions", "url": "/docs"},
          {"text": "Feature Inquiries", "url": "/docs"},
          {"text": "Technical Support", "url": "/docs"}
        ]
      },
      {
        "icon": "Video",
        "title": "Video Tutorials",
        "description": "Watch step-by-step guides and tutorials",
        "links": [
          {"text": "Dashboard Overview", "url": "/docs"},
          {"text": "Recording Sales", "url": "/docs"},
          {"text": "Managing Inventory", "url": "/docs"}
        ]
      }
    ]
  }'::jsonb
FROM cms_pages WHERE slug = 'help-center';

INSERT INTO cms_page_blocks (page_id, block_type, sort_order, is_visible, config)
SELECT 
  id,
  'cta',
  3,
  true,
  '{
    "title": "Still need help?",
    "subtitle": "Our support team is available 24/7 to assist you",
    "buttonText": "Contact Support",
    "buttonLink": "/contact",
    "variant": "dark",
    "icon": "Mail"
  }'::jsonb
FROM cms_pages WHERE slug = 'help-center';