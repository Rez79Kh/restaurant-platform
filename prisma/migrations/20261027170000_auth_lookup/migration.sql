-- Auth bootstrap: the only two ways across the tenant boundary.
--
-- Login must find a staff member by (restaurant slug, phone), and every
-- request must find its session by token hash, both BEFORE a tenant context
-- exists. app_user cannot do either (RLS returns zero rows without context).
--
-- Two narrow SECURITY DEFINER functions do exactly those lookups and nothing
-- else. They are owned by app_auth, a NOLOGIN role with SELECT on three
-- tables and RLS policies that apply to app_auth only. This works the same
-- whether or not the migration owner bypasses RLS (local superuser: yes; Neon
-- owner: no). app_user can execute the functions but cannot become app_auth.
--
-- Idempotent, like the role migration before it.

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'app_auth') THEN
    CREATE ROLE app_auth NOLOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE NOBYPASSRLS;
  END IF;
END
$$;

-- Handing a function to app_auth (ALTER ... OWNER TO, below) needs two things
-- a non-superuser owner like Neon's doesn't have by default: membership in
-- app_auth (to SET ROLE to it), and CREATE on the schema for app_auth.
-- Superusers skip both checks, which is how this once passed only locally.
-- CREATE is granted just for the ownership change and revoked right after.
GRANT app_auth TO CURRENT_USER;
GRANT CREATE ON SCHEMA public TO app_auth;

GRANT USAGE ON SCHEMA public TO app_auth;
GRANT SELECT ON "restaurants", "staff_members", "sessions" TO app_auth;

DROP POLICY IF EXISTS auth_lookup ON "restaurants";
CREATE POLICY auth_lookup ON "restaurants" FOR SELECT TO app_auth USING (true);
DROP POLICY IF EXISTS auth_lookup ON "staff_members";
CREATE POLICY auth_lookup ON "staff_members" FOR SELECT TO app_auth USING (true);
DROP POLICY IF EXISTS auth_lookup ON "sessions";
CREATE POLICY auth_lookup ON "sessions" FOR SELECT TO app_auth USING (true);

-- Login: returns the PIN hash for the app to verify (the PIN never reaches SQL).
CREATE OR REPLACE FUNCTION auth_find_staff(p_slug text, p_phone text)
RETURNS TABLE (restaurant_id uuid, staff_id uuid, pin_hash text, role text, is_active boolean)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public, pg_temp AS $$
  SELECT s.restaurant_id, s.id, s.pin_hash, s.role::text, s.is_active
  FROM restaurants r
  JOIN staff_members s ON s.restaurant_id = r.id
  WHERE r.slug = p_slug AND s.phone = p_phone
$$;

-- Every authenticated request: a live session of an active staff member.
CREATE OR REPLACE FUNCTION auth_find_session(p_token_hash text)
RETURNS TABLE (
  session_id uuid, restaurant_id uuid, staff_id uuid, branch_id uuid,
  role text, name text, expires_at timestamptz
)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public, pg_temp AS $$
  SELECT ss.id, ss.restaurant_id, s.id, s.branch_id, s.role::text, s.name, ss.expires_at
  FROM sessions ss
  JOIN staff_members s ON s.restaurant_id = ss.restaurant_id AND s.id = ss.staff_member_id
  WHERE ss.token_hash = p_token_hash AND ss.expires_at > now() AND s.is_active
$$;

ALTER FUNCTION auth_find_staff(text, text) OWNER TO app_auth;
ALTER FUNCTION auth_find_session(text) OWNER TO app_auth;
REVOKE CREATE ON SCHEMA public FROM app_auth;
REVOKE ALL ON FUNCTION auth_find_staff(text, text) FROM PUBLIC;
REVOKE ALL ON FUNCTION auth_find_session(text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION auth_find_staff(text, text) TO app_user;
GRANT EXECUTE ON FUNCTION auth_find_session(text) TO app_user;
