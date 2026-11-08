-- Create table for POS hardware settings (printers and cash drawers)
CREATE TABLE public.pos_hardware_settings (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  restaurant_id UUID NOT NULL REFERENCES public.restaurants(id) ON DELETE CASCADE,
  
  -- Receipt Printer Settings
  receipt_printer_enabled BOOLEAN NOT NULL DEFAULT false,
  receipt_printer_type TEXT NOT NULL DEFAULT 'browser', -- 'browser', 'network', 'bluetooth'
  receipt_printer_ip TEXT,
  receipt_printer_port INTEGER DEFAULT 9100,
  receipt_printer_name TEXT,
  receipt_header TEXT,
  receipt_footer TEXT,
  print_receipt_on_sale BOOLEAN NOT NULL DEFAULT true,
  
  -- Kitchen Printer Settings
  kitchen_printer_enabled BOOLEAN NOT NULL DEFAULT false,
  kitchen_printer_type TEXT NOT NULL DEFAULT 'browser', -- 'browser', 'network', 'bluetooth'
  kitchen_printer_ip TEXT,
  kitchen_printer_port INTEGER DEFAULT 9100,
  kitchen_printer_name TEXT,
  print_kitchen_on_sale BOOLEAN NOT NULL DEFAULT true,
  
  -- Cash Drawer Settings
  cash_drawer_enabled BOOLEAN NOT NULL DEFAULT false,
  cash_drawer_connection TEXT NOT NULL DEFAULT 'printer', -- 'printer' (opens via printer), 'serial', 'none'
  cash_drawer_auto_open_cash BOOLEAN NOT NULL DEFAULT true,
  cash_drawer_kick_code TEXT DEFAULT '27,112,0,25,250', -- ESC/POS drawer kick command
  
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  
  UNIQUE(restaurant_id)
);

-- Enable RLS
ALTER TABLE public.pos_hardware_settings ENABLE ROW LEVEL SECURITY;

-- RLS Policies
CREATE POLICY "Users can view their restaurant's POS settings"
ON public.pos_hardware_settings
FOR SELECT
USING (
  restaurant_id IN (
    SELECT restaurant_id FROM public.profiles WHERE id = auth.uid()
  )
);

CREATE POLICY "Users can insert their restaurant's POS settings"
ON public.pos_hardware_settings
FOR INSERT
WITH CHECK (
  restaurant_id IN (
    SELECT restaurant_id FROM public.profiles WHERE id = auth.uid()
  )
);

CREATE POLICY "Users can update their restaurant's POS settings"
ON public.pos_hardware_settings
FOR UPDATE
USING (
  restaurant_id IN (
    SELECT restaurant_id FROM public.profiles WHERE id = auth.uid()
  )
);

-- Update timestamp trigger
CREATE TRIGGER update_pos_hardware_settings_updated_at
BEFORE UPDATE ON public.pos_hardware_settings
FOR EACH ROW
EXECUTE FUNCTION public.update_updated_at_column();