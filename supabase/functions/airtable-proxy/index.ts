import { serve } from "https://deno.land/std@0.168.0/http/server.ts";

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders });
  }

  const TOKEN = Deno.env.get('VITE_AIRTABLE_TOKEN');
  const BASE_ID = 'appsnsExBG8ZeEZEk';

  if (!TOKEN) {
    return new Response(JSON.stringify({ error: 'Airtable token not configured' }), {
      status: 500,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }

  try {
    const { table, method, recordId, fields, params } = await req.json();

    if (!table) {
      return new Response(JSON.stringify({ error: 'table is required' }), {
        status: 400,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    let url = `https://api.airtable.com/v0/${BASE_ID}/${encodeURIComponent(table)}`;
    if (recordId) url += `/${recordId}`;

    // For GET requests, handle pagination
    if (!method || method === 'GET') {
      const allRecords: any[] = [];
      let offset: string | undefined;

      do {
        const searchParams = new URLSearchParams({ pageSize: '100', ...params });
        if (offset) searchParams.set('offset', offset);

        const res = await fetch(`${url}?${searchParams}`, {
          headers: { Authorization: `Bearer ${TOKEN}` },
        });

        if (!res.ok) {
          const errBody = await res.text();
          return new Response(errBody, {
            status: res.status,
            headers: { ...corsHeaders, 'Content-Type': 'application/json' },
          });
        }

        const data = await res.json();
        allRecords.push(...data.records);
        offset = data.offset;
      } while (offset);

      return new Response(JSON.stringify({ records: allRecords }), {
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    // POST / PATCH
    const res = await fetch(url, {
      method: method,
      headers: {
        Authorization: `Bearer ${TOKEN}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ fields }),
    });

    const data = await res.json();
    return new Response(JSON.stringify(data), {
      status: res.status,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  } catch (err) {
    return new Response(JSON.stringify({ error: err.message }), {
      status: 500,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }
});
