// 파트너 포털의 "내 계약" 구역 문구 (LEAD-S7-4)
//
// 기존 `partner-i18n.ts` 의 `Msg`·`makeT` 를 그대로 쓴다(ko 기본, ja·en 폴백).
// 여기 모아 두면 **번역 빠짐을 테스트가 한 곳에서 잡을 수 있다.**
//
// ⚠️ 파트너에게 보여 주는 글이다. 내부 숫자·다른 파트너 정보를 넣지 않는다.

import type { Msg } from '@/lib/partner-i18n';

export const PORTAL_MSG = {
  // ── 구역 제목 ──
  sectionTitle: { ko: '내 계약', ja: '契約', en: 'My contract' },
  balance:      { ko: '잔여 수량', ja: '残り数量', en: 'Remaining' },
  purchased:    { ko: '구매 합계', ja: '購入合計', en: 'Purchased' },
  issued:       { ko: '발급 합계', ja: '発行合計', en: 'Issued' },
  contracted:   { ko: '계약 수량', ja: '契約数量', en: 'Contracted' },
  unitPrice:    { ko: '연간 인원당 단가', ja: '年間1人あたり単価', en: 'Price per seat / year' },
  period:       { ko: '계약 기간', ja: '契約期間', en: 'Contract period' },
  purchases:    { ko: '구매 내역', ja: '購入履歴', en: 'Purchase history' },
  seatMonths:   { ko: '인원·개월', ja: '人月', en: 'seat-months' },

  // ── 청구·입금 ──
  billUnbilled: { ko: '청구 전',    ja: '請求前',   en: 'Not invoiced' },
  billBilled:   { ko: '청구함',     ja: '請求済み', en: 'Invoiced' },
  billPartial:  { ko: '일부 입금',  ja: '一部入金', en: 'Partially paid' },
  billPaid:     { ko: '입금 완료',  ja: '入金済み', en: 'Paid' },
  paidOn:       { ko: '입금일',     ja: '入金日',   en: 'Paid on' },
  invoicedOn:   { ko: '청구일',     ja: '請求日',   en: 'Invoiced on' },

  // ── 잔량 안내 ──
  balanceZero: {
    ko: '보유 수량을 모두 썼습니다. 추가 구매를 요청해 주세요.',
    ja: '残り数量がありません。追加購入をご依頼ください。',
    en: 'You have used all of your seat-months. Please request an additional purchase.',
  },
  balanceNegative: {
    ko: '발급이 보유 수량을 넘었습니다. 담당자에게 문의해 주세요.',
    ja: '発行が保有数量を超えています。担当者にお問い合わせください。',
    en: 'Issued amount exceeds what was purchased. Please contact us.',
  },
  balanceUnknown: {
    // 숫자를 지어내지 않는다 — 셀 수 없으면 셀 수 없다고 말한다.
    ko: '수량을 확인할 수 없는 발급 기록이 있어 잔여 수량을 셀 수 없습니다. 담당자가 확인한 뒤 발급할 수 있습니다.',
    ja: '数量を確認できない発行記録があるため、残り数量を計算できません。担当者の確認後に発行できます。',
    en: 'Some issuance records have an unknown quantity, so we cannot calculate the remaining balance. We will check and get back to you.',
  },
  unpaidOk: {
    ko: '입금 전이어도 발급할 수 있습니다. 미수금은 따로 안내드립니다.',
    ja: '入金前でも発行できます。未入金分は別途ご案内します。',
    en: 'You can issue licenses before payment arrives. We will follow up on anything outstanding.',
  },

  // ── 계약 선택 ──
  chooseContract: {
    ko: '어느 계약에서 발급할까요?',
    ja: 'どの契約から発行しますか？',
    en: 'Which contract should this be issued from?',
  },
  chooseContractRequired: {
    ko: '계약을 선택해 주세요.',
    ja: '契約を選択してください。',
    en: 'Please choose a contract.',
  },
  contractFixed: {
    ko: '이 계약에서 발급됩니다.',
    ja: 'この契約から発行されます。',
    en: 'This will be issued from this contract.',
  },

  // ── 요청 ──
  requestPurchase:  { ko: '추가 구매 요청', ja: '追加購入を依頼', en: 'Request more seats' },
  requestPurchaseHint: {
    ko: '필요한 수량을 적어 보내시면 확인하고 연락드립니다. (바로 청구서가 나가지는 않습니다)',
    ja: '必要な数量をお送りいただければ、確認のうえご連絡します。（すぐに請求書が発行されるわけではありません）',
    en: 'Tell us how much you need and we will get back to you. (No invoice is issued automatically.)',
  },
  requestSeats: { ko: '희망 수량 (선택)', ja: '希望数量（任意）', en: 'How much do you need? (optional)' },
  requestNote:  { ko: '메모 (선택)', ja: 'メモ（任意）', en: 'Note (optional)' },
  requestSend:  { ko: '요청 보내기', ja: '依頼を送る', en: 'Send request' },
  requestOpen:  { ko: '요청을 보냈습니다. 확인 중입니다.', ja: '依頼済みです。確認中です。', en: 'Request sent — we are looking at it.' },

  requestRevoke: { ko: '사용 불가 처리 요청', ja: '利用停止を依頼', en: 'Request to disable' },
  requestRevokeHint: {
    // ⚠️ "껐다"고 오해하지 않게 — 가장 중요한 문구다.
    ko: '이용권을 사용 불가로 표시해 달라는 요청입니다. **이미 발급된 쿠폰이 즉시 꺼지지는 않습니다.** 처리 후 안내드립니다.',
    ja: 'ライセンスを利用停止にする依頼です。**発行済みのクーポンがすぐに無効になるわけではありません。** 処理後にご連絡します。',
    en: 'This asks us to mark the license as unusable. **A coupon that was already issued does not stop working right away.** We will confirm once it is handled.',
  },
  requestReason: { ko: '사유 (선택)', ja: '理由（任意）', en: 'Reason (optional)' },

  // ── 발급 이력 ──
  issuedBy:   { ko: '발급한 계정', ja: '発行アカウント', en: 'Issued by' },
  issuedMe:   { ko: '나', ja: '自分', en: 'You' },
  issuedOther:{ ko: '같은 회사의 다른 계정', ja: '同じ会社の別アカウント', en: 'Another account at your company' },
  issuedUs:   { ko: '담당자(우리)', ja: '担当者（当社）', en: 'Our team' },
  fromContract: { ko: '계약', ja: '契約', en: 'Contract' },
  notLinked:  {
    ko: '계약 전 발급 (연결 안 됨)',
    ja: '契約前の発行（未リンク）',
    en: 'Issued before contracts (not linked)',
  },
} as const satisfies Record<string, Msg>;

