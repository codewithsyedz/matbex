-- Seed CMS pages and blocks for all footer pages

-- First, ensure all pages exist in cms_pages
INSERT INTO public.cms_pages (slug, title, is_published, meta_title, meta_description)
VALUES 
  ('blog', 'Blog', true, 'Blog | Matbex', 'Expert tips, industry trends, and practical guides to help you run a more profitable restaurant.'),
  ('careers', 'Careers', true, 'Careers | Matbex', 'Join our remote-first team and help us empower restaurants worldwide.'),
  ('press', 'Press', true, 'Press | Matbex', 'Stay updated on our latest announcements, media coverage, and company news.'),
  ('privacy', 'Privacy Policy', true, 'Privacy Policy | Matbex', 'Learn how Matbex collects, uses, and protects your personal information.'),
  ('terms', 'Terms of Service', true, 'Terms of Service | Matbex', 'Terms and conditions for using the Matbex platform.'),
  ('security', 'Security', true, 'Security | Matbex', 'Your data security is our top priority. Learn how we protect your restaurant''s information.'),
  ('cookies', 'Cookie Policy', true, 'Cookie Policy | Matbex', 'Learn about the cookies we use and how to manage them.'),
  ('help-center', 'Help Center', true, 'Help Center | Matbex', 'Search our knowledge base or browse categories for help.'),
  ('community', 'Community', true, 'Community | Matbex', 'Join thousands of restaurant owners transforming their businesses with Matbex.'),
  ('documentation', 'Documentation', true, 'Documentation | Matbex', 'Everything you need to master Matbex and transform your restaurant operations.'),
  ('status', 'System Status', true, 'System Status | Matbex', 'Real-time status and uptime information for Matbex services.')
ON CONFLICT (slug) DO UPDATE SET
  title = EXCLUDED.title,
  is_published = EXCLUDED.is_published,
  meta_title = EXCLUDED.meta_title,
  meta_description = EXCLUDED.meta_description;

-- Blog page blocks
INSERT INTO public.cms_page_blocks (page_id, block_type, config, sort_order, is_visible)
SELECT p.id, 'hero', jsonb_build_object(
  'variant', 'light',
  'badge', 'Blog',
  'badgeIcon', 'BookOpen',
  'title', 'Insights for Restaurant Success',
  'subtitle', 'Expert tips, industry trends, and practical guides to help you run a more profitable restaurant.'
), 1, true
FROM public.cms_pages p WHERE p.slug = 'blog'
ON CONFLICT DO NOTHING;

INSERT INTO public.cms_page_blocks (page_id, block_type, config, sort_order, is_visible)
SELECT p.id, 'cards', jsonb_build_object(
  'variant', 'light',
  'title', 'Latest Articles',
  'columns', 3,
  'cards', jsonb_build_array(
    jsonb_build_object('icon', 'TrendingUp', 'title', 'The Future of Restaurant Management: AI-Powered Operations', 'description', 'Discover how artificial intelligence is revolutionizing the way restaurants track costs, manage inventory, and optimize their operations for maximum profitability.'),
    jsonb_build_object('icon', 'Leaf', 'title', '5 Ways to Reduce Food Waste and Boost Profits', 'description', 'Practical strategies for restaurants to minimize waste while maximizing their bottom line.'),
    jsonb_build_object('icon', 'DollarSign', 'title', 'Understanding Your Restaurant''s Prime Cost', 'description', 'A comprehensive guide to calculating and optimizing your prime cost percentage.'),
    jsonb_build_object('icon', 'Users', 'title', 'Building a High-Performance Kitchen Team', 'description', 'Tips for hiring, training, and retaining top culinary talent in today''s competitive market.'),
    jsonb_build_object('icon', 'Package', 'title', 'Inventory Management Best Practices', 'description', 'How to implement an inventory system that reduces costs and prevents stockouts.'),
    jsonb_build_object('icon', 'BarChart3', 'title', 'The Complete Guide to Restaurant KPIs', 'description', 'Key performance indicators every restaurant owner should track daily, weekly, and monthly.')
  )
), 2, true
FROM public.cms_pages p WHERE p.slug = 'blog'
ON CONFLICT DO NOTHING;

