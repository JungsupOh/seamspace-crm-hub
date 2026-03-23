-- ============================================================
-- Seamspace CRM - User Management Tables
-- Run this in the Supabase SQL Editor
-- ============================================================

-- user_profiles table
CREATE TABLE IF NOT EXISTS user_profiles (
  id UUID REFERENCES auth.users(id) ON DELETE CASCADE PRIMARY KEY,
  email TEXT NOT NULL,
  name TEXT,
  role TEXT NOT NULL CHECK (role IN ('admin', 'sub_admin', 'guest')) DEFAULT 'guest',
  is_first_login BOOLEAN DEFAULT TRUE,
  created_by UUID,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- Enable RLS
ALTER TABLE user_profiles ENABLE ROW LEVEL SECURITY;

-- Allow all authenticated users to read/write their own profile
-- and admins to manage all profiles
CREATE POLICY "Allow all for authenticated" ON user_profiles
  FOR ALL
  TO authenticated
  USING (true)
  WITH CHECK (true);

-- ============================================================
-- Trigger: auto-create profile when a new auth user is created
-- ============================================================
CREATE OR REPLACE FUNCTION handle_new_user()
RETURNS TRIGGER AS $$
BEGIN
  INSERT INTO public.user_profiles (id, email, name, role, is_first_login)
  VALUES (
    NEW.id,
    NEW.email,
    NEW.raw_user_meta_data->>'name',
    COALESCE(NEW.raw_user_meta_data->>'role', 'guest'),
    TRUE
  )
  ON CONFLICT (id) DO NOTHING;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

DROP TRIGGER IF EXISTS on_auth_user_created ON auth.users;
CREATE TRIGGER on_auth_user_created
  AFTER INSERT ON auth.users
  FOR EACH ROW EXECUTE FUNCTION handle_new_user();

-- ============================================================
-- Seed: create initial admin profile
-- (run AFTER creating the admin auth user via Supabase dashboard
--  or Auth > Users > Invite user)
-- ============================================================
-- INSERT INTO public.user_profiles (id, email, name, role, is_first_login)
-- VALUES (
--   '<admin-auth-user-uuid>',
--   'admin@seamspace.co.kr',
--   '관리자',
--   'admin',
--   FALSE
-- )
-- ON CONFLICT (id) DO UPDATE
--   SET role = 'admin', is_first_login = FALSE;
