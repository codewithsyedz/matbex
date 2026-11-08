-- Create enums for shift and cash event status
CREATE TYPE public.shift_status AS ENUM ('open', 'closing', 'closed');
CREATE TYPE public.cash_event_type AS ENUM ('sale', 'refund', 'drop', 'count', 'deposit', 'adjustment');
CREATE TYPE public.payment_method AS ENUM ('cash', 'card', 'other');
CREATE TYPE public.app_role AS ENUM ('owner', 'manager', 'cashier');

-- Create restaurants table
CREATE TABLE public.restaurants (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  name TEXT NOT NULL,
  currency TEXT NOT NULL DEFAULT 'SAR',
  timezone TEXT NOT NULL DEFAULT 'Asia/Riyadh',
  created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
  updated_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now()
);

-- Create profiles table (linked to auth.users)
CREATE TABLE public.profiles (
  id UUID NOT NULL PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  restaurant_id UUID REFERENCES public.restaurants(id) ON DELETE SET NULL,
  full_name TEXT,
  avatar_url TEXT,
  created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
  updated_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now()
);

-- Create user_roles table for RBAC
CREATE TABLE public.user_roles (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  restaurant_id UUID NOT NULL REFERENCES public.restaurants(id) ON DELETE CASCADE,
  role app_role NOT NULL,
  created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
  UNIQUE(user_id, restaurant_id, role)
);

