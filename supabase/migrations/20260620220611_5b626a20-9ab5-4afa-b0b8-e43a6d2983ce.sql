DO $$
BEGIN
  SET LOCAL session_replication_role = replica;
  UPDATE public.branches
     SET is_primary = false,
         restaurant_id = 'fe1a4d9e-1595-43ba-a47a-37575a9a55b9'
   WHERE id = 'b5828a9b-bce6-4bf9-b5a5-6c0d42a66705';
END $$;