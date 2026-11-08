
-- ===== enums =====
create type public.compliance_source as enum ('balady_inspection','internal_inspection','shift_supervisor','customer_complaint','food_safety_inspection','management_audit','other');
create type public.compliance_status as enum ('identified','assigned','action_required','completed','verified','closed','cancelled');
create type public.municipality_fine_status as enum ('received','under_review','appeal_submitted','confirmed','paid','closed');
create type public.compliance_checklist_kind as enum ('opening','during_shift','closing');

-- ===== settings =====
create table public.compliance_settings (
  id uuid primary key default gen_random_uuid(),
  restaurant_id uuid not null,
  repeat_lookback_days integer not null default 90,
  default_correction_days integer not null default 3,
  weight_cleanliness numeric not null default 25,
  weight_food_safety numeric not null default 25,
  weight_employee_sop numeric not null default 25,
  weight_checklists numeric not null default 25,
  notify_roles text[] not null default array['owner','manager'],
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (restaurant_id)
);
grant select, insert, update, delete on public.compliance_settings to authenticated;
grant all on public.compliance_settings to service_role;
alter table public.compliance_settings enable row level security;
create policy "compliance_settings_access" on public.compliance_settings for all to authenticated
using (public.can_access_restaurant(restaurant_id)) with check (public.can_access_restaurant(restaurant_id));

-- ===== categories =====
create table public.compliance_violation_categories (
  id uuid primary key default gen_random_uuid(),
  restaurant_id uuid not null,
  branch_id uuid references public.branches(id) on delete cascade,
  code text not null,
  name_en text not null,
  name_ar text,
  description text,
  sort_order integer not null default 0,
  is_active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  deleted_at timestamptz
);
grant select, insert, update, delete on public.compliance_violation_categories to authenticated;
grant all on public.compliance_violation_categories to service_role;
alter table public.compliance_violation_categories enable row level security;
create policy "cvc_access" on public.compliance_violation_categories for all to authenticated
using (public.can_access_restaurant(restaurant_id)) with check (public.can_access_restaurant(restaurant_id));
create index idx_cvc_restaurant on public.compliance_violation_categories(restaurant_id, branch_id);

-- ===== types =====
create table public.compliance_violation_types (
  id uuid primary key default gen_random_uuid(),
  restaurant_id uuid not null,
  category_id uuid not null references public.compliance_violation_categories(id) on delete cascade,
  branch_id uuid references public.branches(id) on delete cascade,
  name_en text not null,
  name_ar text,
  severity text not null default 'medium',
  default_correction_days integer not null default 3,
  requires_evidence boolean not null default false,
  default_fine_amount numeric not null default 0,
  is_active boolean not null default true,
  sort_order integer not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  deleted_at timestamptz
);
grant select, insert, update, delete on public.compliance_violation_types to authenticated;
grant all on public.compliance_violation_types to service_role;
alter table public.compliance_violation_types enable row level security;
create policy "cvt_access" on public.compliance_violation_types for all to authenticated
using (public.can_access_restaurant(restaurant_id)) with check (public.can_access_restaurant(restaurant_id));
create index idx_cvt_category on public.compliance_violation_types(category_id);

