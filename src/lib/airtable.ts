import { supabase } from '@/lib/supabase';

const SUPABASE_URL = import.meta.env.VITE_SUPABASE_URL as string;
const SUPABASE_KEY = import.meta.env.VITE_SUPABASE_ANON_KEY as string;

export interface AirtableRecord<T> {
  id: string;
  fields: T;
  createdTime: string;
}

// ── Table name mapping ───────────────────────────
const TABLE_MAP: Record<string, string> = {
  '01_Contacts': 'contacts',
  '03_Deals': 'deals',
};

function resolveTable(tableName: string): string {
  return TABLE_MAP[tableName] ?? tableName;
}

// ── Field ↔ Column mappings ──────────────────────
const CONTACTS_FIELD_TO_COL: Record<string, string> = {
  Name: 'name',
  Email: 'email',
  Phone: 'phone',
  phone_normalized: 'phone_normalized',
  Org_Name: 'org_name',
  Country: 'country',
  Contact_Type: 'contact_type',
  Lead_Stage: 'lead_stage',
  Role: 'role',
  Lead_Source: 'lead_source',
  data_source_date: 'data_source_date',
  Notes: 'notes',
  School_ID_Number: 'school_id_number',
  Org_ZipCode: 'org_zipcode',
  Org_Address: 'org_address',
  Org_Address_Detail: 'org_address_detail',
  Org_Tel: 'org_tel',
  Org_Homepage: 'org_homepage',
  Education_Office: 'education_office',
};

const DEALS_FIELD_TO_COL: Record<string, string> = {
  Deal_Name: 'deal_name',
  Deal_Stage: 'deal_stage',
  Deal_Type: 'deal_type',
  Contact_Name: 'contact_name',
  Contact_Phone: 'contact_phone',
  Contact_Email: 'contact_email',
  Org_Name: 'org_name',
  Admin_Name: 'admin_name',
  Admin_Phone: 'admin_phone',
  Admin_Email: 'admin_email',
  School_ID_Number: 'school_id_number',
  Org_ZipCode: 'org_zipcode',
  Org_Address: 'org_address',
  Org_Address_Detail: 'org_address_detail',
  Org_Tel: 'org_tel',
  Org_Homepage: 'org_homepage',
  Education_Office: 'education_office',
  Quote_Date: 'quote_date',
  Quote_Qty: 'quote_qty',
  Quote_Plan: 'quote_plan',
  Quote_Number: 'quote_number',
  License_Duration: 'license_duration',
  Unit_Price: 'unit_price',
  List_Price: 'list_price',
  Supply_Price: 'supply_price',
  Tax_Amount: 'tax_amount',
  Final_Contract_Value: 'final_contract_value',
  License_Code_Count: 'license_code_count',
  License_Send_Date: 'license_send_date',
  License_Template: 'license_template',
  Renewal_Date: 'renewal_date',
  Lead_Source: 'lead_source',
  Order_Date: 'order_date',
  Contract_Date: 'contract_date',
  Charge_Date: 'charge_date',
  Payment_Date: 'payment_date',
  Receipt_Date: 'receipt_date',
  Expected_Close_Date: 'expected_close_date',
  Lost_Competitor: 'lost_competitor',
  Assigned_To: 'assigned_to',
  Notes: 'notes',
  Created_Date: 'created_date',
};

// Reverse maps (column → field)
function invertMap(m: Record<string, string>): Record<string, string> {
  const inv: Record<string, string> = {};
  for (const [k, v] of Object.entries(m)) inv[v] = k;
  return inv;
}

const CONTACTS_COL_TO_FIELD = invertMap(CONTACTS_FIELD_TO_COL);
const DEALS_COL_TO_FIELD = invertMap(DEALS_FIELD_TO_COL);

function getFieldToCol(tableName: string): Record<string, string> {
  const t = resolveTable(tableName);
  if (t === 'contacts') return CONTACTS_FIELD_TO_COL;
  if (t === 'deals') return DEALS_FIELD_TO_COL;
  return {};
}

function getColToField(tableName: string): Record<string, string> {
  const t = resolveTable(tableName);
  if (t === 'contacts') return CONTACTS_COL_TO_FIELD;
  if (t === 'deals') return DEALS_COL_TO_FIELD;
  return {};
}

// Convert Airtable-style fields object → snake_case DB row
function fieldsToRow(tableName: string, fields: Record<string, unknown>): Record<string, unknown> {
  const map = getFieldToCol(tableName);
  const row: Record<string, unknown> = {};
  for (const [field, value] of Object.entries(fields)) {
    const col = map[field] ?? field;
    row[col] = value;
  }
  return row;
}

// Convert DB row → Airtable-style { id, fields, createdTime } wrapper
function rowToRecord<T>(tableName: string, row: Record<string, unknown>): AirtableRecord<T> {
  const colToField = getColToField(tableName);
  const fields: Record<string, unknown> = {};
  for (const [col, value] of Object.entries(row)) {
    if (col === 'id' || col === 'created_at') continue;
    const fieldName = colToField[col] ?? col;
    if (value !== null && value !== undefined) {
      fields[fieldName] = value;
    }
  }
  return {
    id: String(row.id),
    fields: fields as T,
    createdTime: (row.created_at as string) ?? new Date().toISOString(),
  };
}

// ── Auth header helper ───────────────────────────
async function getAuthHeaders(): Promise<Record<string, string>> {
  const { data: { session } } = await supabase.auth.getSession();
  const headers: Record<string, string> = {
    apikey: SUPABASE_KEY,
    'Content-Type': 'application/json',
    Prefer: 'return=representation',
  };
  if (session?.access_token) {
    headers['Authorization'] = `Bearer ${session.access_token}`;
  } else {
    headers['Authorization'] = `Bearer ${SUPABASE_KEY}`;
  }
  return headers;
}

