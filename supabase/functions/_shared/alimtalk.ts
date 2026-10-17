// 알림톡 발송 공통 헬퍼 — iptime 백엔드(개발팀 API)로 직접 POST 한다.
//
// send-shop-alimtok 는 브라우저가 CORS 때문에 직접 못 부르는 걸 우회하는 함수라
// 파라미터 화이트리스트가 shop 템플릿에 맞춰져 있다. 서버→서버인 웹훅 쪽은
// 그걸 거치지 않고 여기서 바로 보낸다 — Edge→Edge 호출의 verify_jwt 문제도 피한다.

const ALIMTOK_SEND_URL = "http://tebahsoft.iptime.org:8310/main/alimtok_send/";

export interface AlimtalkPayload {
  tpl_code: string;
  name: string;
  phone: string;
  [key: string]: string | undefined;
}

export interface AlimtalkResult {
  ok: boolean;
  status: number;
  body: string;
}

export async function sendAlimtalk(payload: AlimtalkPayload): Promise<AlimtalkResult> {
  // 빈 값은 빼고 보낸다 — 템플릿 변수에 빈 문자열이 들어가면 발송이 거부된다
  const body: Record<string, string> = {};
  for (const [k, v] of Object.entries(payload)) {
    if (v !== undefined && v !== null && String(v).trim() !== "") body[k] = String(v);
  }

  console.log("[alimtalk] 요청:", JSON.stringify(body));
  const r = await fetch(ALIMTOK_SEND_URL, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  const text = await r.text();
  console.log(`[alimtalk] 응답 ${r.status}:`, text);
  return { ok: r.ok, status: r.status, body: text };
}

/** 스위트북 택배사 코드 → 알림톡 템플릿이 기대하는 한글 택배사명 */
const CARRIERS: Record<string, string> = {
  CJ: "CJ대한통운",
  HANJIN: "한진택배",
  LOTTE: "롯데택배",
  POST: "우체국택배",
  KOREAPOST: "우체국택배",
  LOGEN: "로젠택배",
  HANARO: "하나로택배",
  CU: "CU편의점택배",
  GS: "GS편의점택배",
};

export function carrierName(code?: string | null): string {
  if (!code) return "";
  return CARRIERS[code.toUpperCase()] ?? code;
}