INSERT INTO public.cms_page_blocks (page_id, block_type, config, sort_order, is_visible)
SELECT p.id, 'cta', jsonb_build_object(
  'variant', 'light',
  'title', 'Subscribe to Our Newsletter',
  'subtitle', 'Get the latest insights and tips delivered to your inbox every week.',
  'buttonText', 'Subscribe',
  'buttonLink', '#'
), 3, true
FROM public.cms_pages p WHERE p.slug = 'blog'
ON CONFLICT DO NOTHING;

-- Careers page blocks
INSERT INTO public.cms_page_blocks (page_id, block_type, config, sort_order, is_visible)
SELECT p.id, 'hero', jsonb_build_object(
  'variant', 'light',
  'badge', 'Careers',
  'badgeIcon', 'Briefcase',
  'title', 'Join Us in Transforming Restaurant Operations',
  'subtitle', 'We''re building the future of restaurant management. Join our remote-first team and help us empower restaurants worldwide.',
  'buttonText', 'View Open Positions',
  'buttonLink', '#openings'
), 1, true
FROM public.cms_pages p WHERE p.slug = 'careers'
ON CONFLICT DO NOTHING;

INSERT INTO public.cms_page_blocks (page_id, block_type, config, sort_order, is_visible)
SELECT p.id, 'cards', jsonb_build_object(
  'variant', 'light',
  'title', 'How We Work',
  'columns', 3,
  'cards', jsonb_build_array(
    jsonb_build_object('icon', 'Zap', 'title', 'Move Fast', 'description', 'We ship quickly and iterate based on real feedback.'),
    jsonb_build_object('icon', 'Users', 'title', 'Customer Obsession', 'description', 'Every decision starts with what''s best for our users.'),
    jsonb_build_object('icon', 'Heart', 'title', 'Care Deeply', 'description', 'We care about our work, our team, and our impact.')
  )
), 2, true
FROM public.cms_pages p WHERE p.slug = 'careers'
ON CONFLICT DO NOTHING;

INSERT INTO public.cms_page_blocks (page_id, block_type, config, sort_order, is_visible)
SELECT p.id, 'cards', jsonb_build_object(
  'variant', 'light',
  'title', 'Benefits & Perks',
  'subtitle', 'We take care of our team so they can focus on doing their best work.',
  'columns', 3,
  'cards', jsonb_build_array(
    jsonb_build_object('icon', 'Heart', 'title', 'Health & Wellness', 'description', 'Comprehensive medical, dental, and vision coverage'),
    jsonb_build_object('icon', 'Plane', 'title', 'Unlimited PTO', 'description', 'Take time off when you need it, no questions asked'),
    jsonb_build_object('icon', 'Coffee', 'title', 'Remote-First', 'description', 'Work from anywhere in the world'),
    jsonb_build_object('icon', 'GraduationCap', 'title', 'Learning Budget', 'description', '$2,000 annual budget for courses and conferences'),
    jsonb_build_object('icon', 'DollarSign', 'title', 'Competitive Pay', 'description', 'Top-of-market salaries with equity options'),
    jsonb_build_object('icon', 'Users', 'title', 'Team Retreats', 'description', 'Annual all-company gatherings in amazing locations')
  )
), 3, true
FROM public.cms_pages p WHERE p.slug = 'careers'
ON CONFLICT DO NOTHING;

INSERT INTO public.cms_page_blocks (page_id, block_type, config, sort_order, is_visible)
SELECT p.id, 'cta', jsonb_build_object(
  'variant', 'dark',
  'title', 'Don''t See the Right Role?',
  'subtitle', 'We''re always looking for talented people. Send us your resume and we''ll keep you in mind.',
  'buttonText', 'Get in Touch',
  'buttonLink', 'mailto:careers@matbex.net'
), 4, true
FROM public.cms_pages p WHERE p.slug = 'careers'
ON CONFLICT DO NOTHING;

-- Press page blocks
INSERT INTO public.cms_page_blocks (page_id, block_type, config, sort_order, is_visible)
SELECT p.id, 'hero', jsonb_build_object(
  'variant', 'light',
  'badge', 'Press',
  'badgeIcon', 'Newspaper',
  'title', 'Matbex in the News',
  'subtitle', 'Stay updated on our latest announcements, media coverage, and company news.',
  'buttonText', 'Media Inquiries',
  'buttonLink', 'mailto:press@matbex.net'
), 1, true
FROM public.cms_pages p WHERE p.slug = 'press'
ON CONFLICT DO NOTHING;

