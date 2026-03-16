const BASE_URL = `https://api.airtable.com/v0/${import.meta.env.VITE_AIRTABLE_BASE_ID || 'appsnsExBG8ZeEZEk'}`;
const TOKEN = import.meta.env.VITE_AIRTABLE_TOKEN || '';

interface AirtableResponse<T> {
  records: AirtableRecord<T>[];
  offset?: string;
}

export interface AirtableRecord<T> {
  id: string;
  fields: T;
  createdTime: string;
}

async function fetchAll<T>(tableName: string, params?: Record<string, string>): Promise<AirtableRecord<T>[]> {
  const allRecords: AirtableRecord<T>[] = [];
  let offset: string | undefined;

  do {
    const searchParams = new URLSearchParams({ pageSize: '100', ...params });
    if (offset) searchParams.set('offset', offset);

    const res = await fetch(`${BASE_URL}/${encodeURIComponent(tableName)}?${searchParams}`, {
      headers: { Authorization: `Bearer ${TOKEN}` },
    });

    if (!res.ok) {
      throw new Error(`Airtable error: ${res.status} ${res.statusText}`);
    }

    const data: AirtableResponse<T> = await res.json();
    allRecords.push(...data.records);
    offset = data.offset;
  } while (offset);

  return allRecords;
}

async function createRecord<T>(tableName: string, fields: Partial<T>): Promise<AirtableRecord<T>> {
  const res = await fetch(`${BASE_URL}/${encodeURIComponent(tableName)}`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${TOKEN}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ fields }),
  });
  if (!res.ok) throw new Error(`Airtable create error: ${res.status}`);
  return res.json();
}

async function updateRecord<T>(tableName: string, recordId: string, fields: Partial<T>): Promise<AirtableRecord<T>> {
  const res = await fetch(`${BASE_URL}/${encodeURIComponent(tableName)}/${recordId}`, {
    method: 'PATCH',
    headers: {
      Authorization: `Bearer ${TOKEN}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ fields }),
  });
  if (!res.ok) throw new Error(`Airtable update error: ${res.status}`);
  return res.json();
}

export const airtable = { fetchAll, createRecord, updateRecord };
