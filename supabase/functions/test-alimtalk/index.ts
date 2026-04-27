// 알림톡 테스트 발송 — Aligo API 직접 호출
const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type, Authorization",
};

const ALIGO = {
  apikey: Deno.env.get("ALIGO_API_KEY")!,
  userid: Deno.env.get("ALIGO_USER_ID")!,
  senderkey: Deno.env.get("ALIGO_SENDER_KEY")!,
  sender: Deno.env.get("ALIGO_SENDER")!,
};

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: CORS });

  try {
    const body = await req.json().catch(() => ({}));
    const phone = body.phone ?? "01051578698";

    // Step 0: Edge Function IP 확인
    const ipRes = await fetch("https://api.ipify.org?format=json");
    const myIp = (await ipRes.json()).ip;

    // Step 1: 토큰 발급
    const tokenForm = new FormData();
    tokenForm.append("apikey", ALIGO.apikey);
    tokenForm.append("userid", ALIGO.userid);

    const tokenRes = await fetch("https://kakaoapi.aligo.in/akv10/token/create/30/s/", {
      method: "POST",
      body: tokenForm,
    });
    const tokenData = await tokenRes.json();
    if (tokenData.code !== 0) {
      return json({ step: "token", edge_ip: myIp, error: tokenData });
    }
    const token = tokenData.token;

    // Step 2: 만기 알림 (UD_5369) 테스트 발송
    const message = `안녕하세요, 테스트 선생님!  ❤️❤️
선생님의 심스페이스 이용권의 사용기간이 곧 만료됩니다.
이용권 연장을 원하시면 이 채팅방에 메시지를 남겨 주세요.

⭐현재 이용권 정보⭐
그룹이름: 테스트학교 3학년1반
인원: 40 명
기간: 1 개월
만료일: 2026-04-30

이용 중 문의사항은 카카오채널의 상담을 이용해 주시길 부탁드립니다. 💬

감사합니다.`;

    const sendForm = new FormData();
    sendForm.append("apikey", ALIGO.apikey);
    sendForm.append("userid", ALIGO.userid);
    sendForm.append("token", token);
    sendForm.append("senderkey", ALIGO.senderkey);
    sendForm.append("tpl_code", "UD_5369");
    sendForm.append("sender", ALIGO.sender);
    sendForm.append("receiver_1", phone.replace(/\D/g, ""));
    sendForm.append("recvname_1", "테스트");
    sendForm.append("subject_1", "심스페이스 만기 알림");
    sendForm.append("message_1", message);

    const sendRes = await fetch("https://kakaoapi.aligo.in/akv10/alimtalk/send/", {
      method: "POST",
      body: sendForm,
    });
    const sendData = await sendRes.json();

    return json({
      step: "send",
      token_ok: true,
      send_result: sendData,
      sent_to: phone,
    });
  } catch (e) {
    return json({ error: String(e) });
  }
});

function json(data: unknown) {
  return new Response(JSON.stringify(data, null, 2), {
    headers: { "Content-Type": "application/json", ...CORS },
  });
}