INSERT INTO public.cms_page_blocks (page_id, block_type, config, sort_order, is_visible)
SELECT p.id, 'cards', jsonb_build_object(
  'variant', 'light',
  'title', 'Press Releases',
  'columns', 2,
  'cards', jsonb_build_array(
    jsonb_build_object('title', 'Matbex Launches AI-Powered Inventory Forecasting', 'description', 'New feature uses machine learning to predict inventory needs and reduce food waste by up to 30%.'),
    jsonb_build_object('title', 'Matbex Expands to 15 New Countries', 'description', 'Restaurant management platform now available in MENA, Southeast Asia, and Latin America.'),
    jsonb_build_object('title', 'Matbex Raises $12M Series A to Accelerate Growth', 'description', 'Funding led by top-tier investors to expand platform capabilities and global reach.'),
    jsonb_build_object('title', 'Matbex Named ''Best Restaurant Tech Startup'' at FoodTech Awards', 'description', 'Recognition for innovation in restaurant operations and cost management.')
  )
), 2, true
FROM public.cms_pages p WHERE p.slug = 'press'
ON CONFLICT DO NOTHING;

INSERT INTO public.cms_page_blocks (page_id, block_type, config, sort_order, is_visible)
SELECT p.id, 'stats', jsonb_build_object(
  'variant', 'dark',
  'title', 'Company Facts',
  'stats', jsonb_build_array(
    jsonb_build_object('value', '2024', 'label', 'Founded'),
    jsonb_build_object('value', 'Remote-first', 'label', 'Headquarters'),
    jsonb_build_object('value', '500+', 'label', 'Customers'),
    jsonb_build_object('value', '15+', 'label', 'Countries')
  )
), 3, true
FROM public.cms_pages p WHERE p.slug = 'press'
ON CONFLICT DO NOTHING;

-- Privacy Policy page blocks
INSERT INTO public.cms_page_blocks (page_id, block_type, config, sort_order, is_visible)
SELECT p.id, 'hero', jsonb_build_object(
  'variant', 'light',
  'badge', 'Legal',
  'badgeIcon', 'Shield',
  'title', 'Privacy Policy',
  'subtitle', 'Last updated: February 1, 2026'
), 1, true
FROM public.cms_pages p WHERE p.slug = 'privacy'
ON CONFLICT DO NOTHING;

INSERT INTO public.cms_page_blocks (page_id, block_type, config, sort_order, is_visible)
SELECT p.id, 'text', jsonb_build_object(
  'variant', 'light',
  'content', E'## 1. Introduction\n\nMatbex ("we," "our," or "us") is committed to protecting your privacy. This Privacy Policy explains how we collect, use, disclose, and safeguard your information when you use our restaurant management platform and related services.\n\n## 2. Information We Collect\n\n### 2.1 Personal Information\nWe may collect personal information that you voluntarily provide, including:\n- Name and contact information (email, phone number)\n- Business information (restaurant name, address)\n- Account credentials\n- Payment and billing information\n- Communications you send to us\n\n### 2.2 Automatically Collected Information\nWhen you access our platform, we automatically collect:\n- Device information (browser type, operating system)\n- IP address and location data\n- Usage data and analytics\n- Cookies and similar tracking technologies\n\n## 3. How We Use Your Information\n\nWe use the collected information to:\n- Provide, maintain, and improve our services\n- Process transactions and send related information\n- Send administrative information and updates\n- Respond to inquiries and provide customer support\n- Monitor and analyze usage patterns and trends\n- Detect, prevent, and address technical issues\n- Comply with legal obligations\n\n## 4. Information Sharing\n\nWe do not sell your personal information. We may share your information with:\n- Service providers who assist in our operations\n- Business partners with your consent\n- Legal authorities when required by law\n- Parties involved in business transfers or acquisitions\n\n## 5. Data Security\n\nWe implement appropriate technical and organizational security measures to protect your personal information. However, no method of transmission over the Internet is 100% secure, and we cannot guarantee absolute security.\n\n## 6. Your Rights\n\nDepending on your location, you may have the right to:\n- Access and receive a copy of your personal data\n- Rectify inaccurate personal data\n- Request deletion of your personal data\n- Object to or restrict processing of your data\n- Data portability\n- Withdraw consent at any time\n\n## 7. Contact Us\n\nIf you have questions about this Privacy Policy, please contact us at:\nEmail: privacy@matbex.net'
), 2, true
FROM public.cms_pages p WHERE p.slug = 'privacy'
ON CONFLICT DO NOTHING;

