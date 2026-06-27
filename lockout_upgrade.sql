-- ============================================================
-- SAHAJA SPARE SHOP — DATABASE UPGRADE (LOGIN SECURITY LOCKOUT)
-- Run this script in your Supabase SQL Editor.
-- ============================================================

-- 1. Ensure operators table exists (matches the schema additions)
CREATE TABLE IF NOT EXISTS public.operators (
  id UUID PRIMARY KEY, -- References auth.users(id)
  name TEXT UNIQUE NOT NULL,
  email TEXT UNIQUE NOT NULL,
  role TEXT NOT NULL DEFAULT 'employee', -- 'owner' | 'employee'
  created_at TIMESTAMPTZ DEFAULT now()
);

-- 2. Add failed_attempts and locked_until columns to public.operators
ALTER TABLE public.operators 
  ADD COLUMN IF NOT EXISTS failed_attempts INTEGER DEFAULT 0,
  ADD COLUMN IF NOT EXISTS locked_until TIMESTAMPTZ;

-- 2. Function to check lockout status (SECURITY DEFINER to bypass RLS)
CREATE OR REPLACE FUNCTION public.check_login_lockout(p_email TEXT)
RETURNS JSON AS $$
DECLARE
  v_operator RECORD;
  v_locked BOOLEAN := FALSE;
  v_seconds_left INTEGER := 0;
BEGIN
  -- Find operator by email (case-insensitive)
  SELECT * INTO v_operator 
  FROM public.operators 
  WHERE LOWER(email) = LOWER(p_email);

  IF v_operator IS NULL THEN
    RETURN json_build_object('locked', false);
  END IF;

  -- Check if locked out
  IF v_operator.locked_until IS NOT NULL AND v_operator.locked_until > now() THEN
    v_locked := TRUE;
    v_seconds_left := CEIL(EXTRACT(EPOCH FROM (v_operator.locked_until - now())))::INTEGER;
  ELSIF v_operator.locked_until IS NOT NULL AND v_operator.locked_until <= now() THEN
    -- Lockout expired, reset attempts in DB
    UPDATE public.operators 
    SET failed_attempts = 0, locked_until = NULL 
    WHERE id = v_operator.id;
  END IF;

  RETURN json_build_object(
    'locked', v_locked,
    'seconds_left', v_seconds_left
  );
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- 3. Function to record failed attempt (SECURITY DEFINER to allow public updates)
CREATE OR REPLACE FUNCTION public.record_failed_attempt(p_email TEXT)
RETURNS JSON AS $$
DECLARE
  v_operator RECORD;
  v_attempts INTEGER := 0;
  v_locked BOOLEAN := FALSE;
  v_lockout_duration INTERVAL := INTERVAL '15 minutes';
  v_locked_until TIMESTAMPTZ := NULL;
BEGIN
  -- Find operator by email (case-insensitive)
  SELECT * INTO v_operator 
  FROM public.operators 
  WHERE LOWER(email) = LOWER(p_email);

  IF v_operator IS NULL THEN
    RETURN json_build_object('locked', false, 'attempts', 0);
  END IF;

  -- Increment attempts
  v_attempts := v_operator.failed_attempts + 1;

  IF v_attempts >= 3 THEN
    v_locked := TRUE;
    v_locked_until := now() + v_lockout_duration;
    
    UPDATE public.operators 
    SET failed_attempts = v_attempts,
        locked_until = v_locked_until
    WHERE id = v_operator.id;
  ELSE
    UPDATE public.operators 
    SET failed_attempts = v_attempts
    WHERE id = v_operator.id;
  END IF;

  RETURN json_build_object(
    'locked', v_locked,
    'attempts', v_attempts,
    'locked_until', v_locked_until
  );
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- 4. Function to reset/record successful login (SECURITY DEFINER to allow resets)
CREATE OR REPLACE FUNCTION public.record_successful_login(p_email TEXT)
RETURNS BOOLEAN AS $$
BEGIN
  UPDATE public.operators 
  SET failed_attempts = 0, locked_until = NULL 
  WHERE LOWER(email) = LOWER(p_email);
  
  RETURN TRUE;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;