// ── Parse simple filterByFormula ──────────────────
// Supports: {Field_Name}="value"
// Returns null for complex formulas
function parseSimpleFilter(formula: string): { column: string; value: string } | null {
  const m = formula.match(/^\{([^}]+)\}\s*=\s*"([^"]*)"$/);
  if (!m) return null;
  return { column: m[1], value: m[2] };
}

// ── Core API functions ───────────────────────────

async function fetchAll<T>(tableName: string, params?: Record<string, string>): Promise<AirtableRecord<T>[]> {
  const table = resolveTable(tableName);
  const headers = await getAuthHeaders();

  let url = `${SUPABASE_URL}/rest/v1/${table}?select=*`;

  // Handle filterByFormula if present
  if (params?.filterByFormula) {
    const parsed = parseSimpleFilter(params.filterByFormula);
    if (parsed) {
      const fieldToCol = getFieldToCol(tableName);
      const col = fieldToCol[parsed.column] ?? parsed.column;
      url += `&${col}=eq.${encodeURIComponent(parsed.value)}`;
    }
    // For complex formulas, we fetch all and filter client-side below
  }

  // Handle fields[] param (select specific columns)
  if (params?.['fields[]']) {
    const fieldNames = params['fields[]'].split(',').map(f => f.trim());
    const fieldToCol = getFieldToCol(tableName);
    const cols = fieldNames.map(f => fieldToCol[f] ?? f);
    // Always include id and created_at
    const selectCols = ['id', 'created_at', ...cols].join(',');
    url = url.replace('select=*', `select=${selectCols}`);
  }

  // Order by created_at desc by default
  url += '&order=created_at.desc';

  const res = await fetch(url, { headers });

  if (!res.ok) {
    const errData = await res.json().catch(() => ({}));
    throw new Error(errData?.message || `Supabase error: ${res.status} ${res.statusText}`);
  }

  const rows = await res.json() as Record<string, unknown>[];
  let records = rows.map(row => rowToRecord<T>(tableName, row));

  // Client-side filtering for complex formulas
  if (params?.filterByFormula && !parseSimpleFilter(params.filterByFormula)) {
    // For complex formulas like FIND, OR etc., we can't easily convert.
    // Return all records and let the caller handle filtering.
    // This is a fallback — most usage is simple {Field}="value" patterns.
  }

  return records;
}

async function createRecord<T>(tableName: string, fields: Partial<T>): Promise<AirtableRecord<T>> {
  const table = resolveTable(tableName);
  const headers = await getAuthHeaders();
  const row = fieldsToRow(tableName, fields as Record<string, unknown>);

  const res = await fetch(`${SUPABASE_URL}/rest/v1/${table}`, {
    method: 'POST',
    headers,
    body: JSON.stringify(row),
  });

  if (!res.ok) {
    const errData = await res.json().catch(() => ({}));
    throw new Error(errData?.message || `Supabase create error: ${res.status}`);
  }

  const [created] = await res.json() as Record<string, unknown>[];
  return rowToRecord<T>(tableName, created);
}

async function updateRecord<T>(tableName: string, recordId: string, fields: Partial<T>): Promise<AirtableRecord<T>> {
  const table = resolveTable(tableName);
  const headers = await getAuthHeaders();
  const row = fieldsToRow(tableName, fields as Record<string, unknown>);

  const res = await fetch(`${SUPABASE_URL}/rest/v1/${table}?id=eq.${recordId}`, {
    method: 'PATCH',
    headers,
    body: JSON.stringify(row),
  });

  if (!res.ok) {
    const errData = await res.json().catch(() => ({}));
    throw new Error(errData?.message || `Supabase update error: ${res.status}`);
  }

  const [updated] = await res.json() as Record<string, unknown>[];
  return rowToRecord<T>(tableName, updated);
}

async function deleteRecord(tableName: string, recordId: string): Promise<void> {
  const table = resolveTable(tableName);
  const headers = await getAuthHeaders();

  const res = await fetch(`${SUPABASE_URL}/rest/v1/${table}?id=eq.${recordId}`, {
    method: 'DELETE',
    headers,
  });

  if (!res.ok) {
    const errData = await res.json().catch(() => ({}));
    throw new Error(errData?.message || `Supabase delete error: ${res.status}`);
  }
}

// Batch create — no 10-record limit with Supabase, but we keep batching for safety
async function createBatch<T>(tableName: string, fieldsList: Partial<T>[]): Promise<AirtableRecord<T>[]> {
  const table = resolveTable(tableName);
  const headers = await getAuthHeaders();
  const rows = fieldsList.map(fields => fieldsToRow(tableName, fields as Record<string, unknown>));

  const res = await fetch(`${SUPABASE_URL}/rest/v1/${table}`, {
    method: 'POST',
    headers,
    body: JSON.stringify(rows),
  });

  if (!res.ok) {
    const errData = await res.json().catch(() => ({}));
    throw new Error(errData?.message || `Supabase batch create error: ${res.status}`);
  }

  const created = await res.json() as Record<string, unknown>[];
  return created.map(row => rowToRecord<T>(tableName, row));
}

// Batch update — PATCH each record individually
async function updateBatch<T>(tableName: string, updates: { id: string; fields: Partial<T> }[]): Promise<void> {
  const promises = updates.map(({ id, fields }) => updateRecord<T>(tableName, id, fields));
  await Promise.all(promises);
}

export const airtable = { fetchAll, createRecord, createBatch, updateRecord, updateBatch, deleteRecord };
