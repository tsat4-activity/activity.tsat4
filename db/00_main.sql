-- ตารางกลางของ TSAT4 5S: พนักงาน, หน่วยงาน (costcenter), บัญชีเข้าสู่ระบบ
-- รันใน SQL Editor ของ Supabase โปรเจกต์ใหม่ (โปรเจกต์เดียวกับตาราง 5S) · รันซ้ำได้
-- ต้องรันก่อน db/act/5s.sql · ชื่อคอลัมน์ตรงกับที่ server ใช้ (server/core/users.js, server/core/tables.js)

create table if not exists public.mt_main_costcenter (
  costcenter text primary key,
  object_name text not null,
  group_name text not null default 'Factory' check (group_name in ('Factory', 'Non', 'Center')),
  department text not null,
  status text not null default 'Active' check (status in ('Active', 'Inactive')),
  created_at timestamptz not null default now()
);

create table if not exists public.mt_main_employee (
  employee_id text primary key,
  prefix text,
  first_name text not null,
  last_name text not null,
  position text,
  -- S/T = พนักงาน, M = ผู้จัดการ, G = ผู้จัดการโรงงาน
  level text not null default 'S1' check (level in ('S1', 'S2', 'S3', 'T1', 'T2', 'T3', 'T6', 'T7', 'T8', 'M1', 'M2', 'M3', 'G1', 'G2', 'G3')),
  department text,
  status text not null default 'Active' check (status in ('Active', 'Inactive')),
  created_at timestamptz not null default now()
);

-- employee_id references mt_main_employee: the FK name mt_main_user_employee_id_fkey is used by loadUser.
create table if not exists public.mt_main_user (
  employee_id text primary key references public.mt_main_employee (employee_id) on update cascade,
  password_hash text not null,
  role text not null default 'employee',
  creator boolean not null default false,
  executive boolean not null default false,
  admin_of text[] not null default '{}',
  department text,
  status text not null default 'Active' check (status in ('Active', 'Inactive')),
  password_changed_at timestamptz not null default now(),
  password_expires_at timestamptz not null default now() + interval '90 days',
  created_at timestamptz not null default now()
);

-- A new password lasts 90 days (the app asks for a new one after that).
create or replace function public.mt_main_user_expiry() returns trigger language plpgsql as $$
begin
  if tg_op = 'INSERT' or new.password_changed_at is distinct from old.password_changed_at then
    new.password_expires_at := new.password_changed_at + interval '90 days';
  end if;
  return new;
end $$;
drop trigger if exists mt_main_user_expiry on public.mt_main_user;
create trigger mt_main_user_expiry before insert or update on public.mt_main_user
  for each row execute function public.mt_main_user_expiry();

create index if not exists mt_main_employee_department_idx on public.mt_main_employee (department);
create index if not exists mt_main_costcenter_department_idx on public.mt_main_costcenter (department);

-- รูปพนักงาน อัตราส่วน 2.5 : 3 (ผู้ใช้กำหนด 2026-10-30) · เก็บลิงก์รูปใน Storage bucket img_main · เพิ่มทีหลัง จึงใช้ add column (รันซ้ำได้)
alter table public.mt_main_employee add column if not exists photo text;

-- ที่เก็บรูปของตารางกลาง (Supabase Storage) ชื่อ img_main · รูป JPEG ≤ 700 KB เปิดดูได้ด้วยลิงก์
-- ข้ามไปเองถ้าฐานไม่มี storage (เช่นตอนทดสอบด้วย PGlite)
do $$ begin
  if to_regclass('storage.buckets') is not null then
    insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
    values ('img_main', 'img_main', true, 716800, array['image/jpeg', 'image/png'])
    on conflict (id) do update set allowed_mime_types = array['image/jpeg', 'image/png'];
  end if;
end $$;

-- Only the server (service key) reads these tables; the browser never does.
-- ข้อมูลบริษัท 1 แถว (id = main): โลโก้ 1:1 + ชื่ออังกฤษ/ไทย ที่ header
-- และรายละเอียดองค์กรของ Fr-01 (ย้ายจาก mt_cfo_setting company_* เมื่อ 2026-11-09)
create table if not exists public.mt_main_company (
  id text primary key,
  logo text,
  name_en text not null default '',
  name_th text not null default '',
  legal_name text not null default '',
  address text not null default '',
  area text not null default '',
  business text not null default '',
  customers text not null default '',
  employees text not null default '',
  profile_on text not null default '',
  register_on text not null default '',
  photo1 text not null default '',
  photo2 text not null default '',
  updated_at timestamptz not null default now()
);
insert into public.mt_main_company (id, name_en, name_th)
values ('main', 'TSAT4 Activity', '')
on conflict (id) do nothing;
alter table public.mt_main_company add column if not exists legal_name text not null default '';
alter table public.mt_main_company add column if not exists address text not null default '';
alter table public.mt_main_company add column if not exists area text not null default '';
alter table public.mt_main_company add column if not exists business text not null default '';
alter table public.mt_main_company add column if not exists customers text not null default '';
alter table public.mt_main_company add column if not exists employees text not null default '';
alter table public.mt_main_company add column if not exists profile_on text not null default '';
alter table public.mt_main_company add column if not exists register_on text not null default '';
alter table public.mt_main_company add column if not exists photo1 text not null default '';
alter table public.mt_main_company add column if not exists photo2 text not null default '';

alter table public.mt_main_costcenter enable row level security;
alter table public.mt_main_employee enable row level security;
alter table public.mt_main_user enable row level security;
alter table public.mt_main_company enable row level security;

-- ผู้ดูแลระบบคนแรก (รหัส 2102899 = ผู้สร้างระบบ, CREATOR_ID) · แก้ชื่อ-หน่วยงานภายหลังได้ที่ Setting
-- บัญชีเข้าสู่ระบบสร้างเองตอนเซิร์ฟเวอร์เริ่ม จาก BOOTSTRAP_EMPLOYEE_ID / BOOTSTRAP_PASSWORD ใน Render
insert into public.mt_main_costcenter (costcenter, object_name, group_name, department)
values ('QSM', 'QSM', 'Center', 'QSM')
on conflict (costcenter) do nothing;
insert into public.mt_main_employee (employee_id, first_name, last_name, level, department)
values ('2102899', 'ผู้ดูแล', 'ระบบ', 'S1', 'QSM')
on conflict (employee_id) do nothing;

notify pgrst, 'reload schema';
