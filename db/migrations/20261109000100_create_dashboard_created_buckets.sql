-- Buckets that were created by hand in the hosted dashboard (their RLS policies
-- are in earlier migrations, but the bucket rows never were). Private buckets.
INSERT INTO storage.buckets (id, name, public)
VALUES ('fine-evidence', 'fine-evidence', false),
       ('zatca-application-docs', 'zatca-application-docs', false)
ON CONFLICT (id) DO NOTHING;