-- Terms of Service page blocks
INSERT INTO public.cms_page_blocks (page_id, block_type, config, sort_order, is_visible)
SELECT p.id, 'hero', jsonb_build_object(
  'variant', 'light',
  'badge', 'Legal',
  'badgeIcon', 'FileText',
  'title', 'Terms of Service',
  'subtitle', 'Last updated: February 1, 2026'
), 1, true
FROM public.cms_pages p WHERE p.slug = 'terms'
ON CONFLICT DO NOTHING;

INSERT INTO public.cms_page_blocks (page_id, block_type, config, sort_order, is_visible)
SELECT p.id, 'text', jsonb_build_object(
  'variant', 'light',
  'content', E'## 1. Acceptance of Terms\n\nBy accessing or using Matbex ("Service"), you agree to be bound by these Terms of Service ("Terms"). If you disagree with any part of these terms, you may not access the Service.\n\n## 2. Description of Service\n\nMatbex provides a comprehensive restaurant management platform including but not limited to: point of sale, inventory management, staff management, financial reporting, and analytics tools. We reserve the right to modify, suspend, or discontinue any aspect of the Service at any time.\n\n## 3. User Accounts\n\n### 3.1 Registration\nYou must register for an account to use our Service. You agree to provide accurate, current, and complete information during registration and keep your account information updated.\n\n### 3.2 Account Security\nYou are responsible for safeguarding your account credentials and for all activities that occur under your account. You must notify us immediately of any unauthorized use.\n\n## 4. Subscription and Payment\n\n### 4.1 Billing\nPaid subscriptions are billed in advance on a monthly or annual basis. You authorize us to charge your payment method for all fees incurred.\n\n### 4.2 Cancellation\nYou may cancel your subscription at any time. Cancellation will take effect at the end of your current billing period. No refunds are provided for partial periods.\n\n## 5. Acceptable Use\n\nYou agree not to:\n- Violate any applicable laws or regulations\n- Infringe on intellectual property rights\n- Transmit malware or harmful code\n- Attempt to gain unauthorized access to our systems\n- Interfere with or disrupt the Service\n- Use the Service for fraudulent purposes\n\n## 6. Intellectual Property\n\nThe Service and its original content, features, and functionality are owned by Matbex and are protected by international copyright, trademark, and other intellectual property laws.\n\n## 7. Limitation of Liability\n\nTo the maximum extent permitted by law, Matbex shall not be liable for any indirect, incidental, special, consequential, or punitive damages, or any loss of profits or revenues.\n\n## 8. Contact Us\n\nIf you have questions about these Terms, please contact us at:\nEmail: legal@matbex.net'
), 2, true
FROM public.cms_pages p WHERE p.slug = 'terms'
ON CONFLICT DO NOTHING;

-- Security page blocks
INSERT INTO public.cms_page_blocks (page_id, block_type, config, sort_order, is_visible)
SELECT p.id, 'hero', jsonb_build_object(
  'variant', 'light',
  'badge', 'Security',
  'badgeIcon', 'Shield',
  'title', 'Security',
  'subtitle', 'Your data security is our top priority. Learn how we protect your restaurant''s information.'
), 1, true
FROM public.cms_pages p WHERE p.slug = 'security'
ON CONFLICT DO NOTHING;

