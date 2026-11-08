-- Create enum for staff roles
CREATE TYPE public.staff_role AS ENUM ('cook', 'tandoor', 'waiter', 'cleaner');

-- Create staff table
CREATE TABLE public.staff (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  restaurant_id UUID NOT NULL REFERENCES public.restaurants(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  phone TEXT,
  role staff_role NOT NULL,
  hourly_rate NUMERIC NOT NULL DEFAULT 0,
  monthly_salary NUMERIC,
  payment_type TEXT NOT NULL DEFAULT 'hourly' CHECK (payment_type IN ('hourly', 'monthly')),
  is_active BOOLEAN NOT NULL DEFAULT true,
  joined_date DATE NOT NULL DEFAULT CURRENT_DATE,
  notes TEXT,
  created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
  updated_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now()
);

-- Create payroll records table
CREATE TABLE public.payroll_records (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  restaurant_id UUID NOT NULL REFERENCES public.restaurants(id) ON DELETE CASCADE,
  staff_id UUID NOT NULL REFERENCES public.staff(id) ON DELETE CASCADE,
  amount NUMERIC NOT NULL,
  payment_date DATE NOT NULL DEFAULT CURRENT_DATE,
  period_start DATE NOT NULL,
  period_end DATE NOT NULL,
  hours_worked NUMERIC,
  deductions NUMERIC DEFAULT 0,
  bonus NUMERIC DEFAULT 0,
  notes TEXT,
  created_by UUID NOT NULL,
  created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now()
);

-- Enable RLS
ALTER TABLE public.staff ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.payroll_records ENABLE ROW LEVEL SECURITY;

-- Staff policies
CREATE POLICY "Users can view staff in their restaurant"
ON public.staff FOR SELECT
USING (user_belongs_to_restaurant(auth.uid(), restaurant_id));

CREATE POLICY "Managers+ can manage staff"
ON public.staff FOR ALL
USING (has_role(auth.uid(), restaurant_id, 'owner') OR has_role(auth.uid(), restaurant_id, 'manager'));

-- Payroll policies
CREATE POLICY "Users can view payroll in their restaurant"
ON public.payroll_records FOR SELECT
USING (user_belongs_to_restaurant(auth.uid(), restaurant_id));

CREATE POLICY "Managers+ can insert payroll"
ON public.payroll_records FOR INSERT
WITH CHECK ((has_role(auth.uid(), restaurant_id, 'owner') OR has_role(auth.uid(), restaurant_id, 'manager')) AND created_by = auth.uid());

CREATE POLICY "Owners can update payroll"
ON public.payroll_records FOR UPDATE
USING (has_role(auth.uid(), restaurant_id, 'owner'));

CREATE POLICY "Owners can delete payroll"
ON public.payroll_records FOR DELETE
USING (has_role(auth.uid(), restaurant_id, 'owner'));

-- Add triggers for updated_at
CREATE TRIGGER update_staff_updated_at
BEFORE UPDATE ON public.staff
FOR EACH ROW
EXECUTE FUNCTION public.update_updated_at_column();