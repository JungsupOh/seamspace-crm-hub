// 고객 Lead_Stage 일괄 마이그레이션
// 실행: node scripts/migrate-stages.mjs

const TOKEN   = 'patbfjZ192vtVSrMS.89fa82409df1becebfde387774ba3f6175311e782da5b1145af4739adb2fa7ec';
const BASE_ID = 'appsnsExBG8ZeEZEk';
const TABLE   = '01_Contacts';
const BASE_URL = `https://api.airtable.com/v0/${BASE_ID}`;

const STAGE_MAP = {
  '신규':        '신규',
  '관심표명':    '관심',
  '1개월체험권': '관심',
  'Advocate':    '관심',
  '체험활성화':  '체험',
  '견적요청':    '체험',
  '협의중':      '구매',
  '구매':        '구매',
  '재구매':      '유지',
  '레퍼런스':    '유지',
};

async function fetchAll() {
  const records = [];
  let offset;
  do {
    const params = new URLSearchParams({ pageSize: '100' });
    if (offset) params.set('offset', offset);
    const res = await fetch(`${BASE_URL}/${encodeURIComponent(TABLE)}?${params}`, {
      headers: { Authorization: `Bearer ${TOKEN}` },
    });
    const data = await res.json();
    records.push(...data.records);
    offset = data.offset;
  } while (offset);
  return records;
}

async function updateBatch(updates) {
  for (let i = 0; i < updates.length; i += 10) {
    const chunk = updates.slice(i, i + 10);
    const res = await fetch(`${BASE_URL}/${encodeURIComponent(TABLE)}`, {
      method: 'PATCH',
      headers: { Authorization: `Bearer ${TOKEN}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ typecast: true, records: chunk.map(u => ({ id: u.id, fields: { Lead_Stage: u.newStage } })) }),
    });
    if (!res.ok) {
      const err = await res.json();
      throw new Error(JSON.stringify(err));
    }
    process.stdout.write(`  ${Math.min(i + 10, updates.length)}/${updates.length} 완료...\r`);
    await new Promise(r => setTimeout(r, 200)); // API 속도 제한 대응
  }
}

// ── 실행 ──────────────────────────────────────────
console.log('📋 Airtable에서 고객 데이터 로딩 중...');
const all = await fetchAll();
console.log(`  총 ${all.length}명 로드됨`);

const toUpdate = all
  .filter(r => {
    const old = r.fields.Lead_Stage;
    return old && STAGE_MAP[old] && STAGE_MAP[old] !== old;
  })
  .map(r => ({ id: r.id, old: r.fields.Lead_Stage, newStage: STAGE_MAP[r.fields.Lead_Stage] }));

if (toUpdate.length === 0) {
  console.log('✅ 변환할 레코드가 없습니다. 이미 최신 값입니다.');
  process.exit(0);
}

// 변환 예정 목록 출력
const summary = {};
toUpdate.forEach(u => {
  const key = `${u.old} → ${u.newStage}`;
  summary[key] = (summary[key] || 0) + 1;
});
console.log('\n변환 예정:');
Object.entries(summary).forEach(([k, v]) => console.log(`  ${k}: ${v}명`));
console.log(`\n총 ${toUpdate.length}명 변환 시작...\n`);

await updateBatch(toUpdate);
console.log(`\n✅ 완료! ${toUpdate.length}명 Lead_Stage 변환됨`);
