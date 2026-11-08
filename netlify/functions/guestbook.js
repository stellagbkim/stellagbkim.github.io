// Netlify Function: 방명록 저장/조회
// 브라우저 → 이 함수 → Supabase 순서로 동작합니다.
// Supabase 접속 정보는 Netlify 환경변수로 주입합니다(코드에 비밀키를 넣지 않음).
//   SUPABASE_URL          : 프로젝트 URL (예: https://xxxx.supabase.co)
//   SUPABASE_SERVICE_KEY  : service_role(secret) 키 — 서버에서만 사용, 절대 프론트에 노출 금지

const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_SERVICE_KEY = process.env.SUPABASE_SERVICE_KEY;
const TABLE = "guestbook";

const JSON_HEADERS = { "Content-Type": "application/json" };

function sbHeaders() {
  return {
    "apikey": SUPABASE_SERVICE_KEY,
    "Authorization": "Bearer " + SUPABASE_SERVICE_KEY,
    "Content-Type": "application/json"
  };
}

exports.handler = async (event) => {
  // 환경변수 누락 시 명확히 실패
  if (!SUPABASE_URL || !SUPABASE_SERVICE_KEY) {
    return {
      statusCode: 500,
      headers: JSON_HEADERS,
      body: JSON.stringify({ error: "서버 환경변수(SUPABASE_URL / SUPABASE_SERVICE_KEY)가 설정되지 않았습니다." })
    };
  }

  try {
    // ===== 조회 (GET) =====
    if (event.httpMethod === "GET") {
      const res = await fetch(
        SUPABASE_URL + "/rest/v1/" + TABLE +
          "?select=id,name,message,created_at&order=created_at.desc&limit=50",
        { headers: sbHeaders() }
      );
      if (!res.ok) {
        const text = await res.text();
        return { statusCode: 502, headers: JSON_HEADERS, body: JSON.stringify({ error: "조회 실패", detail: text }) };
      }
      const rows = await res.json();
      return { statusCode: 200, headers: JSON_HEADERS, body: JSON.stringify(rows) };
    }

    // ===== 저장 (POST) =====
    if (event.httpMethod === "POST") {
      let payload;
      try {
        payload = JSON.parse(event.body || "{}");
      } catch (e) {
        return { statusCode: 400, headers: JSON_HEADERS, body: JSON.stringify({ error: "잘못된 요청 형식입니다." }) };
      }

      // 서버 측 입력 검증 (가이드: 허용된 값만 저장, 실패 시 거절)
      const name = typeof payload.name === "string" ? payload.name.trim() : "";
      const message = typeof payload.message === "string" ? payload.message.trim() : "";

      if (!name || !message) {
        return { statusCode: 400, headers: JSON_HEADERS, body: JSON.stringify({ error: "이름과 메시지를 모두 입력해 주세요." }) };
      }
      if (name.length > 40 || message.length > 500) {
        return { statusCode: 400, headers: JSON_HEADERS, body: JSON.stringify({ error: "입력 길이가 너무 깁니다." }) };
      }

      const res = await fetch(SUPABASE_URL + "/rest/v1/" + TABLE, {
        method: "POST",
        headers: Object.assign(sbHeaders(), { "Prefer": "return=representation" }),
        body: JSON.stringify({ name, message })
      });

      if (!res.ok) {
        const text = await res.text();
        return { statusCode: 502, headers: JSON_HEADERS, body: JSON.stringify({ error: "저장 실패", detail: text }) };
      }
      const rows = await res.json();
      return { statusCode: 201, headers: JSON_HEADERS, body: JSON.stringify(rows[0] || null) };
    }

    // 그 외 메서드
    return { statusCode: 405, headers: JSON_HEADERS, body: JSON.stringify({ error: "허용되지 않은 메서드입니다." }) };
  } catch (err) {
    return { statusCode: 500, headers: JSON_HEADERS, body: JSON.stringify({ error: "서버 오류", detail: String(err) }) };
  }
};
