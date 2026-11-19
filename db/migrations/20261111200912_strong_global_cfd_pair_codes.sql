-- strong_global_cfd_pair_codes
--
-- Customer-facing displays read their screen with only a pair code (cfd_get_session and
-- cfd_heartbeat are open to anon). Codes were 6 characters from Math.random(), about 1e9 per
-- restaurant, with no attempt limit, and restaurant ids appear in public storefront links; a
-- found code shows that display's cart, totals and message. The pair screen also could not
-- pair by typing a code: it has no restaurant field and the lookup needed one.
--
-- Now: 10-character codes from a CSPRNG over a 32-letter alphabet (~1.1e15), unique across all
-- restaurants so a code alone identifies the display; the lookup returns the restaurant;
-- shorter codes are rejected. Existing short codes are replaced (production has none).

CREATE OR REPLACE FUNCTION public.new_cfd_pair_code()
 RETURNS text
 LANGUAGE sql
 VOLATILE
 SET search_path TO 'public', 'extensions'
AS $function$
  -- 32 symbols divide 256 evenly, so byte % 32 is unbiased. No 0/O/1/I.
  SELECT string_agg(substr('ABCDEFGHJKLMNPQRSTUVWXYZ23456789', (get_byte(b, i) % 32) + 1, 1), '' ORDER BY i)
  FROM (SELECT gen_random_bytes(10) AS b) r, generate_series(0, 9) AS i
$function$;
REVOKE ALL ON FUNCTION public.new_cfd_pair_code() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.new_cfd_pair_code() TO authenticated, service_role;

UPDATE public.cfd_sessions SET pair_code = public.new_cfd_pair_code() WHERE length(pair_code) < 10;

ALTER TABLE public.cfd_sessions DROP CONSTRAINT IF EXISTS cfd_sessions_pair_code_min_length;
ALTER TABLE public.cfd_sessions
  ADD CONSTRAINT cfd_sessions_pair_code_min_length CHECK (length(pair_code) >= 10);
CREATE UNIQUE INDEX IF NOT EXISTS cfd_sessions_pair_code_key ON public.cfd_sessions (pair_code);
-- The database assigns codes; the app no longer makes them.
ALTER TABLE public.cfd_sessions ALTER COLUMN pair_code SET DEFAULT public.new_cfd_pair_code();

-- The result gains restaurant_id and pair_code, so drop and recreate (grants reapplied below).
DROP FUNCTION IF EXISTS public.cfd_get_session(uuid, text);
CREATE FUNCTION public.cfd_get_session(p_restaurant_id uuid, p_pair_code text)
 RETURNS TABLE(restaurant_id uuid, pair_code text, state text, cart jsonb, subtotal numeric, tax numeric,
               total numeric, message text, order_ref text)
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  SELECT s.restaurant_id, s.pair_code, s.state, s.cart, s.subtotal, s.tax, s.total, s.message, s.order_ref
  FROM public.cfd_sessions s
  WHERE length(p_pair_code) >= 10
    AND s.pair_code = upper(p_pair_code)
    AND (p_restaurant_id IS NULL OR s.restaurant_id = p_restaurant_id)
  LIMIT 1
$function$;
REVOKE ALL ON FUNCTION public.cfd_get_session(uuid, text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.cfd_get_session(uuid, text) TO anon, authenticated, service_role;

CREATE OR REPLACE FUNCTION public.cfd_heartbeat(p_restaurant_id uuid, p_pair_code text)
 RETURNS void
 LANGUAGE sql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  UPDATE public.cfd_sessions
  SET last_paired_at = now()
  WHERE length(p_pair_code) >= 10
    AND restaurant_id = p_restaurant_id
    AND pair_code = upper(p_pair_code)
$function$;