INSERT INTO public.cms_page_blocks (page_id, block_type, config, sort_order, is_visible)
SELECT p.id, 'cards', jsonb_build_object(
  'variant', 'light',
  'title', 'Our Security Practices',
  'columns', 2,
  'cards', jsonb_build_array(
    jsonb_build_object('icon', 'Lock', 'title', 'Encryption in Transit', 'description', 'All data transmitted between your browser and our servers is encrypted using TLS 1.3, the latest and most secure protocol available.'),
    jsonb_build_object('icon', 'Lock', 'title', 'Encryption at Rest', 'description', 'All stored data is encrypted using AES-256 encryption, ensuring your information remains protected even in storage.'),
    jsonb_build_object('icon', 'Server', 'title', 'Cloud Infrastructure', 'description', 'We use enterprise-grade cloud infrastructure with SOC 2 Type II certification and regular security audits.'),
    jsonb_build_object('icon', 'Server', 'title', 'Network Security', 'description', 'Advanced firewalls, intrusion detection systems, and DDoS protection safeguard our network perimeter.'),
    jsonb_build_object('icon', 'Eye', 'title', 'Role-Based Access Control', 'description', 'Granular permissions allow you to control exactly what each team member can access and modify.'),
    jsonb_build_object('icon', 'Shield', 'title', 'Multi-Factor Authentication', 'description', 'Optional MFA adds an extra layer of security to protect your account from unauthorized access.')
  )
), 2, true
FROM public.cms_pages p WHERE p.slug = 'security'
ON CONFLICT DO NOTHING;

INSERT INTO public.cms_page_blocks (page_id, block_type, config, sort_order, is_visible)
SELECT p.id, 'cta', jsonb_build_object(
  'variant', 'light',
  'title', 'Report a Vulnerability',
  'subtitle', 'We appreciate the security community''s efforts in helping keep Matbex safe. If you discover a security vulnerability, please report it responsibly.',
  'buttonText', 'security@matbex.net',
  'buttonLink', 'mailto:security@matbex.net'
), 3, true
FROM public.cms_pages p WHERE p.slug = 'security'
ON CONFLICT DO NOTHING;

-- Cookies page blocks
INSERT INTO public.cms_page_blocks (page_id, block_type, config, sort_order, is_visible)
SELECT p.id, 'hero', jsonb_build_object(
  'variant', 'light',
  'badge', 'Legal',
  'badgeIcon', 'Cookie',
  'title', 'Cookie Policy',
  'subtitle', 'Last updated: February 1, 2026'
), 1, true
FROM public.cms_pages p WHERE p.slug = 'cookies'
ON CONFLICT DO NOTHING;

INSERT INTO public.cms_page_blocks (page_id, block_type, config, sort_order, is_visible)
SELECT p.id, 'text', jsonb_build_object(
  'variant', 'light',
  'content', E'## 1. What Are Cookies\n\nCookies are small text files that are stored on your device when you visit a website. They are widely used to make websites work more efficiently and provide information to website owners.\n\n## 2. Types of Cookies We Use\n\n### Essential Cookies\nThese cookies are necessary for the website to function properly. They enable core functionality such as security, network management, and account access.\n\n### Functional Cookies\nThese cookies enable enhanced functionality and personalization, such as remembering your language preference or region selection.\n\n### Analytics Cookies\nThese cookies help us understand how visitors interact with our website by collecting and reporting information anonymously.\n\n## 3. Third-Party Cookies\n\nSome cookies are placed by third-party services that appear on our pages. We use:\n- Payment Processors: Stripe for secure payment processing\n- Analytics: Google Analytics for understanding usage patterns\n- Support: Customer support chat widgets when available\n\n## 4. Managing Cookies\n\nMost web browsers allow you to control cookies through their settings. You can:\n- View what cookies are stored on your device\n- Delete all or specific cookies\n- Block all cookies or cookies from specific sites\n- Set preferences for certain types of cookies\n\n## 5. Contact Us\n\nIf you have questions about our use of cookies, please contact us at:\nEmail: privacy@matbex.net'
), 2, true
FROM public.cms_pages p WHERE p.slug = 'cookies'
ON CONFLICT DO NOTHING;

-- Help Center page blocks
INSERT INTO public.cms_page_blocks (page_id, block_type, config, sort_order, is_visible)
SELECT p.id, 'hero', jsonb_build_object(
  'variant', 'light',
  'badge', 'Support',
  'badgeIcon', 'HelpCircle',
  'title', 'How can we help?',
  'subtitle', 'Search our knowledge base or browse categories below'
), 1, true
FROM public.cms_pages p WHERE p.slug = 'help-center'
ON CONFLICT DO NOTHING;