export type PortalMsgKey = keyof typeof PORTAL_MSG;

// ── 서버가 돌려주는 거절 코드 → 파트너 말 ──
//
// 서버(`partner-issue-license`)도 자기 문구를 보내지만, 포털은 **코드로** 받아
// 여기서 고른다. 서버 문구가 영어·한국어뿐이라 일본어가 빠지고,
// 화면 맥락(어느 계약인지)을 덧붙일 수 있기 때문이다.
export const ISSUE_BLOCK_MSG = {
  INSUFFICIENT_BALANCE: {
    ko: '보유 수량이 모자랍니다. 추가 구매를 요청해 주세요.',
    ja: '残り数量が足りません。追加購入をご依頼ください。',
    en: 'You do not have enough seat-months left. Please request an additional purchase.',
  },
  UNKNOWN_HISTORY: {
    ko: '수량을 확인할 수 없는 발급 기록이 있어 발급할 수 없습니다. 담당자가 확인한 뒤 안내드립니다.',
    ja: '数量を確認できない発行記録があるため発行できません。担当者の確認後にご案内します。',
    en: 'We cannot issue right now because some records have an unknown quantity. We will check and get back to you.',
  },
  CONTRACT_EXPIRED: {
    ko: '계약 기간이 끝났습니다. 담당자에게 문의해 주세요.',
    ja: '契約期間が終了しています。担当者にお問い合わせください。',
    en: 'This contract has ended. Please contact us.',
  },
  CONTRACT_NOT_ACTIVE: {
    ko: '유효한 계약이 아닙니다. 담당자에게 문의해 주세요.',
    ja: '有効な契約ではありません。担当者にお問い合わせください。',
    en: 'This contract is not active. Please contact us.',
  },
  CONTRACT_REQUIRED: {
    ko: '어느 계약에서 발급할지 선택해 주세요.',
    ja: 'どの契約から発行するか選択してください。',
    en: 'Please choose which contract to issue from.',
  },
  NO_CONTRACT: {
    ko: '계약을 찾을 수 없습니다. 담당자에게 문의해 주세요.',
    ja: '契約が見つかりません。担当者にお問い合わせください。',
    en: 'Contract not found. Please contact us.',
  },
  NOT_WHOLESALE: {
    ko: '이 계약에서는 수량 차감 발급을 쓰지 않습니다.',
    ja: 'この契約では数量差し引きの発行は行いません。',
    en: 'This contract does not use seat-month deduction.',
  },
  BAD_REQUEST: {
    ko: '인원과 개월 수를 확인해 주세요.',
    ja: '人数と月数をご確認ください。',
    en: 'Please check the number of users and months.',
  },
} as const satisfies Record<string, Msg>;

export type IssueBlockCode = keyof typeof ISSUE_BLOCK_MSG;

export function isIssueBlockCode(v: unknown): v is IssueBlockCode {
  return typeof v === 'string' && v in ISSUE_BLOCK_MSG;
}

/**
 * 서버 응답에서 파트너에게 보여 줄 글을 고른다.
 *
 * 아는 코드면 **여기 문구**(세 언어)를 쓰고, 모르는 코드면 서버가 준 글을 그대로 쓴다
 * (서버가 새 코드를 더해도 화면이 빈 말을 하지 않게).
 */
export function issueBlockMessage(
  code: unknown, serverMessage: unknown, t: (m: Msg) => string,
): string {
  if (isIssueBlockCode(code)) return t(ISSUE_BLOCK_MSG[code]);
  return typeof serverMessage === 'string' && serverMessage.trim() !== ''
    ? serverMessage
    : t({ ko: '발급하지 못했습니다.', ja: '発行できませんでした。', en: 'We could not issue the license.' });
}
