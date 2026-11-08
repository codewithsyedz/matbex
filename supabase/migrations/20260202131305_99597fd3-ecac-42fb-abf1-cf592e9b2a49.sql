-- Seed default content blocks for CMS pages
-- This populates pages with initial editable content

-- Helper function to get page ID by slug
DO $$
DECLARE
  v_page_id uuid;
BEGIN
  -- Investment Tiers page
  SELECT id INTO v_page_id FROM cms_pages WHERE slug = 'investment-tiers';
  IF v_page_id IS NOT NULL AND NOT EXISTS (SELECT 1 FROM cms_page_blocks WHERE page_id = v_page_id) THEN
    INSERT INTO cms_page_blocks (page_id, block_type, sort_order, is_visible, config) VALUES
    (v_page_id, 'hero', 1, true, '{"eyebrow": "Investment Tiers", "headline": "Scale with Confidence", "subheadline": "Enterprise-grade solutions for restaurant groups, franchises, and strategic investors. Custom pricing tailored to your growth trajectory.", "primaryCtaText": "Schedule Consultation", "primaryCtaLink": "/register", "bgGradient": "bg-gradient-to-b from-gray-50 to-white"}'::jsonb),
    (v_page_id, 'pricing', 2, true, '{"title": "Choose Your Growth Path", "tiers": [{"name": "Growth", "price": "Custom", "tagline": "For expanding restaurant groups", "highlighted": false, "features": ["Up to 10 restaurant locations", "Dedicated account manager", "Priority support (4-hour SLA)", "Custom integrations", "Advanced analytics dashboard"], "ctaText": "Contact Sales"}, {"name": "Enterprise", "price": "Custom", "tagline": "For large chains requiring enterprise infrastructure", "highlighted": true, "badge": "Most Popular", "features": ["Unlimited restaurant locations", "Dedicated success team", "24/7 priority support (1-hour SLA)", "Custom development hours", "White-label options", "SSO & advanced security"], "ctaText": "Schedule Demo"}, {"name": "Strategic Partner", "price": "Partnership", "tagline": "For franchises and investors seeking collaboration", "highlighted": false, "features": ["Everything in Enterprise", "Revenue-based pricing options", "Product roadmap influence", "Co-marketing opportunities", "Dedicated engineering support"], "ctaText": "Partner With Us"}]}'::jsonb),
    (v_page_id, 'features', 3, true, '{"title": "Enterprise Benefits", "subtitle": "Everything you need to manage restaurant operations at scale", "items": [{"title": "Multi-Location Management", "description": "Centralized control across all your restaurant locations with real-time data synchronization", "icon": "Building"}, {"title": "Dedicated Success Team", "description": "Your personal team of experts ensuring smooth implementation and ongoing optimization", "icon": "Users"}, {"title": "Global Infrastructure", "description": "Enterprise-grade infrastructure with 99.99% uptime and global edge deployment", "icon": "Globe"}, {"title": "Enterprise Security", "description": "SOC 2 Type II compliance, SSO integration, and advanced access controls", "icon": "Shield"}, {"title": "Custom Integrations", "description": "Seamless integration with your existing ERP, POS, and accounting systems", "icon": "Zap"}, {"title": "24/7 Support", "description": "Round-the-clock support with guaranteed response times and escalation paths", "icon": "Clock"}]}'::jsonb),
    (v_page_id, 'cta', 4, true, '{"headline": "Ready to Transform Your Operations?", "description": "Schedule a personalized demo with our enterprise team to discuss your specific requirements and custom pricing options.", "buttonText": "Schedule Demo", "buttonLink": "/register", "bgStyle": "bg-primary"}'::jsonb);
  END IF;

  -- About page
  SELECT id INTO v_page_id FROM cms_pages WHERE slug = 'about';
  IF v_page_id IS NOT NULL AND NOT EXISTS (SELECT 1 FROM cms_page_blocks WHERE page_id = v_page_id) THEN
    INSERT INTO cms_page_blocks (page_id, block_type, sort_order, is_visible, config) VALUES
    (v_page_id, 'hero', 1, true, '{"eyebrow": "Our Story", "headline": "Empowering Restaurants Worldwide", "subheadline": "We are building the operating system for modern restaurants, combining precision engineering with deep industry expertise.", "bgGradient": "bg-gradient-to-br from-slate-900 via-slate-800 to-slate-900"}'::jsonb),
    (v_page_id, 'text', 2, true, '{"title": "Our Mission", "content": "At Matbex, we believe every restaurant deserves access to enterprise-grade tools that were previously only available to large chains. Our platform combines real-time analytics, inventory management, and financial controls into a seamless experience.\n\nFounded by hospitality veterans and technology experts, we understand the unique challenges facing modern restaurateurs. Our mission is to democratize restaurant technology and help operators focus on what they do best: creating memorable dining experiences."}'::jsonb),
    (v_page_id, 'stats', 3, true, '{"stats": [{"value": "500+", "label": "Restaurants Served"}, {"value": "15M+", "label": "Transactions Processed"}, {"value": "99.9%", "label": "Uptime"}, {"value": "24/7", "label": "Support Available"}]}'::jsonb),
    (v_page_id, 'team', 4, true, '{"title": "Leadership Team", "subtitle": "Meet the people behind Matbex", "members": [{"name": "Sarah Chen", "role": "CEO & Co-Founder", "emoji": "👩‍💼"}, {"name": "Marcus Johnson", "role": "CTO & Co-Founder", "emoji": "👨‍💻"}, {"name": "Elena Rodriguez", "role": "VP of Product", "emoji": "👩‍🎨"}, {"name": "David Kim", "role": "VP of Engineering", "emoji": "👨‍🔧"}]}'::jsonb),
    (v_page_id, 'cta', 5, true, '{"headline": "Join Our Journey", "description": "Be part of the revolution in restaurant management technology.", "buttonText": "Get Started", "buttonLink": "/register", "bgStyle": "bg-primary"}'::jsonb);
  END IF;

  -- Privacy Policy page
  SELECT id INTO v_page_id FROM cms_pages WHERE slug = 'privacy-policy';
  IF v_page_id IS NOT NULL AND NOT EXISTS (SELECT 1 FROM cms_page_blocks WHERE page_id = v_page_id) THEN
    INSERT INTO cms_page_blocks (page_id, block_type, sort_order, is_visible, config) VALUES
    (v_page_id, 'hero', 1, true, '{"headline": "Privacy Policy", "subheadline": "Your privacy is important to us. This policy explains how we collect, use, and protect your information.", "bgGradient": "bg-gradient-to-b from-gray-100 to-white"}'::jsonb),
    (v_page_id, 'text', 2, true, '{"title": "Information We Collect", "content": "We collect information you provide directly to us, such as when you create an account, make a purchase, or contact us for support. This may include:\n\n• Name and contact information\n• Payment information\n• Restaurant and business details\n• Usage data and preferences\n\nWe also automatically collect certain information when you use our services, including device information, log data, and cookies."}'::jsonb),
    (v_page_id, 'text', 3, true, '{"title": "How We Use Your Information", "content": "We use the information we collect to:\n\n• Provide, maintain, and improve our services\n• Process transactions and send related information\n• Send technical notices, updates, and support messages\n• Respond to your comments and questions\n• Analyze trends and usage patterns\n• Detect, investigate, and prevent fraudulent transactions"}'::jsonb),
    (v_page_id, 'text', 4, true, '{"title": "Contact Us", "content": "If you have any questions about this Privacy Policy, please contact us at privacy@matbex.com."}'::jsonb);
  END IF;

  -- Terms of Service page
  SELECT id INTO v_page_id FROM cms_pages WHERE slug = 'terms-of-service';
  IF v_page_id IS NOT NULL AND NOT EXISTS (SELECT 1 FROM cms_page_blocks WHERE page_id = v_page_id) THEN
    INSERT INTO cms_page_blocks (page_id, block_type, sort_order, is_visible, config) VALUES
    (v_page_id, 'hero', 1, true, '{"headline": "Terms of Service", "subheadline": "Please read these terms carefully before using our services.", "bgGradient": "bg-gradient-to-b from-gray-100 to-white"}'::jsonb),
    (v_page_id, 'text', 2, true, '{"title": "Acceptance of Terms", "content": "By accessing or using Matbex services, you agree to be bound by these Terms of Service. If you do not agree to these terms, please do not use our services.\n\nWe reserve the right to modify these terms at any time. Continued use of the service after changes constitutes acceptance of the modified terms."}'::jsonb),
    (v_page_id, 'text', 3, true, '{"title": "Use of Services", "content": "You agree to use our services only for lawful purposes and in accordance with these Terms. You are responsible for:\n\n• Maintaining the confidentiality of your account\n• All activities that occur under your account\n• Ensuring your use complies with applicable laws\n• Providing accurate and complete information"}'::jsonb),
    (v_page_id, 'text', 4, true, '{"title": "Limitation of Liability", "content": "To the maximum extent permitted by law, Matbex shall not be liable for any indirect, incidental, special, consequential, or punitive damages arising from your use of our services."}'::jsonb);
  END IF;

  -- Security page
  SELECT id INTO v_page_id FROM cms_pages WHERE slug = 'security';
  IF v_page_id IS NOT NULL AND NOT EXISTS (SELECT 1 FROM cms_page_blocks WHERE page_id = v_page_id) THEN
    INSERT INTO cms_page_blocks (page_id, block_type, sort_order, is_visible, config) VALUES
    (v_page_id, 'hero', 1, true, '{"eyebrow": "Security First", "headline": "Enterprise-Grade Security", "subheadline": "Your data security is our top priority. Learn about the measures we take to protect your information.", "bgGradient": "bg-gradient-to-br from-slate-900 via-slate-800 to-slate-900"}'::jsonb),
    (v_page_id, 'features', 2, true, '{"title": "Security Features", "subtitle": "Industry-leading protection for your restaurant data", "items": [{"title": "End-to-End Encryption", "description": "All data is encrypted in transit and at rest using AES-256 encryption", "icon": "Shield"}, {"title": "SOC 2 Compliant", "description": "Our systems meet the rigorous requirements of SOC 2 Type II certification", "icon": "Check"}, {"title": "Regular Audits", "description": "Third-party security audits conducted quarterly to ensure compliance", "icon": "Clock"}, {"title": "SSO Integration", "description": "Support for SAML 2.0 and OAuth for enterprise single sign-on", "icon": "Users"}, {"title": "Role-Based Access", "description": "Granular permissions to control who can access what data", "icon": "Settings"}, {"title": "24/7 Monitoring", "description": "Continuous security monitoring and threat detection", "icon": "Zap"}]}'::jsonb),
    (v_page_id, 'text', 3, true, '{"title": "Compliance & Certifications", "content": "Matbex maintains compliance with industry standards including:\n\n• SOC 2 Type II\n• GDPR\n• PCI DSS (for payment processing)\n• ISO 27001\n\nWe regularly undergo independent security assessments and penetration testing to ensure the highest level of protection for your data."}'::jsonb),
    (v_page_id, 'cta', 4, true, '{"headline": "Questions About Security?", "description": "Our security team is available to answer any questions about our security practices.", "buttonText": "Contact Security Team", "buttonLink": "/help-center", "bgStyle": "bg-primary"}'::jsonb);
  END IF;

  -- Help Center page
  SELECT id INTO v_page_id FROM cms_pages WHERE slug = 'help-center';
  IF v_page_id IS NOT NULL AND NOT EXISTS (SELECT 1 FROM cms_page_blocks WHERE page_id = v_page_id) THEN
    INSERT INTO cms_page_blocks (page_id, block_type, sort_order, is_visible, config) VALUES
    (v_page_id, 'hero', 1, true, '{"eyebrow": "Support", "headline": "How Can We Help?", "subheadline": "Find answers to common questions or get in touch with our support team.", "primaryCtaText": "Contact Support", "primaryCtaLink": "/register", "bgGradient": "bg-gradient-to-b from-gray-50 to-white"}'::jsonb),
    (v_page_id, 'cards', 2, true, '{"title": "Popular Topics", "columns": 3, "cards": [{"title": "Getting Started", "description": "Learn how to set up your restaurant and start using Matbex", "icon": "Zap", "link": "/documentation"}, {"title": "Billing & Payments", "description": "Manage your subscription, invoices, and payment methods", "icon": "CreditCard", "link": "/documentation"}, {"title": "Inventory Management", "description": "Track stock levels, set reorder points, and manage suppliers", "icon": "Package", "link": "/documentation"}, {"title": "Staff & Payroll", "description": "Manage team members, shifts, and payroll settings", "icon": "Users", "link": "/documentation"}, {"title": "Reports & Analytics", "description": "Understanding your dashboard and generating reports", "icon": "BarChart3", "link": "/documentation"}, {"title": "Integrations", "description": "Connect Matbex with your existing tools and services", "icon": "Settings", "link": "/integrations"}]}'::jsonb),
    (v_page_id, 'faq', 3, true, '{"title": "Frequently Asked Questions", "items": [{"question": "How do I reset my password?", "answer": "Click on Forgot Password on the login page and enter your email address. You will receive a link to reset your password."}, {"question": "Can I export my data?", "answer": "Yes, you can export your data at any time from Settings > Data Export. We support CSV and PDF formats."}, {"question": "What payment methods do you accept?", "answer": "We accept all major credit cards (Visa, MasterCard, American Express) as well as bank transfers for enterprise accounts."}, {"question": "Is there a mobile app?", "answer": "Matbex is a progressive web app that works seamlessly on mobile devices. Simply visit our site from your mobile browser for full functionality."}]}'::jsonb),
    (v_page_id, 'cta', 4, true, '{"headline": "Still Need Help?", "description": "Our support team is available 24/7 to assist you.", "buttonText": "Contact Support", "buttonLink": "/register", "bgStyle": "bg-primary"}'::jsonb);
  END IF;

  -- Documentation page
  SELECT id INTO v_page_id FROM cms_pages WHERE slug = 'documentation';
  IF v_page_id IS NOT NULL AND NOT EXISTS (SELECT 1 FROM cms_page_blocks WHERE page_id = v_page_id) THEN
    INSERT INTO cms_page_blocks (page_id, block_type, sort_order, is_visible, config) VALUES
    (v_page_id, 'hero', 1, true, '{"eyebrow": "Documentation", "headline": "Learn Matbex", "subheadline": "Comprehensive guides and documentation to help you get the most out of Matbex.", "bgGradient": "bg-gradient-to-b from-gray-50 to-white"}'::jsonb),
    (v_page_id, 'cards', 2, true, '{"title": "Documentation Sections", "columns": 2, "cards": [{"title": "Quick Start Guide", "description": "Get up and running with Matbex in under 10 minutes", "icon": "Zap"}, {"title": "Dashboard Overview", "description": "Understanding your main dashboard and key metrics", "icon": "BarChart3"}, {"title": "Inventory Management", "description": "Complete guide to managing your inventory and suppliers", "icon": "Package"}, {"title": "Financial Reports", "description": "Generate P&L statements, COGS reports, and more", "icon": "TrendingUp"}]}'::jsonb),
    (v_page_id, 'text', 3, true, '{"title": "Getting Help", "content": "If you cannot find what you are looking for in our documentation, our support team is here to help. You can reach us through the Help Center or by emailing support@matbex.com."}'::jsonb);
  END IF;

  -- API page
  SELECT id INTO v_page_id FROM cms_pages WHERE slug = 'api';
  IF v_page_id IS NOT NULL AND NOT EXISTS (SELECT 1 FROM cms_page_blocks WHERE page_id = v_page_id) THEN
    INSERT INTO cms_page_blocks (page_id, block_type, sort_order, is_visible, config) VALUES
    (v_page_id, 'hero', 1, true, '{"eyebrow": "Developer Resources", "headline": "Matbex API", "subheadline": "Build powerful integrations with our comprehensive RESTful API. Access real-time data, automate workflows, and extend Matbex functionality.", "primaryCtaText": "View API Reference", "primaryCtaLink": "/documentation", "bgGradient": "bg-gradient-to-br from-slate-900 via-slate-800 to-slate-900"}'::jsonb),
    (v_page_id, 'features', 2, true, '{"title": "API Capabilities", "subtitle": "Everything you need to integrate with Matbex", "items": [{"title": "RESTful Architecture", "description": "Clean, predictable URLs with standard HTTP methods", "icon": "Code"}, {"title": "Real-Time Webhooks", "description": "Get notified instantly when events occur in your restaurant", "icon": "Zap"}, {"title": "OAuth 2.0 Authentication", "description": "Secure, industry-standard authentication for all API calls", "icon": "Shield"}, {"title": "Comprehensive SDKs", "description": "Official libraries for JavaScript, Python, and Ruby", "icon": "Package"}, {"title": "Rate Limiting", "description": "Generous rate limits with clear headers and documentation", "icon": "Clock"}, {"title": "Sandbox Environment", "description": "Test your integrations safely before going live", "icon": "Settings"}]}'::jsonb),
    (v_page_id, 'cta', 3, true, '{"headline": "Ready to Build?", "description": "Get your API keys and start integrating with Matbex today.", "buttonText": "Get API Keys", "buttonLink": "/register", "bgStyle": "bg-primary"}'::jsonb);
  END IF;

  -- Integrations page
  SELECT id INTO v_page_id FROM cms_pages WHERE slug = 'integrations';
  IF v_page_id IS NOT NULL AND NOT EXISTS (SELECT 1 FROM cms_page_blocks WHERE page_id = v_page_id) THEN
    INSERT INTO cms_page_blocks (page_id, block_type, sort_order, is_visible, config) VALUES
    (v_page_id, 'hero', 1, true, '{"eyebrow": "Integrations", "headline": "Connect Your Tools", "subheadline": "Matbex integrates seamlessly with the tools you already use. Streamline your operations with powerful connections.", "bgGradient": "bg-gradient-to-b from-gray-50 to-white"}'::jsonb),
    (v_page_id, 'cards', 2, true, '{"title": "Popular Integrations", "columns": 3, "cards": [{"title": "Point of Sale", "description": "Connect with Square, Toast, Clover, and more POS systems", "icon": "CreditCard"}, {"title": "Accounting", "description": "Sync with QuickBooks, Xero, and other accounting software", "icon": "BarChart3"}, {"title": "Delivery Platforms", "description": "Integrate with UberEats, DoorDash, and Grubhub", "icon": "Globe"}, {"title": "Inventory Suppliers", "description": "Connect with major food distributors for automatic ordering", "icon": "Package"}, {"title": "Payroll Systems", "description": "Sync staff data with ADP, Gusto, and other payroll providers", "icon": "Users"}, {"title": "Communication", "description": "Integrate with Slack, Teams, and email for notifications", "icon": "Zap"}]}'::jsonb),
    (v_page_id, 'cta', 3, true, '{"headline": "Need a Custom Integration?", "description": "Our team can help build custom integrations for your specific needs.", "buttonText": "Contact Us", "buttonLink": "/register", "bgStyle": "bg-primary"}'::jsonb);
  END IF;

  -- Careers page
  SELECT id INTO v_page_id FROM cms_pages WHERE slug = 'careers';
  IF v_page_id IS NOT NULL AND NOT EXISTS (SELECT 1 FROM cms_page_blocks WHERE page_id = v_page_id) THEN
    INSERT INTO cms_page_blocks (page_id, block_type, sort_order, is_visible, config) VALUES
    (v_page_id, 'hero', 1, true, '{"eyebrow": "Join Our Team", "headline": "Build the Future of Restaurants", "subheadline": "We are looking for passionate individuals who want to revolutionize the restaurant industry. Join us in building something meaningful.", "primaryCtaText": "View Open Positions", "bgGradient": "bg-gradient-to-br from-slate-900 via-slate-800 to-slate-900"}'::jsonb),
    (v_page_id, 'features', 2, true, '{"title": "Why Join Matbex?", "subtitle": "We offer more than just a job", "items": [{"title": "Remote-First Culture", "description": "Work from anywhere in the world with flexible hours", "icon": "Globe"}, {"title": "Competitive Compensation", "description": "Top-tier salary, equity, and comprehensive benefits", "icon": "TrendingUp"}, {"title": "Growth Opportunities", "description": "Learn from industry experts and advance your career", "icon": "Zap"}, {"title": "Impactful Work", "description": "Help thousands of restaurants succeed and grow", "icon": "Star"}]}'::jsonb),
    (v_page_id, 'text', 3, true, '{"title": "Open Positions", "content": "We are currently hiring for:\n\n• Senior Full-Stack Engineer\n• Product Designer\n• Customer Success Manager\n• Sales Development Representative\n\nDo not see a role that fits? We are always looking for talented individuals. Send your resume to careers@matbex.com."}'::jsonb),
    (v_page_id, 'cta', 4, true, '{"headline": "Ready to Make an Impact?", "description": "Join a team that is passionate about helping restaurants thrive.", "buttonText": "Apply Now", "buttonLink": "/register", "bgStyle": "bg-primary"}'::jsonb);
  END IF;

  -- Cookies page
  SELECT id INTO v_page_id FROM cms_pages WHERE slug = 'cookies';
  IF v_page_id IS NOT NULL AND NOT EXISTS (SELECT 1 FROM cms_page_blocks WHERE page_id = v_page_id) THEN
    INSERT INTO cms_page_blocks (page_id, block_type, sort_order, is_visible, config) VALUES
    (v_page_id, 'hero', 1, true, '{"headline": "Cookie Policy", "subheadline": "This policy explains how we use cookies and similar technologies.", "bgGradient": "bg-gradient-to-b from-gray-100 to-white"}'::jsonb),
    (v_page_id, 'text', 2, true, '{"title": "What Are Cookies?", "content": "Cookies are small text files that are stored on your device when you visit a website. They help us provide you with a better experience by remembering your preferences and understanding how you use our services."}'::jsonb),
    (v_page_id, 'text', 3, true, '{"title": "How We Use Cookies", "content": "We use cookies for:\n\n• Authentication: To keep you signed in\n• Preferences: To remember your settings\n• Analytics: To understand how you use our service\n• Security: To detect and prevent fraud\n\nYou can control cookies through your browser settings. However, disabling certain cookies may affect your experience with our services."}'::jsonb);
  END IF;

  -- Community page
  SELECT id INTO v_page_id FROM cms_pages WHERE slug = 'community';
  IF v_page_id IS NOT NULL AND NOT EXISTS (SELECT 1 FROM cms_page_blocks WHERE page_id = v_page_id) THEN
    INSERT INTO cms_page_blocks (page_id, block_type, sort_order, is_visible, config) VALUES
    (v_page_id, 'hero', 1, true, '{"eyebrow": "Community", "headline": "Join the Matbex Community", "subheadline": "Connect with thousands of restaurant operators, share insights, and learn from industry experts.", "primaryCtaText": "Join Community", "primaryCtaLink": "/register", "bgGradient": "bg-gradient-to-b from-gray-50 to-white"}'::jsonb),
    (v_page_id, 'stats', 2, true, '{"stats": [{"value": "5,000+", "label": "Community Members"}, {"value": "100+", "label": "Weekly Discussions"}, {"value": "50+", "label": "Expert Contributors"}, {"value": "24/7", "label": "Active Support"}]}'::jsonb),
    (v_page_id, 'features', 3, true, '{"title": "Community Benefits", "items": [{"title": "Peer Support", "description": "Get advice from fellow restaurant operators who understand your challenges", "icon": "Users"}, {"title": "Expert Insights", "description": "Access exclusive content from industry experts and thought leaders", "icon": "Star"}, {"title": "Early Access", "description": "Be the first to try new features and provide feedback", "icon": "Zap"}, {"title": "Networking", "description": "Build relationships with operators across the industry", "icon": "Globe"}]}'::jsonb),
    (v_page_id, 'cta', 4, true, '{"headline": "Ready to Connect?", "description": "Join thousands of restaurant operators in our community.", "buttonText": "Get Started", "buttonLink": "/register", "bgStyle": "bg-primary"}'::jsonb);
  END IF;

  -- Status page
  SELECT id INTO v_page_id FROM cms_pages WHERE slug = 'status';
  IF v_page_id IS NOT NULL AND NOT EXISTS (SELECT 1 FROM cms_page_blocks WHERE page_id = v_page_id) THEN
    INSERT INTO cms_page_blocks (page_id, block_type, sort_order, is_visible, config) VALUES
    (v_page_id, 'hero', 1, true, '{"headline": "System Status", "subheadline": "Real-time status and uptime information for all Matbex services.", "bgGradient": "bg-gradient-to-b from-gray-50 to-white"}'::jsonb),
    (v_page_id, 'stats', 2, true, '{"stats": [{"value": "99.99%", "label": "Uptime (30 days)"}, {"value": "45ms", "label": "Avg Response Time"}, {"value": "0", "label": "Active Incidents"}, {"value": "All", "label": "Services Operational"}]}'::jsonb),
    (v_page_id, 'text', 3, true, '{"title": "Service Status", "content": "All systems are currently operational.\n\n✓ Web Application - Operational\n✓ API Services - Operational\n✓ Database - Operational\n✓ Authentication - Operational\n✓ File Storage - Operational\n✓ Real-time Features - Operational"}'::jsonb),
    (v_page_id, 'text', 4, true, '{"title": "Subscribe to Updates", "content": "Want to be notified of service disruptions? Subscribe to our status updates by emailing status-subscribe@matbex.com."}'::jsonb);
  END IF;

  -- Blog page
  SELECT id INTO v_page_id FROM cms_pages WHERE slug = 'blog';
  IF v_page_id IS NOT NULL AND NOT EXISTS (SELECT 1 FROM cms_page_blocks WHERE page_id = v_page_id) THEN
    INSERT INTO cms_page_blocks (page_id, block_type, sort_order, is_visible, config) VALUES
    (v_page_id, 'hero', 1, true, '{"eyebrow": "Blog", "headline": "Insights & Updates", "subheadline": "The latest news, tips, and insights from the Matbex team.", "bgGradient": "bg-gradient-to-b from-gray-50 to-white"}'::jsonb),
    (v_page_id, 'cards', 2, true, '{"title": "Featured Posts", "columns": 3, "cards": [{"title": "The Future of Restaurant Analytics", "description": "How data-driven decisions are transforming the hospitality industry", "icon": "BarChart3"}, {"title": "Reducing Food Waste with Technology", "description": "Practical strategies for minimizing waste and maximizing profits", "icon": "Package"}, {"title": "Building a Resilient Supply Chain", "description": "Lessons learned from navigating supply chain challenges", "icon": "Globe"}]}'::jsonb),
    (v_page_id, 'cta', 3, true, '{"headline": "Stay Updated", "description": "Subscribe to our newsletter for the latest insights and product updates.", "buttonText": "Subscribe", "buttonLink": "/register", "bgStyle": "bg-primary"}'::jsonb);
  END IF;

  -- Press page
  SELECT id INTO v_page_id FROM cms_pages WHERE slug = 'press';
  IF v_page_id IS NOT NULL AND NOT EXISTS (SELECT 1 FROM cms_page_blocks WHERE page_id = v_page_id) THEN
    INSERT INTO cms_page_blocks (page_id, block_type, sort_order, is_visible, config) VALUES
    (v_page_id, 'hero', 1, true, '{"eyebrow": "Press", "headline": "Matbex in the News", "subheadline": "Read the latest coverage and announcements about Matbex.", "bgGradient": "bg-gradient-to-b from-gray-50 to-white"}'::jsonb),
    (v_page_id, 'text', 2, true, '{"title": "Media Contact", "content": "For press inquiries, please contact our communications team at press@matbex.com.\n\nWe typically respond within 24 hours during business days."}'::jsonb),
    (v_page_id, 'text', 3, true, '{"title": "Recent Coverage", "content": "• TechCrunch: \"Matbex Raises Series A to Transform Restaurant Operations\"\n• Restaurant Business: \"The New Wave of Restaurant Tech\"\n• Forbes: \"How AI is Changing the Way Restaurants Manage Inventory\"\n• Nation''s Restaurant News: \"Top 10 Restaurant Technology Companies to Watch\""}'::jsonb),
    (v_page_id, 'cta', 4, true, '{"headline": "Download Press Kit", "description": "Access logos, executive bios, and company information.", "buttonText": "Download Press Kit", "buttonLink": "/register", "bgStyle": "bg-primary"}'::jsonb);
  END IF;

END $$;