const TOKEN = Deno.env.get("BOT_TOKEN")!;
const GROUP = Deno.env.get("GROUP_CHAT_ID")!;

// ===== STATE =====
const sessions = new Map<number, any>();

function getSession(id: number) {
  if (!sessions.has(id)) {
    sessions.set(id, {
      step: 1,
      data: {
        name: "",
        truck: "",
        issue: "",
        drop: "",
        media: []
      }
    });
  }
  return sessions.get(id);
}

function saveSession(id: number, s: any) {
  sessions.set(id, structuredClone(s));
}

// ===== SEND =====
async function send(chat: string, text: string, keyboard?: any) {
  await fetch(`https://api.telegram.org/bot${TOKEN}/sendMessage`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      chat_id: chat,
      text,
      reply_markup: keyboard
    })
  });
}

async function sendMedia(items: any[]) {
  if (!items.length) return;

  await fetch(`https://api.telegram.org/bot${TOKEN}/sendMediaGroup`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      chat_id: GROUP,
      media: items.map((m, i) => ({
        type: m.type,
        media: m.file_id,
        caption: i === 0 ? "📎 Поломки" : undefined
      }))
    })
  });
}

// ===== CARD =====
function card(s: any) {
  return `🚛 Новый репорт

имя - ${s.data.name || "—"}
трак - ${s.data.truck || "—"}
поломка - ${s.data.issue || "—"}

файлы - ${s.data.media.length}

когда оставляет трак - ${s.data.drop || "—"}`;
}

// ===== SERVER =====
Deno.serve(async (req) => {
  const u = await req.json();
  const msg = u.message;
  const cb = u.callback_query;

  // ================= CALLBACK =================
  if (cb) {
    const s = getSession(cb.from.id);

    if (cb.data === "confirm") {
      await send(GROUP, card(s));
      await sendMedia(s.data.media);

      s.step = 1;
      s.data = { name: "", truck: "", issue: "", drop: "", media: [] };

      await send(cb.message.chat.id, "Заявка отправлена", {
        inline_keyboard: [[
          { text: "Создать новый репорт", callback_data: "new" }
        ]]
      });

      return new Response("ok");
    }

    if (cb.data === "new") {
      const s2 = getSession(cb.from.id);
      s2.step = 1;
      s2.data = { name: "", truck: "", issue: "", drop: "", media: [] };

      await send(cb.message.chat.id, "Введите имя и фамилию");
      return new Response("ok");
    }
  }

  if (!msg) return new Response("ok");

  // ❗ игнор групп
  if (msg.chat.type !== "private") return new Response("ok");

  const s = getSession(msg.from.id);
  const text = msg.text?.trim() || "";

  // ================= FLOW =================
  if (text === "/start") {
    s.step = 1;
    saveSession(msg.from.id, s);
    await send(msg.chat.id, "Введите имя и фамилию");
    return new Response("ok");
  }

  if (s.step === 1) {
    s.data.name = text;
    s.step = 2;
    saveSession(msg.from.id, s);
    await send(msg.chat.id, "Введите номер трака");
    return new Response("ok");
  }

  if (s.step === 2) {
    s.data.truck = text;
    s.step = 3;
    saveSession(msg.from.id, s);
    await send(msg.chat.id, "Опишите поломки");
    return new Response("ok");
  }

  if (s.step === 3) {
    s.data.issue = text;
    s.step = 4;
    saveSession(msg.from.id, s);
    await send(msg.chat.id, "Когда оставляет трак?");
    return new Response("ok");
  }

  if (s.step === 4) {
    s.data.drop = text;
    s.step = 5;
    saveSession(msg.from.id, s);
    await send(msg.chat.id, "Отправьте фото или видео поломки");
    return new Response("ok");
  }

  // ================= MEDIA =================
  if (s.step === 5) {
    if (!msg.photo && !msg.video) return new Response("ok");

    const item = msg.photo
      ? { type: "photo", file_id: msg.photo.at(-1).file_id }
      : { type: "video", file_id: msg.video.file_id };

    s.data.media.push(item);
    saveSession(msg.from.id, s);

    // ❗ ВАЖНО: карточка только 1 раз, после первого медиа
    if (s.data.media.length === 1) {
      await send(msg.chat.id, card(s), {
        inline_keyboard: [[
          { text: "Подтвердить", callback_data: "confirm" }
        ]]
      });
    }

    return new Response("ok");
  }

  return new Response("ok");
});
