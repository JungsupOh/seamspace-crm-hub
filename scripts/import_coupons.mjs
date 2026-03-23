// 운영DB 쿠폰 CSV → Supabase mdiary_coupons 테이블 임포트
// 실행: node scripts/import_coupons.mjs [CSV경로]

import fs from 'fs';
import path from 'path';

const SUPABASE_URL = 'https://awosikecivzhwisqzlds.supabase.co';
const SERVICE_KEY  = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImF3b3Npa2VjaXZ6aHdpc3F6bGRzIiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImlhdCI6MTc3MzYzNjY0MywiZXhwIjoyMDg5MjEyNjQzfQ.g1VNi-HZTGB0GeSDkZMPu1PYaDUeHHjfE5-wbUunsj8';

const csvPath = process.argv[2] ?? path.resolve('mDiary_app_coupon_202603222343.csv');
const content = fs.readFileSync(csvPath, 'utf8');
const lines   = content.trim().split('\n');

function parseCSVLine(line) {
  const result = [];
  let current = '', inQuotes = false;
  for (const ch of line) {
    if (ch === '"') { inQuotes = !inQuotes; }
    else if (ch === ',' && !inQuotes) { result.push(current); current = ''; }
    else { current += ch; }
  }
  result.push(current);
  return result;
}

// 이름 추출: 괄호 포함, 한글 2-4글자
function extractName(descript) {
  if (!descript) return null;
  let d = descript
    .replace(/\(유료구매\)/g, '')
    .replace(/선생님/g, '')
    .replace(/#\d+$/, '')
    .trim();

  // (이름) 형식
  const bracket = d.match(/\(([가-힣]{2,4})\)/);
  if (bracket) return bracket[1];

  // 마지막 한글 단어
  const parts = d.split(/[\s\-_,]+/).filter(Boolean);
  for (let i = parts.length - 1; i >= 0; i--) {
    if (/^[가-힣]{2,4}$/.test(parts[i])) return parts[i];
  }
  return null;
}

const rows = lines.slice(1).map(parseCSVLine);
const records = rows
  .filter(r => r.length >= 6)
  .map(r => ({
    mdiary_id:     parseInt(r[0]),
    coupon_code:   r[1].trim(),
    created_at:    r[2].trim(),
    duration:      parseInt(r[3]) || 1,
    user_limit:    parseInt(r[4]) || 0,
    is_used:       r[5] === '1',
    descript:      r[6]?.trim() ?? '',
    extracted_name: extractName(r[6]),
    used_group_id: r[7]?.trim() || null,
  }))
  .filter(r => r.mdiary_id && r.coupon_code);

console.log(`파싱 완료: ${records.length}건`);
console.log(`이름 추출됨: ${records.filter(r => r.extracted_name).length}건`);
console.log(`사용됨: ${records.filter(r => r.is_used).length}건`);

// 배치 업서트 (500건씩)
const BATCH = 500;
let inserted = 0;
for (let i = 0; i < records.length; i += BATCH) {
  const batch = records.slice(i, i + BATCH);
  const res = await fetch(`${SUPABASE_URL}/rest/v1/mdiary_coupons`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${SERVICE_KEY}`,
      apikey:        SERVICE_KEY,
      'Content-Type': 'application/json',
      Prefer: 'resolution=merge-duplicates,return=minimal',
    },
    body: JSON.stringify(batch),
  });
  if (!res.ok) {
    const err = await res.text();
    console.error(`배치 ${i}~${i+BATCH} 실패:`, err.slice(0, 200));
  } else {
    inserted += batch.length;
    process.stdout.write(`\r${inserted}/${records.length} 완료`);
  }
}
console.log('\n임포트 완료!');
