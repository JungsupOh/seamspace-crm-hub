// 발급 폼의 **계약 선택 규칙** (LEAD-S7-4) — 순수 로직
//
// 서버(`partner-issue-license`)의 규칙과 같아야 한다:
//   활성 도매형 계약이 0개면 기존 동작, 1개면 그것, 2개 이상이면 **고르게 한다**.
// 화면은 **편의**로 미리 막고, 최종 판단은 서버(예약 RPC)다.

import { isLiveContract, toSettlementMethod, type Contract } from '@/lib/partnerContract';

export interface ChoosableContract extends Contract {
  id: string;
  ends_on?: string | null;
}

/** 발급에 쓸 수 있는 계약: 살아 있고, 도매형이고, `active` 이고, 기간이 안 끝난 것. */
export function issuableContracts<T extends ChoosableContract>(
  contracts: readonly T[], today: string,
): T[] {
  return contracts.filter(c =>
    isLiveContract(c)
    && toSettlementMethod(c.settlement_method) === 'wholesale'
    && c.status === 'active'
    && !(c.ends_on && c.ends_on < today));
}

export type ContractChoiceMode = 'none' | 'fixed' | 'pick';

export interface ContractChoice {
  mode: ContractChoiceMode;
  /** 보낼 값. `none` 이면 null(기존 동작) */
  contractId: string | null;
  /** 고르게 해야 하는가 */
  needsPick: boolean;
  options: ChoosableContract[];
}

/**
 * 지금 무엇을 보여 주고 무엇을 보낼지.
 *
 * `pick` 인데 아직 안 골랐으면 `contractId` 는 null 이고 `needsPick` 이 참이다 →
 * 화면이 "계약을 선택해 주세요"를 보여 주고 발급 버튼을 막는다.
 */
export function contractChoice(
  contracts: readonly ChoosableContract[], selected: string | null, today: string,
): ContractChoice {
  const options = issuableContracts(contracts, today);
  if (options.length === 0) {
    return { mode: 'none', contractId: null, needsPick: false, options: [] };
  }
  if (options.length === 1) {
    // 보여 주되 바꿀 수 없다 — 어디서 빠지는지는 알려 줘야 한다.
    return { mode: 'fixed', contractId: options[0].id, needsPick: false, options };
  }
  const ok = selected !== null && options.some(c => c.id === selected);
  return { mode: 'pick', contractId: ok ? selected : null, needsPick: !ok, options };
}

/** 고른 계약의 짧은 이름 — 번호가 없으므로 기간과 id 앞자리로 가리킨다. */
export function contractLabel(c: ChoosableContract): string {
  return `${c.starts_on ?? '?'} ~ ${c.ends_on ?? '…'} · ${c.id.slice(0, 8)}`;
}