INSERT INTO public.cms_page_blocks (page_id, block_type, config, sort_order, is_visible)
SELECT p.id, 'cards', jsonb_build_object(
  'variant', 'light',
  'columns', 3,
  'cards', jsonb_build_array(
    jsonb_build_object('icon', 'BookOpen', 'title', 'Getting Started', 'description', 'Learn the basics of Matbex and set up your restaurant'),
    jsonb_build_object('icon', 'MessageCircle', 'title', 'FAQs', 'description', 'Find answers to commonly asked questions'),
    jsonb_build_object('icon', 'Video', 'title', 'Video Tutorials', 'description', 'Watch step-by-step guides and tutorials')
  )
), 2, true
FROM public.cms_pages p WHERE p.slug = 'help-center'
ON CONFLICT DO NOTHING;

INSERT INTO public.cms_page_blocks (page_id, block_type, config, sort_order, is_visible)
SELECT p.id, 'cta', jsonb_build_object(
  'variant', 'light',
  'title', 'Still need help?',
  'subtitle', 'Our support team is available 24/7 to assist you',
  'buttonText', 'Contact Support',
  'buttonLink', 'mailto:support@matbex.net'
), 3, true
FROM public.cms_pages p WHERE p.slug = 'help-center'
ON CONFLICT DO NOTHING;

-- Community page blocks
INSERT INTO public.cms_page_blocks (page_id, block_type, config, sort_order, is_visible)
SELECT p.id, 'hero', jsonb_build_object(
  'variant', 'light',
  'badge', 'Join the Community',
  'badgeIcon', 'Users',
  'title', 'Connect with Fellow Restaurateurs',
  'subtitle', 'Join thousands of restaurant owners and managers who are transforming their businesses with Matbex',
  'buttonText', 'Join Community',
  'buttonLink', '#'
), 1, true
FROM public.cms_pages p WHERE p.slug = 'community'
ON CONFLICT DO NOTHING;

INSERT INTO public.cms_page_blocks (page_id, block_type, config, sort_order, is_visible)
SELECT p.id, 'stats', jsonb_build_object(
  'variant', 'light',
  'stats', jsonb_build_array(
    jsonb_build_object('value', '5,000+', 'label', 'Community Members'),
    jsonb_build_object('value', '150+', 'label', 'Countries'),
    jsonb_build_object('value', '10,000+', 'label', 'Discussions'),
    jsonb_build_object('value', '50+', 'label', 'Monthly Events')
  )
), 2, true
FROM public.cms_pages p WHERE p.slug = 'community'
ON CONFLICT DO NOTHING;

INSERT INTO public.cms_page_blocks (page_id, block_type, config, sort_order, is_visible)
SELECT p.id, 'cards', jsonb_build_object(
  'variant', 'light',
  'title', 'What You''ll Find',
  'columns', 2,
  'cards', jsonb_build_array(
    jsonb_build_object('icon', 'MessageSquare', 'title', 'Discussion Forums', 'description', 'Connect with other restaurant owners, share insights, and get advice from the community.'),
    jsonb_build_object('icon', 'Calendar', 'title', 'Events & Webinars', 'description', 'Join live sessions with industry experts and learn best practices for restaurant management.'),
    jsonb_build_object('icon', 'Award', 'title', 'Success Stories', 'description', 'Read how other restaurants have transformed their operations with Matbex.'),
    jsonb_build_object('icon', 'Users', 'title', 'Local Meetups', 'description', 'Find and connect with Matbex users in your area for networking opportunities.')
  )
), 3, true
FROM public.cms_pages p WHERE p.slug = 'community'
ON CONFLICT DO NOTHING;

INSERT INTO public.cms_page_blocks (page_id, block_type, config, sort_order, is_visible)
SELECT p.id, 'cta', jsonb_build_object(
  'variant', 'dark',
  'title', 'Ready to Join?',
  'subtitle', 'Become part of the fastest-growing restaurant management community',
  'buttonText', 'Get Started Free',
  'buttonLink', '/auth'
), 4, true
FROM public.cms_pages p WHERE p.slug = 'community'
ON CONFLICT DO NOTHING;

