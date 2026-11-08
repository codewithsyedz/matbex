ALTER TABLE public.zatca_settings
  ADD COLUMN IF NOT EXISTS active_device_id uuid REFERENCES public.zatca_devices(id) ON DELETE SET NULL;

CREATE OR REPLACE FUNCTION public.next_zatca_chain(
  _device_id uuid,
  _invoice_hash text
)
RETURNS TABLE (icv bigint, pih text)
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = public
AS $$
DECLARE
  _prev_pih text;
  _new_icv  bigint;
BEGIN
  -- Lock the device row to serialize ICV allocation per device.
  SELECT last_pih, icv_counter + 1
    INTO _prev_pih, _new_icv
  FROM public.zatca_devices
  WHERE id = _device_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'zatca_device % not found', _device_id
      USING ERRCODE = '22023';
  END IF;

  UPDATE public.zatca_devices
     SET icv_counter = _new_icv,
         last_pih    = _invoice_hash,
         updated_at  = now()
   WHERE id = _device_id;

  icv := _new_icv;
  pih := COALESCE(_prev_pih, '0'); -- "0" = genesis per ZATCA spec
  RETURN NEXT;
END;
$$;

REVOKE ALL ON FUNCTION public.next_zatca_chain(uuid, text) FROM public;
GRANT EXECUTE ON FUNCTION public.next_zatca_chain(uuid, text) TO authenticated;