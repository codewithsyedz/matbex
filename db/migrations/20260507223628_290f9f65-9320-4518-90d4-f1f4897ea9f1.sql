
-- Server-side validator for zatca_settings. Mirrors the client-side zod schema
-- so the client cannot bypass rules by calling the API directly.
CREATE OR REPLACE FUNCTION public.validate_zatca_settings()
RETURNS trigger
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = public
AS $$
DECLARE
  v_name_en text := NULLIF(btrim(NEW.seller_name_en), '');
  v_name_ar text := NULLIF(btrim(NEW.seller_name_ar), '');
  v_vat     text := NULLIF(btrim(NEW.vat_registration_number), '');
BEGIN
  -- Normalize trimmed/empty strings back into the row
  NEW.seller_name_en := v_name_en;
  NEW.seller_name_ar := v_name_ar;
  NEW.vat_registration_number := v_vat;

  -- English seller name
  IF v_name_en IS NOT NULL THEN
    IF char_length(v_name_en) < 2 OR char_length(v_name_en) > 120 THEN
      RAISE EXCEPTION 'English seller name must be between 2 and 120 characters'
        USING ERRCODE = '22023';
    END IF;
    IF v_name_en !~ '[A-Za-z]' THEN
      RAISE EXCEPTION 'English seller name must contain Latin letters'
        USING ERRCODE = '22023';
    END IF;
  END IF;

  -- Arabic seller name
  IF v_name_ar IS NOT NULL THEN
    IF char_length(v_name_ar) < 2 OR char_length(v_name_ar) > 120 THEN
      RAISE EXCEPTION 'Arabic seller name must be between 2 and 120 characters'
        USING ERRCODE = '22023';
    END IF;
    IF v_name_ar !~ '[\u0600-\u06FF\u0750-\u077F\u08A0-\u08FF\uFB50-\uFDFF\uFE70-\uFEFF]' THEN
      RAISE EXCEPTION 'Arabic seller name must contain Arabic characters'
        USING ERRCODE = '22023';
    END IF;
  END IF;

  -- VAT structural rules (format already enforced by zatca_vat_format CHECK)
  IF v_vat IS NOT NULL THEN
    IF left(v_vat, 1) <> '3' OR right(v_vat, 1) <> '3' THEN
      RAISE EXCEPTION 'Saudi VAT numbers must start and end with the digit 3'
        USING ERRCODE = '22023';
    END IF;
    IF v_vat ~ '^(\d)\1{14}$' THEN
      RAISE EXCEPTION 'VAT number cannot consist of a single repeated digit'
        USING ERRCODE = '22023';
    END IF;
  END IF;

  -- QR enabled: must have a seller name AND a VAT number
  IF NEW.qr_enabled THEN
    IF v_name_en IS NULL AND v_name_ar IS NULL THEN
      RAISE EXCEPTION 'ZATCA QR is enabled - at least one seller name (English or Arabic) is required'
        USING ERRCODE = '22023';
    END IF;
    IF v_vat IS NULL THEN
      RAISE EXCEPTION 'ZATCA QR is enabled - VAT registration number is required'
        USING ERRCODE = '22023';
    END IF;
  END IF;

  -- Auto-PDF requires at least one display channel
  IF NEW.auto_generate_pdf_receipt
     AND NOT NEW.show_on_printed_receipt
     AND NOT NEW.show_on_digital_receipt THEN
    RAISE EXCEPTION 'Enable QR on at least one receipt channel (printed or digital) when auto-generating PDFs'
      USING ERRCODE = '22023';
  END IF;

  -- STRICT mode requires auto-PDF
  IF NEW.pdf_generation_mode = 'STRICT' AND NOT NEW.auto_generate_pdf_receipt THEN
    RAISE EXCEPTION 'Strict PDF mode requires auto-generated PDF receipts to be enabled'
      USING ERRCODE = '22023';
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_validate_zatca_settings ON public.zatca_settings;
CREATE TRIGGER trg_validate_zatca_settings
BEFORE INSERT OR UPDATE ON public.zatca_settings
FOR EACH ROW
EXECUTE FUNCTION public.validate_zatca_settings();