-- Documentation page blocks
INSERT INTO public.cms_page_blocks (page_id, block_type, config, sort_order, is_visible)
SELECT p.id, 'hero', jsonb_build_object(
  'variant', 'light',
  'badge', 'Documentation',
  'badgeIcon', 'Book',
  'title', 'Matbex Documentation',
  'subtitle', 'Everything you need to master Matbex and transform your restaurant operations',
  'buttonText', 'Get Started',
  'buttonLink', '#'
), 1, true
FROM public.cms_pages p WHERE p.slug = 'documentation'
ON CONFLICT DO NOTHING;

INSERT INTO public.cms_page_blocks (page_id, block_type, config, sort_order, is_visible)
SELECT p.id, 'cards', jsonb_build_object(
  'variant', 'light',
  'columns', 3,
  'cards', jsonb_build_array(
    jsonb_build_object('icon', 'Zap', 'title', 'Quick Start', 'description', 'Get up and running with Matbex in minutes'),
    jsonb_build_object('icon', 'Book', 'title', 'User Guides', 'description', 'Comprehensive guides for all Matbex features'),
    jsonb_build_object('icon', 'Code', 'title', 'API Reference', 'description', 'Complete API documentation for developers'),
    jsonb_build_object('icon', 'Database', 'title', 'Data Management', 'description', 'Learn how to manage and export your data'),
    jsonb_build_object('icon', 'Shield', 'title', 'Security', 'description', 'Security best practices and configurations'),
    jsonb_build_object('icon', 'Webhook', 'title', 'Integrations', 'description', 'Connect Matbex with your existing tools')
  )
), 2, true
FROM public.cms_pages p WHERE p.slug = 'documentation'
ON CONFLICT DO NOTHING;

INSERT INTO public.cms_page_blocks (page_id, block_type, config, sort_order, is_visible)
SELECT p.id, 'cta', jsonb_build_object(
  'variant', 'light',
  'title', 'Building with Matbex?',
  'subtitle', 'Explore our API documentation for seamless integrations',
  'buttonText', 'View API Docs',
  'buttonLink', '/api'
), 3, true
FROM public.cms_pages p WHERE p.slug = 'documentation'
ON CONFLICT DO NOTHING;

-- Status page blocks
INSERT INTO public.cms_page_blocks (page_id, block_type, config, sort_order, is_visible)
SELECT p.id, 'hero', jsonb_build_object(
  'variant', 'light',
  'badge', 'All Systems Operational',
  'badgeIcon', 'CheckCircle',
  'title', 'System Status',
  'subtitle', 'Real-time status and uptime information for Matbex services'
), 1, true
FROM public.cms_pages p WHERE p.slug = 'status'
ON CONFLICT DO NOTHING;

INSERT INTO public.cms_page_blocks (page_id, block_type, config, sort_order, is_visible)
SELECT p.id, 'cards', jsonb_build_object(
  'variant', 'light',
  'title', 'Current Status',
  'columns', 2,
  'cards', jsonb_build_array(
    jsonb_build_object('icon', 'CheckCircle', 'title', 'Web Application', 'description', 'Operational • 99.99% uptime'),
    jsonb_build_object('icon', 'CheckCircle', 'title', 'API Services', 'description', 'Operational • 99.98% uptime'),
    jsonb_build_object('icon', 'CheckCircle', 'title', 'Database', 'description', 'Operational • 99.99% uptime'),
    jsonb_build_object('icon', 'CheckCircle', 'title', 'Authentication', 'description', 'Operational • 99.99% uptime'),
    jsonb_build_object('icon', 'CheckCircle', 'title', 'File Storage', 'description', 'Operational • 99.97% uptime'),
    jsonb_build_object('icon', 'CheckCircle', 'title', 'Real-time Updates', 'description', 'Operational • 99.95% uptime')
  )
), 2, true
FROM public.cms_pages p WHERE p.slug = 'status'
ON CONFLICT DO NOTHING;

INSERT INTO public.cms_page_blocks (page_id, block_type, config, sort_order, is_visible)
SELECT p.id, 'cta', jsonb_build_object(
  'variant', 'light',
  'title', 'Stay Updated',
  'subtitle', 'Subscribe to receive notifications about system status and maintenance',
  'buttonText', 'Subscribe to Updates',
  'buttonLink', '#'
), 3, true
FROM public.cms_pages p WHERE p.slug = 'status'
ON CONFLICT DO NOTHING;