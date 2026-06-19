const TOKEN = requireEnv("BOT_TOKEN");
const GROUP = requireEnv("GROUP_CHAT_ID");

// ===== STATE =====
const sessions = new Map<number, Session>();

type MediaItem = {
  type: "photo" | "video";
  file_id: string;
};

type Session = {
  step: number;
  data: {
    name: string;
    truck: string;
    issue: string;
    drop: string;
    media: MediaItem[];
  };
};

function requireEnv(name: string) {
  const value = Deno.env.get(name);
  if (!value) {
    throw new Error(`Missing required environment variable: ${name}`);
  }
  return value;
}

function emptyData(): Session["data"] {
  return { name: "", truck: "", issue: "", drop: "", media: [] };
}

function getSession(id: number) {
  if (!sessions.has(id)) {
    sessions.set(id, {
      step: 1,
      data: emptyData(),
    });
  }
  return sessions.get(id)!;
}

function saveSession(id: number, s: Session) {
  sessions.set(id, structuredClone(s));
}

// ===== TELEGRAM API =====
async function telegram(method: string, payload: Record<string, unknown>) {
  const response = await fetch(`https://api.telegram.org/bot${TOKEN}/${method}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  });

  if (!response.ok) {
    const details = await response.text();
    throw new Error(`Telegram ${method} failed: ${response.status} ${details}`);
  }
}

async function send(chat: number | string, text: string, keyboard?: Record<string, unknown>) {
  await telegram("sendMessage", {
    chat_id: chat,
    text,
    reply_markup: keyboard,
  });
}

async function answerCallback(id: string) {
  await telegram("answerCallbackQuery", { callback_query_id: id });
}

async function sendMedia(items: MediaItem[]) {
  if (!items.length) return;

  await telegram("sendMediaGroup", {
    chat_id: GROUP,
    media: items.map((m, i) => ({
      type: m.type,
      media: m.file_id,
      caption: i === 0 ? "📎 Поломки" : undefined,
    })),
  });
}

// ===== CARD =====
function card(s: Session) {
  return `🚛 Новый репорт

имя - ${s.data.name || "—"}
трак - ${s.data.truck || "—"}
поломка - ${s.data.issue || "—"}

файлы - ${s.data.media.length}

когда оставляет трак - ${s.data.drop || "—"}`;
}

function confirmKeyboard() {
  return {
    inline_keyboard: [[
      { text: "Подтвердить", callback_data: "confirm" },
    ]],
  };
}

function mediaKeyboard() {
  return {
    inline_keyboard: [[
      { text: "Пропустить", callback_data: "skip_media" },
    ]],
  };
}

async function showConfirmation(chatId: number | string, s: Session) {
  await send(chatId, card(s), confirmKeyboard());
}

// ===== SERVER =====
Deno.serve(async (req) => {
  if (req.method === "GET") {
    return new Response("Truck repair bot is running");
  }

  if (req.method !== "POST") {
    return new Response("Method not allowed", { status: 405 });
  }

  let update: any;
  try {
    update = await req.json();
  } catch (error) {
    console.error("Invalid Telegram update", error);
    return new Response("bad request", { status: 400 });
  }

  try {
    const msg = update.message;
    const cb = update.callback_query;

    // ================= CALLBACK =================
    if (cb) {
      await answerCallback(cb.id);
      const s = getSession(cb.from.id);

      if (cb.data === "confirm") {
        await send(GROUP, card(s));
        await sendMedia(s.data.media);

        s.step = 1;
        s.data = emptyData();
        saveSession(cb.from.id, s);

        await send(cb.message.chat.id, "Заявка отправлена", {
          inline_keyboard: [[
            { text: "Создать новый репорт", callback_data: "new" },
          ]],
        });

        return new Response("ok");
      }

      if (cb.data === "skip_media") {
        s.step = 6;
        saveSession(cb.from.id, s);
        await showConfirmation(cb.message.chat.id, s);
        return new Response("ok");
      }

      if (cb.data === "new") {
        s.step = 1;
        s.data = emptyData();
        saveSession(cb.from.id, s);

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
      s.data = emptyData();
      saveSession(msg.from.id, s);
      await send(msg.chat.id, "Введите имя и фамилию");
      return new Response("ok");
    }

    if (s.step === 1) {
      if (!text) {
        await send(msg.chat.id, "Введите имя и фамилию текстом");
        return new Response("ok");
      }

      s.data.name = text;
      s.step = 2;
      saveSession(msg.from.id, s);
      await send(msg.chat.id, "Введите номер трака");
      return new Response("ok");
    }

    if (s.step === 2) {
      if (!text) {
        await send(msg.chat.id, "Введите номер трака текстом");
        return new Response("ok");
      }

      s.data.truck = text;
      s.step = 3;
      saveSession(msg.from.id, s);
      await send(msg.chat.id, "Опишите поломки");
      return new Response("ok");
    }

    if (s.step === 3) {
      if (!text) {
        await send(msg.chat.id, "Опишите поломки текстом");
        return new Response("ok");
      }

      s.data.issue = text;
      s.step = 4;
      saveSession(msg.from.id, s);
      await send(msg.chat.id, "Когда оставляет трак?");
      return new Response("ok");
    }

    if (s.step === 4) {
      if (!text) {
        await send(msg.chat.id, "Напишите, когда оставляет трак");
        return new Response("ok");
      }

      s.data.drop = text;
      s.step = 5;
      saveSession(msg.from.id, s);
      await send(msg.chat.id, "Отправьте фото или видео поломки", mediaKeyboard());
      return new Response("ok");
    }

    // ================= MEDIA =================
    if (s.step === 5) {
      if (!msg.photo && !msg.video) {
        await send(msg.chat.id, "Жду фото или видео. Если файлов нет, нажмите Пропустить.", mediaKeyboard());
        return new Response("ok");
      }

      const item: MediaItem = msg.photo
        ? { type: "photo", file_id: msg.photo.at(-1).file_id }
        : { type: "video", file_id: msg.video.file_id };

      s.data.media.push(item);
      saveSession(msg.from.id, s);

      // ❗ ВАЖНО: карточка только 1 раз, после первого медиа
      if (s.data.media.length === 1) {
        await showConfirmation(msg.chat.id, s);
      }

      return new Response("ok");
    }

    await send(msg.chat.id, "Нажмите /start, чтобы создать новый репорт");
    return new Response("ok");
  } catch (error) {
    console.error("Update handling failed", error);
    return new Response("error", { status: 500 });
  }
});
