-- Work Flow Automation Tables
create table if not exists public.automation_ideas (
  id serial primary key,
  employee_id text not null,
  full_name text not null,
  department text,
  process_name text not null,
  current_description text,
  current_problem text,
  frequency text,
  project_name text not null,
  improvement_description text,
  proposed_technology text,
  improvement_benefits jsonb default '[]'::jsonb,
  time_before numeric(10,2) default 0,
  time_after numeric(10,2) default 0,
  paper_before numeric(10,2) default 0,
  paper_after numeric(10,2) default 0,
  steps_before numeric(10,2) default 0,
  steps_after numeric(10,2) default 0,
  difficulty text check (difficulty in ('Easy', 'Medium', 'Hard')),
  budget text check (budget in ('Free', 'Low', 'Medium', 'High')),
  project_status text not null default 'Idea' check (project_status in ('Idea', 'Prototype', 'Testing', 'Implemented')),
  admin_note text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.automation_images (
  id serial primary key,
  idea_id integer not null references public.automation_ideas(id) on delete cascade,
  image_type text not null check (image_type in ('BEFORE', 'AFTER')),
  image_url text not null,
  image_description text,
  created_at timestamptz not null default now()
);

create table if not exists public.automation_evaluations (
  id serial primary key,
  idea_id integer not null references public.automation_ideas(id) on delete cascade,
  admin_id text not null,
  evaluation_note text,
  evaluation_status text,
  created_at timestamptz not null default now()
);

alter table public.automation_ideas add column if not exists project_code text not null default 'workflow';
alter table public.automation_ideas add column if not exists team_name text;
alter table public.automation_ideas add column if not exists team_members jsonb default '[]'::jsonb;

create index if not exists idx_automation_ideas_dept on public.automation_ideas(department);
create index if not exists idx_automation_ideas_status on public.automation_ideas(project_status);
create index if not exists idx_automation_ideas_emp on public.automation_ideas(employee_id);
create index if not exists idx_automation_ideas_proj on public.automation_ideas(project_code);
create index if not exists idx_automation_images_idea on public.automation_images(idea_id);
create index if not exists idx_automation_eval_idea on public.automation_evaluations(idea_id);

