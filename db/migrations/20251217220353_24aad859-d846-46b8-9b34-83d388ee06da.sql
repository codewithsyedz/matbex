-- Create status enum for daily profit
CREATE TYPE public.profit_status AS ENUM ('excellent', 'healthy', 'attention', 'critical');

-- Create daily_profit_state table
CREATE TABLE public.daily_profit_state (
    id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
    date DATE NOT NULL,
    restaurant_id UUID NOT NULL REFERENCES public.restaurants(id) ON DELETE CASCADE,
    gross_sales NUMERIC NOT NULL DEFAULT 0,
    discounts NUMERIC NOT NULL DEFAULT 0,
    refunds NUMERIC NOT NULL DEFAULT 0,
    net_sales NUMERIC NOT NULL DEFAULT 0,
    food_cost NUMERIC NOT NULL DEFAULT 0,
    beverage_cost NUMERIC NOT NULL DEFAULT 0,
    labor_cost NUMERIC NOT NULL DEFAULT 0,
    other_expenses NUMERIC NOT NULL DEFAULT 0,
    allocated_overhead NUMERIC NOT NULL DEFAULT 0,
    prime_cost NUMERIC NOT NULL DEFAULT 0,
    prime_cost_percentage NUMERIC NOT NULL DEFAULT 0,
    operating_profit NUMERIC NOT NULL DEFAULT 0,
    operating_margin_percentage NUMERIC NOT NULL DEFAULT 0,
    status profit_status NOT NULL DEFAULT 'healthy',
    is_estimated BOOLEAN NOT NULL DEFAULT true,
    performance_score INTEGER NOT NULL DEFAULT 0,
    created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
    updated_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
    UNIQUE(date, restaurant_id)
);

-- Create shift_contribution table
CREATE TABLE public.shift_contribution (
    id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
    shift_id UUID NOT NULL REFERENCES public.shifts(id) ON DELETE CASCADE,
    daily_profit_id UUID REFERENCES public.daily_profit_state(id) ON DELETE SET NULL,
    date DATE NOT NULL,
    restaurant_id UUID NOT NULL REFERENCES public.restaurants(id) ON DELETE CASCADE,
    net_sales NUMERIC NOT NULL DEFAULT 0,
    cash_sales NUMERIC NOT NULL DEFAULT 0,
    card_sales NUMERIC NOT NULL DEFAULT 0,
    other_sales NUMERIC NOT NULL DEFAULT 0,
    estimated_food_cost NUMERIC NOT NULL DEFAULT 0,
    estimated_labor_cost NUMERIC NOT NULL DEFAULT 0,
    shift_profit_estimate NUMERIC NOT NULL DEFAULT 0,
    shift_margin_percentage NUMERIC NOT NULL DEFAULT 0,
    created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
    updated_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
    UNIQUE(shift_id)
);

-- Create profit_milestones table for tracking achievements
CREATE TABLE public.profit_milestones (
    id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
    restaurant_id UUID NOT NULL REFERENCES public.restaurants(id) ON DELETE CASCADE,
    milestone_type TEXT NOT NULL,
    milestone_value INTEGER NOT NULL,
    achieved_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
    created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now()
);

-- Create overhead_allocation table for configurable daily overhead
CREATE TABLE public.overhead_allocation (
    id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
    restaurant_id UUID NOT NULL REFERENCES public.restaurants(id) ON DELETE CASCADE,
    name TEXT NOT NULL,
    monthly_amount NUMERIC NOT NULL DEFAULT 0,
    daily_amount NUMERIC GENERATED ALWAYS AS (monthly_amount / 30) STORED,
    is_active BOOLEAN NOT NULL DEFAULT true,
    created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
    updated_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now()
);

-- Enable RLS
ALTER TABLE public.daily_profit_state ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.shift_contribution ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.profit_milestones ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.overhead_allocation ENABLE ROW LEVEL SECURITY;

-- RLS Policies for daily_profit_state
CREATE POLICY "Users can view daily profit in their restaurant"
ON public.daily_profit_state
FOR SELECT
USING (user_belongs_to_restaurant(auth.uid(), restaurant_id));

CREATE POLICY "Users can insert daily profit in their restaurant"
ON public.daily_profit_state
FOR INSERT
WITH CHECK (user_belongs_to_restaurant(auth.uid(), restaurant_id));

CREATE POLICY "Users can update daily profit in their restaurant"
ON public.daily_profit_state
FOR UPDATE
USING (user_belongs_to_restaurant(auth.uid(), restaurant_id));

-- RLS Policies for shift_contribution
CREATE POLICY "Users can view shift contributions in their restaurant"
ON public.shift_contribution
FOR SELECT
USING (user_belongs_to_restaurant(auth.uid(), restaurant_id));

CREATE POLICY "Users can insert shift contributions in their restaurant"
ON public.shift_contribution
FOR INSERT
WITH CHECK (user_belongs_to_restaurant(auth.uid(), restaurant_id));

CREATE POLICY "Users can update shift contributions in their restaurant"
ON public.shift_contribution
FOR UPDATE
USING (user_belongs_to_restaurant(auth.uid(), restaurant_id));

-- RLS Policies for profit_milestones
CREATE POLICY "Users can view profit milestones in their restaurant"
ON public.profit_milestones
FOR SELECT
USING (user_belongs_to_restaurant(auth.uid(), restaurant_id));

CREATE POLICY "Users can insert profit milestones in their restaurant"
ON public.profit_milestones
FOR INSERT
WITH CHECK (user_belongs_to_restaurant(auth.uid(), restaurant_id));

-- RLS Policies for overhead_allocation
CREATE POLICY "Users can view overhead in their restaurant"
ON public.overhead_allocation
FOR SELECT
USING (user_belongs_to_restaurant(auth.uid(), restaurant_id));

CREATE POLICY "Managers+ can manage overhead"
ON public.overhead_allocation
FOR ALL
USING (has_role(auth.uid(), restaurant_id, 'owner') OR has_role(auth.uid(), restaurant_id, 'manager'));

-- Triggers for updated_at
CREATE TRIGGER update_daily_profit_state_updated_at
BEFORE UPDATE ON public.daily_profit_state
FOR EACH ROW
EXECUTE FUNCTION public.update_updated_at_column();

CREATE TRIGGER update_shift_contribution_updated_at
BEFORE UPDATE ON public.shift_contribution
FOR EACH ROW
EXECUTE FUNCTION public.update_updated_at_column();

CREATE TRIGGER update_overhead_allocation_updated_at
BEFORE UPDATE ON public.overhead_allocation
FOR EACH ROW
EXECUTE FUNCTION public.update_updated_at_column();