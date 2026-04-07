import { serve } from 'https://deno.land/std@0.168.0/http/server.ts';
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

const corsHeaders = {
  'Access-Control-Allow-Origin': 'https://seamspace-crm-hub.vercel.app',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

const SUPABASE_URL = Deno.env.get('SUPABASE_URL')!;
const SERVICE_ROLE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;

function jsonResponse(body: Record<string, unknown>, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, 'Content-Type': 'application/json' },
  });
}

serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders });
  }

  try {
    // --- Verify caller JWT and admin role ---
    const authHeader = req.headers.get('Authorization') ?? '';
    if (!authHeader.startsWith('Bearer ')) {
      return jsonResponse({ error: 'Missing authorization header' }, 401);
    }

    const jwt = authHeader.replace('Bearer ', '');
    const anonClient = createClient(SUPABASE_URL, Deno.env.get('SUPABASE_ANON_KEY')!, {
      global: { headers: { Authorization: `Bearer ${jwt}` } },
    });

    const { data: { user: caller }, error: authErr } = await anonClient.auth.getUser(jwt);
    if (authErr || !caller) {
      return jsonResponse({ error: 'Invalid or expired token' }, 401);
    }

    // Check admin role from user_profiles
    const adminClient = createClient(SUPABASE_URL, SERVICE_ROLE_KEY, {
      auth: { autoRefreshToken: false, persistSession: false },
    });

    const { data: profile } = await adminClient
      .from('user_profiles')
      .select('role')
      .eq('id', caller.id)
      .single();

    const callerRole = profile?.role ?? caller.user_metadata?.role;
    if (callerRole !== 'admin' && callerRole !== 'sub_admin') {
      return jsonResponse({ error: 'Admin access required' }, 403);
    }

    // --- Parse action ---
    const body = await req.json();
    const { action } = body;

    switch (action) {
      case 'listUsers': {
        const { data, error } = await adminClient.auth.admin.listUsers();
        if (error) return jsonResponse({ error: error.message }, 400);
        return jsonResponse({ users: data.users });
      }

      case 'createUser': {
        const { email, password, user_metadata } = body;
        if (!email || !password) {
          return jsonResponse({ error: 'email and password are required' }, 400);
        }
        const { data, error } = await adminClient.auth.admin.createUser({
          email,
          password,
          email_confirm: true,
          user_metadata: user_metadata ?? {},
        });
        if (error) return jsonResponse({ error: error.message }, 400);
        return jsonResponse({ user: data.user });
      }

      case 'deleteUser': {
        const { userId } = body;
        if (!userId) return jsonResponse({ error: 'userId is required' }, 400);
        const { error } = await adminClient.auth.admin.deleteUser(userId);
        if (error) return jsonResponse({ error: error.message }, 400);
        return jsonResponse({ success: true });
      }

      case 'updateUser': {
        const { userId, password } = body;
        if (!userId) return jsonResponse({ error: 'userId is required' }, 400);
        const updates: Record<string, unknown> = {};
        if (password) updates.password = password;
        const { data, error } = await adminClient.auth.admin.updateUserById(userId, updates);
        if (error) return jsonResponse({ error: error.message }, 400);
        return jsonResponse({ user: data.user });
      }

      case 'updateProfile': {
        const { userId, updates } = body;
        if (!userId || !updates) {
          return jsonResponse({ error: 'userId and updates are required' }, 400);
        }
        const { error } = await adminClient
          .from('user_profiles')
          .update(updates)
          .eq('id', userId);
        if (error) return jsonResponse({ error: error.message }, 400);
        return jsonResponse({ success: true });
      }

      default:
        return jsonResponse({ error: `Unknown action: ${action}` }, 400);
    }
  } catch (e) {
    return jsonResponse({ error: String(e) }, 500);
  }
});
