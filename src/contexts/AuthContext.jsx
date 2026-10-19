import { createContext, useContext, useEffect, useState } from 'react';
import { supabase } from '../lib/supabase';
import { setReportBusinessName } from '../lib/reports';

const AuthContext = createContext({});

export function AuthProvider({ children }) {
  const [user, setUser] = useState(null);
  const [profile, setProfile] = useState(null);
  const [organization, setOrganization] = useState(null);
  // The program this workspace runs: [{ program, plan, enabled_at }] from
  // org_programs. Falls back to Business when the table is not there yet.
  const [programs, setPrograms] = useState([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    // Check current session
    supabase.auth.getSession().then(({ data: { session } }) => {
      setUser(session?.user ?? null);
      if (session?.user) fetchProfile(session.user.id);
      else setLoading(false);
    });

    // Listen for auth changes
    const { data: { subscription } } = supabase.auth.onAuthStateChange((_event, session) => {
      setUser(session?.user ?? null);
      if (session?.user) fetchProfile(session.user.id);
      else {
        setProfile(null);
        setOrganization(null);
        setPrograms([]);
        setLoading(false);
      }
    });

    return () => subscription.unsubscribe();
  }, []);

  async function fetchProfile(userId) {
    try {
      const { data, error } = await supabase
        .from('profiles')
        .select('*')
        .eq('id', userId)
        .single();

      if (error) throw error;
      setProfile(data);
      await fetchOrganization(data?.org_id);
    } catch (err) {
      console.error('Error fetching profile:', err);
      setProfile(null);
      setOrganization(null);
      setReportBusinessName(null);
    } finally {
      setLoading(false);
    }
  }

  // The business this user belongs to. Missing org_id (DB not migrated yet)
  // just leaves organization null — nothing else depends on it.
  async function fetchOrganization(orgId) {
    if (!orgId) {
      setOrganization(null);
      setReportBusinessName(null);
      return;
    }
    const { data, error } = await supabase
      .from('organizations')
      .select('*')
      .eq('id', orgId)
      .maybeSingle();
    if (error) {
      console.error('Error fetching organization:', error);
      setOrganization(null);
      setReportBusinessName(null);
      return;
    }
    setOrganization(data);
    setReportBusinessName(data?.name);
    await fetchPrograms(orgId);
  }

  const FALLBACK_PROGRAMS = [{ program: 'business', plan: 'pilot', enabled_at: null }];

  async function fetchPrograms(orgId) {
    if (!orgId) { setPrograms([]); return; }
    const { data, error } = await supabase
      .from('org_programs')
      .select('program, plan, enabled_at')
      .eq('org_id', orgId)
      .order('enabled_at', { ascending: true });
    if (error) {
      // Table missing (migration not applied yet) or any read error: Business only.
      if (error.code !== '42P01') console.warn('org_programs read failed:', error.message);
      setPrograms(FALLBACK_PROGRAMS);
      return;
    }
    setPrograms(data?.length ? data : FALLBACK_PROGRAMS);
  }

  // Settings page: change the business row (name, business_type,
  // accounting_mode). RLS only lets admins update their own organization.
  async function updateOrganization(patch) {
    if (!organization?.id) throw new Error('No organization loaded');
    const { data, error } = await supabase
      .from('organizations')
      .update(patch)
      .eq('id', organization.id)
      .select()
      .single();
    if (error) throw error;
    setOrganization(data);
    setReportBusinessName(data?.name);
    return data;
  }

  // Self-serve sign-up. `details` = { full_name, org_name, business_type, locale, invite_code }.
  // The database trigger (handle_new_user) turns org_name/business_type into a
  // brand-new workspace with this user as its admin — unless an admin has
  // already invited this email, in which case the user joins that workspace
  // with the invited role. Any `role` sent from the client is ignored by the DB.
  async function signUp(email, password, details = {}) {
    const { full_name = '', org_name = '', business_type = 'other', locale = 'en', invite_code = '' } = details;
    const { data, error } = await supabase.auth.signUp({
      email,
      password,
      options: {
        data: { full_name, org_name, business_type, locale, invite_code },
      },
    });
    if (error) throw error;
    return data;
  }

  async function signIn(email, password) {
    const { data, error } = await supabase.auth.signInWithPassword({
      email,
      password,
    });
    if (error) throw error;
    return data;
  }

  async function signOut() {
    const { error } = await supabase.auth.signOut();
    if (error) throw error;
    setUser(null);
    setProfile(null);
    setOrganization(null);
    setPrograms([]);
    setReportBusinessName(null);
  }

  async function resetPassword(email) {
    const { error } = await supabase.auth.resetPasswordForEmail(email, {
      // The reset page lives at /reset-password (see main.jsx).
      redirectTo: `${window.location.origin}/reset-password`,
    });
    if (error) throw error;
  }

  async function updatePassword(newPassword) {
    const { error } = await supabase.auth.updateUser({ password: newPassword });
    if (error) throw error;
  }

  const isAdmin = profile?.role === 'admin';

  // 'full' | 'simple' | null (null = organization not loaded yet; pages treat
  // it as "don't redirect, show everything" to avoid a flash on first paint).
  // A workspace created before the accounting_mode migration reads as 'full'.
  const accountingMode = organization ? (organization.accounting_mode || 'full') : null;
  const programKeys = programs.map((p) => p.program);
  // Each SelRic program is its own workspace: the first (normally only) row
  // is the program this workspace runs. null until the organization loads.
  const primaryProgram = organization ? (programKeys[0] || 'business') : null;

  const value = {
    user,
    profile,
    organization,
    accountingMode,
    programs,
    programKeys,
    primaryProgram,
    loading,
    isAdmin,
    updateOrganization,
    signUp,
    signIn,
    signOut,
    resetPassword,
    updatePassword,
    refreshProfile: () => user && fetchProfile(user.id),
  };

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth() {
  const context = useContext(AuthContext);
  if (!context) throw new Error('useAuth must be used within AuthProvider');
  return context;
}
