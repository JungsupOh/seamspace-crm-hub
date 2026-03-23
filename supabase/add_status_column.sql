-- ============================================================
-- Migration: add status column to user_profiles
-- Run this in the Supabase SQL Editor
-- ============================================================

-- Add status column
ALTER TABLE user_profiles
  ADD COLUMN IF NOT EXISTS status TEXT NOT NULL
    DEFAULT 'invited'
    CHECK (status IN ('invite_failed', 'invited', 'active', 'inactive'));

-- Migrate existing data from is_first_login
UPDATE user_profiles SET status = CASE
  WHEN is_first_login = FALSE THEN 'active'
  ELSE 'invited'
END;

-- Update trigger to include status
CREATE OR REPLACE FUNCTION handle_new_user()
RETURNS TRIGGER AS $$
BEGIN
  INSERT INTO public.user_profiles (id, email, name, role, is_first_login, status)
  VALUES (
    NEW.id,
    NEW.email,
    NEW.raw_user_meta_data->>'name',
    COALESCE(NEW.raw_user_meta_data->>'role', 'guest'),
    TRUE,
    'invited'
  )
  ON CONFLICT (id) DO NOTHING;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;
