import { serve } from 'https://deno.land/std@0.168.0/http/server.ts';

const AIRTABLE_TOKEN = Deno.env.get('AIRTABLE_TOKEN') ?? '';
const AIRTABLE_BASE_ID = Deno.env.get('AIRTABLE_BASE_ID') ?? '';
const BASE_URL = `https://api.airtable.com/v0/${AIRTABLE_BASE_ID}`;

const corsHeaders = {
  'Access-Control-Allow-Origin': 'https://seamspace-crm-hub.vercel.app',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

function jsonResponse(data: unknown, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { ...corsHeaders, 'Content-Type': 'application/json' },
  });
}

function errorResponse(status: number, message: string) {
  return jsonResponse({ error: message }, status);
}

serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders });
  }

  try {
    // ── Auth 검증 ──────────────────────────────────────
    const authHeader = req.headers.get('Authorization');
    if (!authHeader) return errorResponse(401, 'Unauthorized');

    const supabaseUrl = Deno.env.get('SUPABASE_URL')!;
    const supabaseKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
    const { createClient } = await import('https://esm.sh/@supabase/supabase-js@2');
    const supabase = createClient(supabaseUrl, supabaseKey);
    const token = authHeader.replace('Bearer ', '');
    const { data: { user }, error: authError } = await supabase.auth.getUser(token);
    if (authError || !user) return errorResponse(401, 'Invalid token');

    // ── 요청 파싱 ──────────────────────────────────────
    const { action, table, params, recordId, fields, records, updates } = await req.json();

    if (!action || !table) {
      return errorResponse(400, 'action과 table은 필수입니다');
    }

    const tableUrl = `${BASE_URL}/${encodeURIComponent(table)}`;
    const headers: Record<string, string> = {
      Authorization: `Bearer ${AIRTABLE_TOKEN}`,
      'Content-Type': 'application/json',
    };

    // ── fetchAll (페이지네이션 포함) ────────────────────
    if (action === 'fetchAll') {
      const allRecords: unknown[] = [];
      let offset: string | undefined;

      do {
        const searchParams = new URLSearchParams({ pageSize: '100', ...params });
        if (offset) searchParams.set('offset', offset);

        const res = await fetch(`${tableUrl}?${searchParams}`, {
          headers: { Authorization: `Bearer ${AIRTABLE_TOKEN}` },
        });

        if (!res.ok) {
          const body = await res.json().catch(() => ({}));
          return errorResponse(res.status, body?.error?.message || `Airtable error: ${res.status}`);
        }

        const data = await res.json();
        allRecords.push(...(data.records ?? []));
        offset = data.offset;
      } while (offset);

      return jsonResponse({ records: allRecords });
    }

    // ── createRecord ────────────────────────────────────
    if (action === 'createRecord') {
      const res = await fetch(tableUrl, {
        method: 'POST',
        headers,
        body: JSON.stringify({ fields }),
      });
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        return errorResponse(res.status, body?.error?.message || `Airtable error: ${res.status}`);
      }
      return jsonResponse(await res.json());
    }

    // ── updateRecord ────────────────────────────────────
    if (action === 'updateRecord') {
      if (!recordId) return errorResponse(400, 'recordId는 필수입니다');
      const res = await fetch(`${tableUrl}/${recordId}`, {
        method: 'PATCH',
        headers,
        body: JSON.stringify({ fields }),
      });
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        return errorResponse(res.status, body?.error?.message || `Airtable error: ${res.status}`);
      }
      return jsonResponse(await res.json());
    }

    // ── deleteRecord ────────────────────────────────────
    if (action === 'deleteRecord') {
      if (!recordId) return errorResponse(400, 'recordId는 필수입니다');
      const res = await fetch(`${tableUrl}/${recordId}`, {
        method: 'DELETE',
        headers: { Authorization: `Bearer ${AIRTABLE_TOKEN}` },
      });
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        return errorResponse(res.status, body?.error?.message || `Airtable error: ${res.status}`);
      }
      return jsonResponse({ success: true });
    }

    // ── createBatch ─────────────────────────────────────
    if (action === 'createBatch') {
      if (!Array.isArray(records)) return errorResponse(400, 'records 배열이 필요합니다');
      const res = await fetch(tableUrl, {
        method: 'POST',
        headers,
        body: JSON.stringify({ records: records.map((r: { fields: unknown }) => ({ fields: r.fields ?? r })) }),
      });
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        return errorResponse(res.status, body?.error?.message || `Airtable error: ${res.status}`);
      }
      return jsonResponse(await res.json());
    }

    // ── updateBatch ─────────────────────────────────────
    if (action === 'updateBatch') {
      if (!Array.isArray(updates)) return errorResponse(400, 'updates 배열이 필요합니다');
      // Airtable 최대 10건씩 배치 처리
      for (let i = 0; i < updates.length; i += 10) {
        const chunk = updates.slice(i, i + 10);
        const res = await fetch(tableUrl, {
          method: 'PATCH',
          headers,
          body: JSON.stringify({ records: chunk.map((u: { id: string; fields: unknown }) => ({ id: u.id, fields: u.fields })) }),
        });
        if (!res.ok) {
          const body = await res.json().catch(() => ({}));
          return errorResponse(res.status, body?.error?.message || `Airtable error: ${res.status}`);
        }
      }
      return jsonResponse({ success: true });
    }

    return errorResponse(400, `알 수 없는 action: ${action}`);
  } catch (e) {
    return new Response(JSON.stringify({ error: String(e) }), {
      status: 500,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }
});
