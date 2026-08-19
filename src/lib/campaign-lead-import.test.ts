import { describe, it, expect } from 'vitest';
import * as XLSX from 'xlsx';
import { excelDateToISO, parseLeadExcel } from './campaign-lead-import';

// 실제 부스 명단 엑셀과 같은 헤더 구성
const HEADERS = ['장비번호','방문시간','이름','소속','직위','주소','우편번호','전화번호','핸드폰','이메일','홈페이지'];

function makeXlsx(rows: (string | number)[][]): File {
  const ws = XLSX.utils.aoa_to_sheet([HEADERS, ...rows]);
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, 'Sheet1');
  const buf = XLSX.write(wb, { type: 'array', bookType: 'xlsx' }) as ArrayBuffer;
  return new File([buf], 'booth.xlsx');
}

describe('excelDateToISO', () => {
  it('한국시간 오전/오후 문자열을 UTC 기준 ISO로 바꾼다', () => {
    // 2026-08-12 11:30:30 KST === 02:30:30 UTC
    expect(excelDateToISO('2026-08-12 오전 11:30:30')).toBe('2026-08-12T02:30:30.000Z');
    // 오후 12시대는 12를 더하지 않는다
    expect(excelDateToISO('2026-08-12 오후 12:05:00')).toBe('2026-08-12T03:05:00.000Z');
    // 오전 12시는 자정(0시)
    expect(excelDateToISO('2026-08-12 오전 12:10:00')).toBe('2026-08-11T15:10:00.000Z');
    // 오후 1시 → 13시
    expect(excelDateToISO('2026-08-12 오후 1:05:00')).toBe('2026-08-12T04:05:00.000Z');
  });

  it('빈 값은 null', () => {
    expect(excelDateToISO('')).toBeNull();
    expect(excelDateToISO(null)).toBeNull();
    expect(excelDateToISO(undefined)).toBeNull();
  });

  it('날짜만 있어도 파싱된다', () => {
    expect(excelDateToISO('2026-08-12')).toBe('2026-08-11T15:00:00.000Z');
  });
});

describe('parseLeadExcel', () => {
  it('정상 행을 파싱하고 전화번호를 숫자만으로 정규화한다', async () => {
    const f = makeXlsx([
      ['P415','2026-08-12 오전 11:30:30','김다영','시흥매화고등학교','교육과정 부장','기타','','','010-4252-9423','adess@hanmail.net',''],
    ]);
    const r = await parseLeadExcel(f);
    expect(r.total).toBe(1);
    expect(r.rows).toHaveLength(1);
    const row = r.rows[0];
    expect(row.name).toBe('김다영');
    expect(row.phone).toBe('010-4252-9423');
    expect(row.phone_normalized).toBe('01042529423');   // 하이픈 없이 저장돼야 중복판정이 맞는다
    expect(row.school_name).toBe('시흥매화고등학교');
    expect(row.position).toBe('교육과정 부장');
    expect(row.email).toBe('adess@hanmail.net');
    expect(row.visited_at).toBe('2026-08-12T02:30:30.000Z');
    expect(row.custom_fields['장비번호']).toBe('P415');
    // 주소가 더미값 '기타'면 버린다
    expect(row.custom_fields['주소']).toBeUndefined();
  });

  it('핸드폰 없는 행은 제외하고 이름을 보고한다', async () => {
    const f = makeXlsx([
      ['P415','2026-08-12 오전 11:52:02','박미희','','초등교사','기타','','','','',''],
      ['P415','2026-08-12 오전 11:53:32','이혜리','고산별빛초등학교','교직원','경기 광주시','','031-8027-9875','010-8305-0141','x@daum.net',''],
    ]);
    const r = await parseLeadExcel(f);
    expect(r.total).toBe(2);
    expect(r.rows).toHaveLength(1);
    expect(r.noPhone).toEqual(['박미희']);
    expect(r.rows[0].custom_fields['유선전화']).toBe('031-8027-9875');
    expect(r.rows[0].custom_fields['주소']).toBe('경기 광주시');
  });

  it('파일 안에서 번호가 겹치면 첫 행만 남긴다', async () => {
    const f = makeXlsx([
      ['P415','2026-08-12 오전 11:44:53','김은정','성원초등학교','교직원','','','','010-2598-4825','a@naver.com',''],
      ['P416','2026-08-12 오후 2:10:00','김은정(재방문)','성원초등학교','교직원','','','','010-2598-4825','a@naver.com',''],
    ]);
    const r = await parseLeadExcel(f);
    expect(r.rows).toHaveLength(1);
    expect(r.rows[0].name).toBe('김은정');
    expect(r.dupInFile).toEqual(['김은정(재방문)']);
  });

  it('하이픈 유무나 국가번호가 달라도 같은 번호로 본다', async () => {
    const f = makeXlsx([
      ['P415','2026-08-12 오전 9:00:00','A','학교','','','','','01042529423','',''],
      ['P415','2026-08-12 오전 9:01:00','B','학교','','','','','+82 10-4252-9423','',''],
    ]);
    const r = await parseLeadExcel(f);
    expect(r.rows).toHaveLength(1);
    expect(r.dupInFile).toEqual(['B']);
    expect(r.rows[0].phone_normalized).toBe('01042529423');
  });

  it('비어있는 선택 항목은 undefined로 둔다', async () => {
    const f = makeXlsx([
      ['','2026-08-12 오전 11:50:51','최경애','경기상업고등학교','공무원','서울 종로구','','02-737-6490','010-2039-1638','',''],
    ]);
    const r = await parseLeadExcel(f);
    const row = r.rows[0];
    expect(row.email).toBeUndefined();
    expect(row.custom_fields['장비번호']).toBeUndefined();
  });
});