-- ===== escalation rules =====
create table public.compliance_escalation_rules (
  id uuid primary key default gen_random_uuid(),
  restaurant_id uuid not null,
  branch_id uuid references public.branches(id) on delete cascade,
  occurrence_count integer not null,
  action_label text not null,
  notes text,
  is_active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
grant select, insert, update, delete on public.compliance_escalation_rules to authenticated;
grant all on public.compliance_escalation_rules to service_role;
alter table public.compliance_escalation_rules enable row level security;
create policy "cer_access" on public.compliance_escalation_rules for all to authenticated
using (public.can_access_restaurant(restaurant_id)) with check (public.can_access_restaurant(restaurant_id));

-- ===== violations =====
create table public.compliance_violations (
  id uuid primary key default gen_random_uuid(),
  restaurant_id uuid not null,
  branch_id uuid not null references public.branches(id) on delete cascade,
  violation_number text,
  category_id uuid references public.compliance_violation_categories(id) on delete set null,
  violation_type_id uuid references public.compliance_violation_types(id) on delete set null,
  source public.compliance_source not null default 'internal_inspection',
  is_municipality_fine boolean not null default false,
  violation_date date not null default current_date,
  violation_time time,
  shift_id uuid references public.shifts(id) on delete set null,
  description text,
  responsible_staff_id uuid references public.staff(id) on delete set null,
  supervisor_staff_id uuid references public.staff(id) on delete set null,
  fine_amount numeric not null default 0,
  municipality_reference text,
  inspector_name text,
  inspection_date date,
  corrective_action_required text,
  corrective_action_due_date date,
  corrective_action_completed_at timestamptz,
  corrective_action_completed_by uuid,
  verified_at timestamptz,
  verified_by uuid,
  status public.compliance_status not null default 'identified',
  is_overdue boolean not null default false,
  escalation_label text,
  payroll_fine_id uuid references public.employee_fines(id) on delete set null,
  notes text,
  created_by uuid not null default auth.uid(),
  approved_by uuid,
  approved_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  deleted_at timestamptz
);
grant select, insert, update, delete on public.compliance_violations to authenticated;
grant all on public.compliance_violations to service_role;
alter table public.compliance_violations enable row level security;
create policy "cv_access" on public.compliance_violations for all to authenticated
using (public.can_access_restaurant(restaurant_id) and public.can_access_branch(branch_id))
with check (public.can_access_restaurant(restaurant_id) and public.can_access_branch(branch_id));
create index idx_cv_branch_date on public.compliance_violations(restaurant_id, branch_id, violation_date desc);
create index idx_cv_type on public.compliance_violations(violation_type_id, branch_id);
create index idx_cv_staff on public.compliance_violations(responsible_staff_id);

-- ===== evidence =====
create table public.compliance_violation_evidence (
  id uuid primary key default gen_random_uuid(),
  restaurant_id uuid not null,
  violation_id uuid not null references public.compliance_violations(id) on delete cascade,
  phase text not null default 'before',
  storage_path text not null,
  caption text,
  uploaded_by uuid not null default auth.uid(),
  uploaded_at timestamptz not null default now()
);
grant select, insert, update, delete on public.compliance_violation_evidence to authenticated;
grant all on public.compliance_violation_evidence to service_role;
alter table public.compliance_violation_evidence enable row level security;
create policy "cve_access" on public.compliance_violation_evidence for all to authenticated
using (public.can_access_restaurant(restaurant_id)) with check (public.can_access_restaurant(restaurant_id));
create index idx_cve_violation on public.compliance_violation_evidence(violation_id);

-- ===== corrective action events =====
create table public.compliance_action_events (
  id uuid primary key default gen_random_uuid(),
  restaurant_id uuid not null,
  violation_id uuid not null references public.compliance_violations(id) on delete cascade,
  from_status public.compliance_status,
  to_status public.compliance_status not null,
  comment text,
  actor_id uuid default auth.uid(),
  created_at timestamptz not null default now()
);
grant select, insert on public.compliance_action_events to authenticated;
grant all on public.compliance_action_events to service_role;
alter table public.compliance_action_events enable row level security;
create policy "cae_read" on public.compliance_action_events for select to authenticated
using (public.can_access_restaurant(restaurant_id));
create policy "cae_insert" on public.compliance_action_events for insert to authenticated
with check (public.can_access_restaurant(restaurant_id));
create index idx_cae_violation on public.compliance_action_events(violation_id, created_at desc);

-- ===== municipality fines =====
create table public.municipality_fines (
  id uuid primary key default gen_random_uuid(),
  restaurant_id uuid not null,
  branch_id uuid not null references public.branches(id) on delete cascade,
  violation_id uuid references public.compliance_violations(id) on delete set null,
  fine_reference text not null,
  inspection_date date,
  received_date date not null default current_date,
  violation_summary text,
  amount numeric not null default 0,
  status public.municipality_fine_status not null default 'received',
  due_date date,
  payment_date date,
  payment_reference text,
  document_path text,
  appeal_status text,
  appeal_reference text,
  notes text,
  expense_id uuid references public.expenses(id) on delete set null,
  posted_at timestamptz,
  created_by uuid not null default auth.uid(),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  deleted_at timestamptz
);
grant select, insert, update, delete on public.municipality_fines to authenticated;
grant all on public.municipality_fines to service_role;
alter table public.municipality_fines enable row level security;
create policy "mf_access" on public.municipality_fines for all to authenticated
using (public.can_access_restaurant(restaurant_id) and public.can_access_branch(branch_id))
with check (public.can_access_restaurant(restaurant_id) and public.can_access_branch(branch_id));
create index idx_mf_branch on public.municipality_fines(restaurant_id, branch_id, received_date desc);

-- ===== checklists =====
create table public.compliance_checklist_templates (
  id uuid primary key default gen_random_uuid(),
  restaurant_id uuid not null,
  branch_id uuid references public.branches(id) on delete cascade,
  kind public.compliance_checklist_kind not null,
  name text not null,
  is_active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  deleted_at timestamptz
);
grant select, insert, update, delete on public.compliance_checklist_templates to authenticated;
grant all on public.compliance_checklist_templates to service_role;
alter table public.compliance_checklist_templates enable row level security;
create policy "cct_access" on public.compliance_checklist_templates for all to authenticated
using (public.can_access_restaurant(restaurant_id)) with check (public.can_access_restaurant(restaurant_id));

create table public.compliance_checklist_items (
  id uuid primary key default gen_random_uuid(),
  restaurant_id uuid not null,
  template_id uuid not null references public.compliance_checklist_templates(id) on delete cascade,
  label_en text not null,
  label_ar text,
  requires_photo boolean not null default false,
  sort_order integer not null default 0,
  is_active boolean not null default true,
  created_at timestamptz not null default now()
);
grant select, insert, update, delete on public.compliance_checklist_items to authenticated;
grant all on public.compliance_checklist_items to service_role;
alter table public.compliance_checklist_items enable row level security;
create policy "cci_access" on public.compliance_checklist_items for all to authenticated
using (public.can_access_restaurant(restaurant_id)) with check (public.can_access_restaurant(restaurant_id));
create index idx_cci_template on public.compliance_checklist_items(template_id, sort_order);

create table public.compliance_checklist_runs (
  id uuid primary key default gen_random_uuid(),
  restaurant_id uuid not null,
  branch_id uuid not null references public.branches(id) on delete cascade,
  template_id uuid not null references public.compliance_checklist_templates(id) on delete cascade,
  run_date date not null default current_date,
  shift_id uuid references public.shifts(id) on delete set null,
  completed_by uuid,
  completed_by_staff_id uuid references public.staff(id) on delete set null,
  completed_at timestamptz,
  reviewed_by uuid,
  reviewed_at timestamptz,
  review_comments text,
  approved_by uuid,
  approved_at timestamptz,
  approval_signature text,
  approval_comments text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (template_id, run_date, shift_id)
);
grant select, insert, update, delete on public.compliance_checklist_runs to authenticated;
grant all on public.compliance_checklist_runs to service_role;
alter table public.compliance_checklist_runs enable row level security;
create policy "ccr_access" on public.compliance_checklist_runs for all to authenticated
using (public.can_access_restaurant(restaurant_id) and public.can_access_branch(branch_id))
with check (public.can_access_restaurant(restaurant_id) and public.can_access_branch(branch_id));
create index idx_ccr_branch_date on public.compliance_checklist_runs(restaurant_id, branch_id, run_date desc);

create table public.compliance_checklist_run_items (
  id uuid primary key default gen_random_uuid(),
  restaurant_id uuid not null,
  run_id uuid not null references public.compliance_checklist_runs(id) on delete cascade,
  item_id uuid not null references public.compliance_checklist_items(id) on delete cascade,
  is_checked boolean not null default false,
  note text,
  photo_path text,
  checked_by uuid,
  checked_at timestamptz,
  unique (run_id, item_id)
);
grant select, insert, update, delete on public.compliance_checklist_run_items to authenticated;
grant all on public.compliance_checklist_run_items to service_role;
alter table public.compliance_checklist_run_items enable row level security;
create policy "ccri_access" on public.compliance_checklist_run_items for all to authenticated
using (public.can_access_restaurant(restaurant_id)) with check (public.can_access_restaurant(restaurant_id));
create index idx_ccri_run on public.compliance_checklist_run_items(run_id);

-- ===== updated_at triggers =====
create trigger trg_cs_updated before update on public.compliance_settings for each row execute function public.update_updated_at_column();
create trigger trg_cvc_updated before update on public.compliance_violation_categories for each row execute function public.update_updated_at_column();
create trigger trg_cvt_updated before update on public.compliance_violation_types for each row execute function public.update_updated_at_column();
create trigger trg_cer_updated before update on public.compliance_escalation_rules for each row execute function public.update_updated_at_column();
create trigger trg_cv_updated before update on public.compliance_violations for each row execute function public.update_updated_at_column();
create trigger trg_mf_updated before update on public.municipality_fines for each row execute function public.update_updated_at_column();
create trigger trg_cct_updated before update on public.compliance_checklist_templates for each row execute function public.update_updated_at_column();
create trigger trg_ccr_updated before update on public.compliance_checklist_runs for each row execute function public.update_updated_at_column();

-- ===== status change audit trigger =====
create or replace function public.log_compliance_status_change()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if tg_op = 'INSERT' then
    insert into public.compliance_action_events(restaurant_id, violation_id, from_status, to_status, comment)
    values (new.restaurant_id, new.id, null, new.status, 'Violation recorded');
  elsif new.status is distinct from old.status then
    insert into public.compliance_action_events(restaurant_id, violation_id, from_status, to_status, comment)
    values (new.restaurant_id, new.id, old.status, new.status, null);
  end if;
  return new;
end $$;
create trigger trg_cv_status_log after insert or update on public.compliance_violations
for each row execute function public.log_compliance_status_change();

-- ===== lock posted fines =====
create or replace function public.protect_posted_municipality_fine()
returns trigger language plpgsql set search_path = public as $$
begin
  if old.expense_id is not null and old.posted_at is not null then
    if new.amount is distinct from old.amount or new.branch_id is distinct from old.branch_id
       or new.fine_reference is distinct from old.fine_reference then
      raise exception 'Fine % is already posted to expenses; amount, branch and reference are locked', old.fine_reference;
    end if;
  end if;
  return new;
end $$;
create trigger trg_mf_protect before update on public.municipality_fines
for each row execute function public.protect_posted_municipality_fine();

-- ===== lock approved checklist runs =====
create or replace function public.protect_approved_checklist_items()
returns trigger language plpgsql set search_path = public as $$
declare v_approved timestamptz;
begin
  select approved_at into v_approved from public.compliance_checklist_runs
  where id = coalesce(new.run_id, old.run_id);
  if v_approved is not null then
    raise exception 'This checklist has been approved and can no longer be modified';
  end if;
  return coalesce(new, old);
end $$;
create trigger trg_ccri_protect before update or delete on public.compliance_checklist_run_items
for each row execute function public.protect_approved_checklist_items();

-- ===== repeat detection =====
create or replace function public.compliance_repeat_info(_violation_id uuid)
returns table (occurrences integer, last_occurrence date, recommended_action text)
language plpgsql stable security definer set search_path = public as $$
declare v record; v_days integer; v_count integer; v_last date; v_action text;
begin
  select * into v from public.compliance_violations where id = _violation_id;
  if not found then return; end if;
  select coalesce(repeat_lookback_days, 90) into v_days from public.compliance_settings where restaurant_id = v.restaurant_id;
  v_days := coalesce(v_days, 90);

  select count(*)::int, max(violation_date) into v_count, v_last
  from public.compliance_violations
  where restaurant_id = v.restaurant_id
    and branch_id = v.branch_id
    and violation_type_id is not distinct from v.violation_type_id
    and id <> v.id
    and deleted_at is null
    and violation_date >= v.violation_date - v_days;

  select action_label into v_action from public.compliance_escalation_rules
  where restaurant_id = v.restaurant_id
    and (branch_id is null or branch_id = v.branch_id)
    and is_active
    and occurrence_count <= v_count + 1
  order by occurrence_count desc limit 1;

  return query select v_count, v_last, v_action;
end $$;
grant execute on function public.compliance_repeat_info(uuid) to authenticated;

-- ===== branch compliance score =====
create or replace function public.compliance_branch_score(_restaurant_id uuid, _branch_id uuid, _from date, _to date)
returns table (
  branch_id uuid,
  branch_name text,
  score numeric,
  cleanliness numeric,
  food_safety numeric,
  employee_sop numeric,
  checklists numeric,
  open_violations integer,
  overdue_violations integer,
  municipality_fines_total numeric,
  internal_violations integer,
  repeat_violations integer
)
language plpgsql stable security definer set search_path = public as $$
declare w record;
begin
  select coalesce(s.weight_cleanliness,25) wc, coalesce(s.weight_food_safety,25) wf,
         coalesce(s.weight_employee_sop,25) we, coalesce(s.weight_checklists,25) wk
  into w from public.compliance_settings s where s.restaurant_id = _restaurant_id;
  if w is null then w := row(25,25,25,25); end if;

  return query
  with b as (
    select br.id, br.name from public.branches br
    where br.restaurant_id = _restaurant_id and br.deleted_at is null
      and (_branch_id is null or br.id = _branch_id)
  ),
  v as (
    select cv.*, cat.code as cat_code
    from public.compliance_violations cv
    left join public.compliance_violation_categories cat on cat.id = cv.category_id
    where cv.restaurant_id = _restaurant_id and cv.deleted_at is null
      and cv.violation_date between _from and _to
  ),
  agg as (
    select b.id, b.name,
      count(*) filter (where v.cat_code = 'cleanliness') as c_cnt,
      count(*) filter (where v.cat_code = 'food_safety') as f_cnt,
      count(*) filter (where v.cat_code in ('employee_compliance','sop')) as e_cnt,
      count(*) filter (where v.status not in ('closed','cancelled'))::int as open_cnt,
      count(*) filter (where v.is_overdue and v.status not in ('closed','cancelled'))::int as overdue_cnt,
      count(*) filter (where not v.is_municipality_fine)::int as internal_cnt
    from b left join v on v.branch_id = b.id
    group by b.id, b.name
  ),
  chk as (
    select b.id, 
      coalesce(avg(case when r.approved_at is not null then 100 when r.completed_at is not null then 70 else 0 end), 100) as pct
    from b left join public.compliance_checklist_runs r
      on r.branch_id = b.id and r.run_date between _from and _to
    group by b.id
  ),
  fines as (
    select b.id, coalesce(sum(mf.amount),0) as total
    from b left join public.municipality_fines mf
      on mf.branch_id = b.id and mf.deleted_at is null and mf.received_date between _from and _to
    group by b.id
  ),
  reps as (
    select b.id, coalesce(count(*),0)::int as cnt from b
    left join (
      select cv.branch_id, cv.violation_type_id
      from public.compliance_violations cv
      where cv.restaurant_id = _restaurant_id and cv.deleted_at is null
        and cv.violation_date between _from and _to
      group by cv.branch_id, cv.violation_type_id having count(*) > 1
    ) r on r.branch_id = b.id
    group by b.id
  )
  select a.id, a.name,
    round((greatest(0, 100 - a.c_cnt * 5) * w.wc + greatest(0, 100 - a.f_cnt * 5) * w.wf
      + greatest(0, 100 - a.e_cnt * 5) * w.we + chk.pct * w.wk)
      / nullif(w.wc + w.wf + w.we + w.wk, 0), 1),
    round(greatest(0, 100 - a.c_cnt * 5), 1),
    round(greatest(0, 100 - a.f_cnt * 5), 1),
    round(greatest(0, 100 - a.e_cnt * 5), 1),
    round(chk.pct, 1),
    a.open_cnt, a.overdue_cnt, fines.total, a.internal_cnt, reps.cnt
  from agg a
  join chk on chk.id = a.id
  join fines on fines.id = a.id
  join reps on reps.id = a.id
  order by a.name;
end $$;
grant execute on function public.compliance_branch_score(uuid, uuid, date, date) to authenticated;

-- ===== overdue marker =====
create or replace function public.mark_overdue_corrective_actions()
returns integer language plpgsql security definer set search_path = public as $$
declare v_count integer := 0; r record;
begin
  for r in
    update public.compliance_violations
    set is_overdue = true
    where deleted_at is null
      and is_overdue = false
      and status in ('identified','assigned','action_required')
      and corrective_action_due_date is not null
      and corrective_action_due_date < current_date
    returning id, restaurant_id, branch_id, violation_number
  loop
    v_count := v_count + 1;
    insert into public.compliance_action_events(restaurant_id, violation_id, from_status, to_status, comment)
    values (r.restaurant_id, r.id, null, 'action_required', 'Corrective action passed its due date');
  end loop;
  return v_count;
end $$;

-- ===== post municipality fine to expenses =====
create or replace function public.post_municipality_fine_to_expense(_fine_id uuid)
returns uuid language plpgsql security definer set search_path = public as $$
declare f record; v_cat uuid; v_expense uuid;
begin
  select * into f from public.municipality_fines where id = _fine_id for update;
  if not found then raise exception 'Fine not found'; end if;
  if f.expense_id is not null then return f.expense_id; end if;
  if not public.can_access_restaurant(f.restaurant_id) then raise exception 'Not authorized'; end if;
  if coalesce(f.amount, 0) <= 0 then raise exception 'Fine amount must be greater than zero before posting'; end if;

  select id into v_cat from public.expense_categories
  where restaurant_id = f.restaurant_id and lower(name) = 'government & regulatory fines'
    and (branch_id is null or branch_id = f.branch_id)
  order by branch_id nulls last limit 1;

  if v_cat is null then
    insert into public.expense_categories(restaurant_id, name, color)
    values (f.restaurant_id, 'Government & Regulatory Fines', '#dc2626')
    returning id into v_cat;
  end if;

  insert into public.expenses(restaurant_id, branch_id, category_id, amount, description, expense_date, status, approval_status, created_by)
  values (f.restaurant_id, f.branch_id, v_cat, f.amount,
          concat('Municipality fine ', f.fine_reference, coalesce(' - ' || f.violation_summary, '')),
          coalesce(f.received_date, current_date), 'unpaid', 'pending', coalesce(auth.uid(), f.created_by))
  returning id into v_expense;

  update public.municipality_fines set expense_id = v_expense, posted_at = now() where id = _fine_id;
  return v_expense;
end $$;
grant execute on function public.post_municipality_fine_to_expense(uuid) to authenticated;

-- ===== seeding =====
create or replace function public.seed_compliance_defaults(_restaurant_id uuid)
returns void language plpgsql security definer set search_path = public as $$
declare c_clean uuid; c_food uuid; c_emp uuid; c_sop uuid; t_open uuid; t_shift uuid; t_close uuid; i integer;
  arr text[];
begin
  if not public.can_access_restaurant(_restaurant_id) then raise exception 'Not authorized'; end if;

  insert into public.compliance_settings(restaurant_id) values (_restaurant_id) on conflict (restaurant_id) do nothing;

  if exists (select 1 from public.compliance_violation_categories where restaurant_id = _restaurant_id and deleted_at is null) then
    return;
  end if;

  insert into public.compliance_violation_categories(restaurant_id, code, name_en, name_ar, sort_order)
  values (_restaurant_id, 'cleanliness', 'Cleanliness & Hygiene', 'النظافة والصحة', 1) returning id into c_clean;
  insert into public.compliance_violation_categories(restaurant_id, code, name_en, name_ar, sort_order)
  values (_restaurant_id, 'food_safety', 'Food Safety', 'سلامة الغذاء', 2) returning id into c_food;
  insert into public.compliance_violation_categories(restaurant_id, code, name_en, name_ar, sort_order)
  values (_restaurant_id, 'employee_compliance', 'Employee Compliance', 'التزام الموظفين', 3) returning id into c_emp;
  insert into public.compliance_violation_categories(restaurant_id, code, name_en, name_ar, sort_order)
  values (_restaurant_id, 'sop', 'Restaurant SOP Violations', 'مخالفات إجراءات التشغيل', 4) returning id into c_sop;

  arr := array['Kitchen not properly cleaned','Food preparation area not cleaned','Floors not cleaned','Walls/ceilings requiring cleaning','Dirty equipment or utensils','Dirty refrigerators/freezers','Improper waste disposal','Garbage bins not properly maintained','Pest-control related issue','Poor personal hygiene','Improper handwashing practices','Employee working without required hygiene practices'];
  for i in 1..array_length(arr,1) loop
    insert into public.compliance_violation_types(restaurant_id, category_id, name_en, sort_order) values (_restaurant_id, c_clean, arr[i], i);
  end loop;

  arr := array['Improper food storage','Food stored at incorrect temperature','Expired food','Spoiled food','Cross-contamination risk','Raw and cooked food stored incorrectly','Food uncovered','Improper labeling','Missing preparation/expiry dates','Improper thawing','Unsafe food handling'];
  for i in 1..array_length(arr,1) loop
    insert into public.compliance_violation_types(restaurant_id, category_id, name_en, severity, sort_order) values (_restaurant_id, c_food, arr[i], 'high', i);
  end loop;

  arr := array['Employee not wearing required uniform','Employee not wearing gloves where required','Employee not wearing hair/beard protection where required','Employee not following handwashing procedures','Employee not following cleaning checklist','Employee not following food handling SOP','Employee not following opening/closing procedures'];
  for i in 1..array_length(arr,1) loop
    insert into public.compliance_violation_types(restaurant_id, category_id, name_en, sort_order) values (_restaurant_id, c_emp, arr[i], i);
  end loop;

  arr := array['Opening checklist not completed','Closing checklist not completed','Cleaning schedule not completed','Temperature log not completed','Refrigerator temperature not recorded','Freezer temperature not recorded','Daily sanitation checklist not completed','Equipment cleaning schedule missed','Waste disposal procedure not followed','Storage procedure not followed'];
  for i in 1..array_length(arr,1) loop
    insert into public.compliance_violation_types(restaurant_id, category_id, name_en, sort_order) values (_restaurant_id, c_sop, arr[i], i);
  end loop;

  insert into public.compliance_escalation_rules(restaurant_id, occurrence_count, action_label) values
    (_restaurant_id, 1, 'Warning'),
    (_restaurant_id, 2, 'Supervisor Review'),
    (_restaurant_id, 3, 'Management Review'),
    (_restaurant_id, 4, 'Corrective Action Plan');

  insert into public.compliance_checklist_templates(restaurant_id, kind, name) values (_restaurant_id, 'opening', 'Opening Checklist') returning id into t_open;
  insert into public.compliance_checklist_templates(restaurant_id, kind, name) values (_restaurant_id, 'during_shift', 'During-Shift Checklist') returning id into t_shift;
  insert into public.compliance_checklist_templates(restaurant_id, kind, name) values (_restaurant_id, 'closing', 'Closing Checklist') returning id into t_close;

  arr := array['Kitchen clean','Floors clean','Food preparation areas clean','Equipment clean','Refrigerators clean','Freezers clean','Food properly covered','Food properly labeled','Expiry dates checked','Waste bins clean','Pest-control indicators checked','Employee hygiene verified','Uniform compliance verified'];
  for i in 1..array_length(arr,1) loop
    insert into public.compliance_checklist_items(restaurant_id, template_id, label_en, sort_order) values (_restaurant_id, t_open, arr[i], i);
  end loop;

  arr := array['Kitchen cleanliness maintained','Food storage maintained','Food temperatures checked','Handwashing procedures followed','Workstations clean','Waste disposed correctly','Utensils clean','Cross-contamination controls followed'];
  for i in 1..array_length(arr,1) loop
    insert into public.compliance_checklist_items(restaurant_id, template_id, label_en, sort_order) values (_restaurant_id, t_shift, arr[i], i);
  end loop;

  arr := array['Kitchen cleaned','Cooking equipment cleaned','Preparation surfaces sanitized','Floors cleaned','Waste removed','Food stored correctly','Refrigerators checked','Freezers checked','Cleaning chemicals stored safely','Final inspection completed'];
  for i in 1..array_length(arr,1) loop
    insert into public.compliance_checklist_items(restaurant_id, template_id, label_en, sort_order) values (_restaurant_id, t_close, arr[i], i);
  end loop;
end $$;
grant execute on function public.seed_compliance_defaults(uuid) to authenticated;

-- ===== violation numbering =====
create or replace function public.assign_compliance_violation_number()
returns trigger language plpgsql set search_path = public as $$
declare n integer;
begin
  if new.violation_number is null then
    select count(*) + 1 into n from public.compliance_violations
    where restaurant_id = new.restaurant_id and date_trunc('year', violation_date) = date_trunc('year', new.violation_date);
    new.violation_number := 'VIO-' || to_char(new.violation_date, 'YYYY') || '-' || lpad(n::text, 5, '0');
  end if;
  return new;
end $$;
create trigger trg_cv_number before insert on public.compliance_violations
for each row execute function public.assign_compliance_violation_number();
