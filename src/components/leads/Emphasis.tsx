// `**굵게**` 만 렌더링하는 작은 컴포넌트 — LEAD-S4 (b)
//
// 왜 필요한가
//   `outreach_facts.caveat` 에는 James·제시카가 적은 `**재고와 배송은 미정**` 같은
//   강조가 들어 있다. 그대로 뿌리면 **별표가 글자로 보인다**.
//
// ⚠️ **저장값은 건드리지 않는다**(요구 S4-4 b). 보여 줄 때만 굵게 만든다.
//    그래야 메일 문구로 복사할 때 원본이 그대로 나가고, 나중에 다른 방식으로
//    렌더링하기로 해도 데이터를 다시 고칠 일이 없다.
//
// 마크다운 전체를 쓰지 않는 이유: 주의 문구에 쓰이는 것은 굵게뿐이고,
// 마크다운 렌더러를 넣으면 링크·HTML 까지 해석돼 **입력이 화면을 바꿀 수 있다**.

import { Fragment } from 'react';

/** `**…**` 를 굵게, 나머지는 글자 그대로. 짝이 안 맞는 별표는 글자로 남긴다. */
export function Emphasis({ text }: { text: unknown }) {
  if (typeof text !== 'string' || !text) return null;
  // 짝이 맞는 `**…**` 만 가른다. `**` 가 하나만 있으면 아래 split 에서 홀수 조각이
  // 되지 않으므로 그대로 글자로 나온다.
  const parts = text.split(/\*\*([^*]+)\*\*/g);
  return (
    <>
      {parts.map((p, i) => (
        <Fragment key={i}>
          {i % 2 === 1 ? <strong>{p}</strong> : p}
        </Fragment>
      ))}
    </>
  );
}

/** 굵게 표시를 **떼어** 평문으로. 툴팁의 `title` 속성처럼 HTML 을 쓸 수 없는 자리용. */
export function stripEmphasis(text: unknown): string {
  return typeof text === 'string' ? text.replace(/\*\*([^*]+)\*\*/g, '$1') : '';
}