-- Create drawers table (cash registers/terminals)
CREATE TABLE public.drawers (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  restaurant_id UUID NOT NULL REFERENCES public.restaurants(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  is_active BOOLEAN NOT NULL DEFAULT true,
  created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
  updated_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now()
);

-- Create shift_templates table
CREATE TABLE public.shift_templates (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  restaurant_id UUID NOT NULL REFERENCES public.restaurants(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  start_time TIME NOT NULL,
  end_time TIME NOT NULL,
  default_float DECIMAL(12,2) NOT NULL DEFAULT 500.00,
  created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
  updated_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now()
);

-- Create shifts table
CREATE TABLE public.shifts (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  restaurant_id UUID NOT NULL REFERENCES public.restaurants(id) ON DELETE CASCADE,
  drawer_id UUID NOT NULL REFERENCES public.drawers(id) ON DELETE RESTRICT,
  template_id UUID REFERENCES public.shift_templates(id) ON DELETE SET NULL,
  cashier_user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE RESTRICT,
  status shift_status NOT NULL DEFAULT 'open',
  opening_float DECIMAL(12,2) NOT NULL,
  counted_cash DECIMAL(12,2),
  expected_cash DECIMAL(12,2),
  variance DECIMAL(12,2),
  deposit_amount DECIMAL(12,2),
  opened_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
  closed_at TIMESTAMP WITH TIME ZONE,
  notes TEXT,
  created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
  updated_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now()
);

-- Create cash_events table
CREATE TABLE public.cash_events (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  shift_id UUID NOT NULL REFERENCES public.shifts(id) ON DELETE CASCADE,
  restaurant_id UUID NOT NULL REFERENCES public.restaurants(id) ON DELETE CASCADE,
  event_type cash_event_type NOT NULL,
  amount DECIMAL(12,2) NOT NULL,
  payment_method payment_method,
  description TEXT,
  created_by UUID NOT NULL REFERENCES auth.users(id) ON DELETE RESTRICT,
  created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now()
);

-- Create sales_transactions table
CREATE TABLE public.sales_transactions (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  restaurant_id UUID NOT NULL REFERENCES public.restaurants(id) ON DELETE CASCADE,
  shift_id UUID REFERENCES public.shifts(id) ON DELETE SET NULL,
  payment_method payment_method NOT NULL,
  subtotal DECIMAL(12,2) NOT NULL,
  tax DECIMAL(12,2) NOT NULL DEFAULT 0,
  total DECIMAL(12,2) NOT NULL,
  receipt_number TEXT,
  created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now()
);

-- Create expense_categories table
CREATE TABLE public.expense_categories (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  restaurant_id UUID NOT NULL REFERENCES public.restaurants(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  color TEXT,
  created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now()
);

-- Create expenses table
CREATE TABLE public.expenses (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  restaurant_id UUID NOT NULL REFERENCES public.restaurants(id) ON DELETE CASCADE,
  category_id UUID REFERENCES public.expense_categories(id) ON DELETE SET NULL,
  amount DECIMAL(12,2) NOT NULL,
  description TEXT,
  expense_date DATE NOT NULL DEFAULT CURRENT_DATE,
  created_by UUID NOT NULL REFERENCES auth.users(id) ON DELETE RESTRICT,
  created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
  updated_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now()
);

-- Create inventory_items table
CREATE TABLE public.inventory_items (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  restaurant_id UUID NOT NULL REFERENCES public.restaurants(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  unit TEXT NOT NULL DEFAULT 'unit',
  unit_cost DECIMAL(12,4) NOT NULL DEFAULT 0,
  current_stock DECIMAL(12,2) NOT NULL DEFAULT 0,
  reorder_level DECIMAL(12,2),
  created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
  updated_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now()
);

-- Enable RLS on all tables
ALTER TABLE public.restaurants ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.profiles ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.user_roles ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.drawers ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.shift_templates ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.shifts ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.cash_events ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.sales_transactions ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.expense_categories ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.expenses ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.inventory_items ENABLE ROW LEVEL SECURITY;

-- Create security definer function to check user role
CREATE OR REPLACE FUNCTION public.has_role(_user_id UUID, _restaurant_id UUID, _role app_role)
RETURNS BOOLEAN
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1
    FROM public.user_roles
    WHERE user_id = _user_id
      AND restaurant_id = _restaurant_id
      AND role = _role
  )
$$;

-- Create function to get user's restaurant_id
CREATE OR REPLACE FUNCTION public.get_user_restaurant_id(_user_id UUID)
RETURNS UUID
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT restaurant_id FROM public.profiles WHERE id = _user_id LIMIT 1
$$;

-- Create function to check if user belongs to restaurant
CREATE OR REPLACE FUNCTION public.user_belongs_to_restaurant(_user_id UUID, _restaurant_id UUID)
RETURNS BOOLEAN
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1
    FROM public.user_roles
    WHERE user_id = _user_id
      AND restaurant_id = _restaurant_id
  )
$$;

-- RLS Policies for profiles
CREATE POLICY "Users can view their own profile"
ON public.profiles FOR SELECT
USING (auth.uid() = id);

CREATE POLICY "Users can update their own profile"
ON public.profiles FOR UPDATE
USING (auth.uid() = id);

CREATE POLICY "Users can insert their own profile"
ON public.profiles FOR INSERT
WITH CHECK (auth.uid() = id);

-- RLS Policies for restaurants (users can see restaurants they belong to)
CREATE POLICY "Users can view their restaurants"
ON public.restaurants FOR SELECT
USING (public.user_belongs_to_restaurant(auth.uid(), id));

CREATE POLICY "Owners can update their restaurants"
ON public.restaurants FOR UPDATE
USING (public.has_role(auth.uid(), id, 'owner'));

-- RLS Policies for user_roles
CREATE POLICY "Users can view roles in their restaurant"
ON public.user_roles FOR SELECT
USING (public.user_belongs_to_restaurant(auth.uid(), restaurant_id));

CREATE POLICY "Owners can manage roles"
ON public.user_roles FOR ALL
USING (public.has_role(auth.uid(), restaurant_id, 'owner'));

-- RLS Policies for drawers
CREATE POLICY "Users can view drawers in their restaurant"
ON public.drawers FOR SELECT
USING (public.user_belongs_to_restaurant(auth.uid(), restaurant_id));

CREATE POLICY "Managers+ can manage drawers"
ON public.drawers FOR ALL
USING (
  public.has_role(auth.uid(), restaurant_id, 'owner') OR
  public.has_role(auth.uid(), restaurant_id, 'manager')
);

-- RLS Policies for shift_templates
CREATE POLICY "Users can view shift templates in their restaurant"
ON public.shift_templates FOR SELECT
USING (public.user_belongs_to_restaurant(auth.uid(), restaurant_id));

CREATE POLICY "Managers+ can manage shift templates"
ON public.shift_templates FOR ALL
USING (
  public.has_role(auth.uid(), restaurant_id, 'owner') OR
  public.has_role(auth.uid(), restaurant_id, 'manager')
);

-- RLS Policies for shifts
CREATE POLICY "Users can view shifts in their restaurant"
ON public.shifts FOR SELECT
USING (public.user_belongs_to_restaurant(auth.uid(), restaurant_id));

CREATE POLICY "Users can create shifts"
ON public.shifts FOR INSERT
WITH CHECK (public.user_belongs_to_restaurant(auth.uid(), restaurant_id));

CREATE POLICY "Users can update their own shifts or managers+"
ON public.shifts FOR UPDATE
USING (
  cashier_user_id = auth.uid() OR
  public.has_role(auth.uid(), restaurant_id, 'owner') OR
  public.has_role(auth.uid(), restaurant_id, 'manager')
);

-- RLS Policies for cash_events
CREATE POLICY "Users can view cash events in their restaurant"
ON public.cash_events FOR SELECT
USING (public.user_belongs_to_restaurant(auth.uid(), restaurant_id));

CREATE POLICY "Users can create cash events in their restaurant"
ON public.cash_events FOR INSERT
WITH CHECK (public.user_belongs_to_restaurant(auth.uid(), restaurant_id) AND created_by = auth.uid());

-- RLS Policies for sales_transactions
CREATE POLICY "Users can view sales in their restaurant"
ON public.sales_transactions FOR SELECT
USING (public.user_belongs_to_restaurant(auth.uid(), restaurant_id));

CREATE POLICY "Users can create sales in their restaurant"
ON public.sales_transactions FOR INSERT
WITH CHECK (public.user_belongs_to_restaurant(auth.uid(), restaurant_id));

-- RLS Policies for expense_categories
CREATE POLICY "Users can view expense categories in their restaurant"
ON public.expense_categories FOR SELECT
USING (public.user_belongs_to_restaurant(auth.uid(), restaurant_id));

CREATE POLICY "Managers+ can manage expense categories"
ON public.expense_categories FOR ALL
USING (
  public.has_role(auth.uid(), restaurant_id, 'owner') OR
  public.has_role(auth.uid(), restaurant_id, 'manager')
);

-- RLS Policies for expenses
CREATE POLICY "Users can view expenses in their restaurant"
ON public.expenses FOR SELECT
USING (public.user_belongs_to_restaurant(auth.uid(), restaurant_id));

CREATE POLICY "Users can create expenses in their restaurant"
ON public.expenses FOR INSERT
WITH CHECK (public.user_belongs_to_restaurant(auth.uid(), restaurant_id) AND created_by = auth.uid());

CREATE POLICY "Users can update their own expenses or managers+"
ON public.expenses FOR UPDATE
USING (
  created_by = auth.uid() OR
  public.has_role(auth.uid(), restaurant_id, 'owner') OR
  public.has_role(auth.uid(), restaurant_id, 'manager')
);

-- RLS Policies for inventory_items
CREATE POLICY "Users can view inventory in their restaurant"
ON public.inventory_items FOR SELECT
USING (public.user_belongs_to_restaurant(auth.uid(), restaurant_id));

CREATE POLICY "Managers+ can manage inventory"
ON public.inventory_items FOR ALL
USING (
  public.has_role(auth.uid(), restaurant_id, 'owner') OR
  public.has_role(auth.uid(), restaurant_id, 'manager')
);

-- Create function to handle new user signup
CREATE OR REPLACE FUNCTION public.handle_new_user()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  INSERT INTO public.profiles (id, full_name)
  VALUES (NEW.id, NEW.raw_user_meta_data ->> 'full_name');
  RETURN NEW;
END;
$$;

-- Create trigger for new user signup
CREATE TRIGGER on_auth_user_created
  AFTER INSERT ON auth.users
  FOR EACH ROW EXECUTE FUNCTION public.handle_new_user();

-- Create function to update updated_at timestamps
CREATE OR REPLACE FUNCTION public.update_updated_at_column()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql SET search_path = public;

-- Create triggers for updated_at
CREATE TRIGGER update_restaurants_updated_at
  BEFORE UPDATE ON public.restaurants
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

CREATE TRIGGER update_profiles_updated_at
  BEFORE UPDATE ON public.profiles
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

CREATE TRIGGER update_drawers_updated_at
  BEFORE UPDATE ON public.drawers
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

CREATE TRIGGER update_shift_templates_updated_at
  BEFORE UPDATE ON public.shift_templates
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

CREATE TRIGGER update_shifts_updated_at
  BEFORE UPDATE ON public.shifts
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

CREATE TRIGGER update_expenses_updated_at
  BEFORE UPDATE ON public.expenses
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

CREATE TRIGGER update_inventory_items_updated_at
  BEFORE UPDATE ON public.inventory_items
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

-- Enable realtime for shifts and cash_events
ALTER PUBLICATION supabase_realtime ADD TABLE public.shifts;
ALTER PUBLICATION supabase_realtime ADD TABLE public.cash_events;