// ===== STATE =====
const sessions = new Map<number, Session>();
let kvStorePromise: Promise<any | null> | undefined;

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

function env(name: string) {
  return Deno.env.get(name)?.trim() || "";
}

function requireEnv(name: string) {
  const value = env(name);
  if (!value) {
    throw new Error(`Missing required environment variable: ${name}`);
  }
  return value;
}

function healthResponse() {
  const botTokenSet = Boolean(env("BOT_TOKEN"));
  const groupChatIdSet = Boolean(env("GROUP_CHAT_ID"));

  return Response.json({
    service: "truckrepairorder",
    ok: botTokenSet && groupChatIdSet,
    botTokenSet,
    groupChatIdSet,
  });
}

async function storageInfoResponse() {
  const store = await sessionStore();

  return Response.json({
    ok: Boolean(store),
    storage: store ? "deno_kv" : "memory",
  });
}

async function webhookInfoResponse() {
  const info = await telegram("getWebhookInfo", {});
  return Response.json({ ok: true, info });
}

async function setupWebhookResponse(req: Request) {
  const webhookUrl = new URL("/", req.url).toString();
  const result = await telegram("setWebhook", { url: webhookUrl });
  const info = await telegram("getWebhookInfo", {});

  return Response.json({
    ok: true,
    webhookUrl,
    result,
    info,
  });
}

function emptyData(): Session["data"] {
  return { name: "", truck: "", issue: "", drop: "", media: [] };
}

async function sessionStore() {
  if (!kvStorePromise) {
    kvStorePromise = Deno.openKv().catch((error) => {
      console.error("Deno KV unavailable; using in-memory sessions only", error);
      return null;
    });
  }

  return await kvStorePromise;
}

function newSession(): Session {
  return {
    step: 1,
    data: emptyData(),
  };
}

async function getSession(id: number) {
  const store = await sessionStore();

  if (store) {
    const result = await store.get<Session>(["sessions", id]);
    if (result.value) {
      const saved = structuredClone(result.value);
      sessions.set(id, saved);
      return structuredClone(saved);
    }
  }

  const session = sessions.get(id) || newSession();
  sessions.set(id, structuredClone(session));
  return structuredClone(session);
}

async function saveSession(id: number, s: Session) {
  const session = structuredClone(s);
  sessions.set(id, session);

  const store = await sessionStore();
  if (store) {
    await store.set(["sessions", id], session);
  }
}

// ===== TELEGRAM API =====
async function telegram(method: string, payload: Record<string, unknown>) {
  const token = requireEnv("BOT_TOKEN");
  const response = await fetch(`https://api.telegram.org/bot${token}/${method}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  });

  const details = await response.text();
  let data: unknown = details;

  try {
    data = JSON.parse(details);
  } catch {
    // Telegram normally returns JSON, but keep the raw body for unusual failures.
  }

  if (!response.ok) {
    throw new Error(`Telegram ${method} failed: ${response.status} ${details}`);
  }

  return data;
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

async function sendSingleMedia(item: MediaItem) {
  const group = requireEnv("GROUP_CHAT_ID");

  if (item.type === "photo") {
    await telegram("sendPhoto", {
      chat_id: group,
      photo: item.file_id,
      caption: "📎 Damage",
    });
    return;
  }

  await telegram("sendVideo", {
    chat_id: group,
    video: item.file_id,
    caption: "📎 Damage",
  });
}

async function sendMedia(items: MediaItem[]) {
  if (!items.length) return;

  if (items.length === 1) {
    await sendSingleMedia(items[0]);
    return;
  }

  const groupChatId = requireEnv("GROUP_CHAT_ID");

  for (let i = 0; i < items.length; i += 10) {
    const group = items.slice(i, i + 10);

    if (group.length === 1) {
      await sendSingleMedia(group[0]);
      continue;
    }

    await telegram("sendMediaGroup", {
      chat_id: groupChatId,
      media: group.map((m, index) => ({
        type: m.type,
        media: m.file_id,
        caption: i === 0 && index === 0 ? "📎 Damage" : undefined,
      })),
    });
  }
}

// ===== CARD =====
function card(s: Session) {
  return `🚛 New report

name - ${s.data.name || "—"}
truck - ${s.data.truck || "—"}
issue - ${s.data.issue || "—"}

files - ${s.data.media.length}

drop-off time - ${s.data.drop || "—"}`;
}

function confirmKeyboard() {
  return {
    inline_keyboard: [[
      { text: "Confirm", callback_data: "confirm" },
    ]],
  };
}

async function showConfirmation(chatId: number | string, s: Session) {
  await send(chatId, card(s), confirmKeyboard());
}

// ===== SERVER =====
Deno.serve(async (req) => {
  const url = new URL(req.url);

  if (req.method === "GET") {
    try {
      if (url.pathname === "/storage-info") {
        return await storageInfoResponse();
      }

      if (url.pathname === "/webhook-info") {
        return await webhookInfoResponse();
      }

      if (url.pathname === "/setup-webhook") {
        return await setupWebhookResponse(req);
      }

      return healthResponse();
    } catch (error) {
      console.error("Health/setup request failed", error);
      return Response.json({ ok: false, error: String(error) }, { status: 500 });
    }
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
      const s = await getSession(cb.from.id);

      if (cb.data === "confirm") {
        const group = requireEnv("GROUP_CHAT_ID");
        await send(group, card(s));
        await sendMedia(s.data.media);

        s.step = 1;
        s.data = emptyData();
        await saveSession(cb.from.id, s);

        await send(cb.message.chat.id, "Request submitted", {
          inline_keyboard: [[
            { text: "Create a new report", callback_data: "new" },
          ]],
        });

        return new Response("ok");
      }

      if (cb.data === "new") {
        s.step = 1;
        s.data = emptyData();
        await saveSession(cb.from.id, s);

        await send(cb.message.chat.id, "Enter your first and last name");
        return new Response("ok");
      }
    }

    if (!msg) return new Response("ok");

    // Ignore group chats
    if (msg.chat.type !== "private") return new Response("ok");

    const s = await getSession(msg.from.id);
    const text = msg.text?.trim() || "";

    // ================= FLOW =================
    if (text === "/start") {
      s.step = 1;
      s.data = emptyData();
      await saveSession(msg.from.id, s);
      await send(msg.chat.id, "Enter your first and last name");
      return new Response("ok");
    }

    if (s.step === 1) {
      if (!text) {
        await send(msg.chat.id, "Enter your first and last name as text");
        return new Response("ok");
      }

      s.data.name = text;
      s.step = 2;
      await saveSession(msg.from.id, s);
      await send(msg.chat.id, "Enter the truck number");
      return new Response("ok");
    }

    if (s.step === 2) {
      if (!text) {
        await send(msg.chat.id, "Enter the truck number as text");
        return new Response("ok");
      }

      s.data.truck = text;
      s.step = 3;
      await saveSession(msg.from.id, s);
      await send(msg.chat.id, "Describe the issue");
      return new Response("ok");
    }

    if (s.step === 3) {
      if (!text) {
        await send(msg.chat.id, "Describe the issue as text");
        return new Response("ok");
      }

      s.data.issue = text;
      s.step = 4;
      await saveSession(msg.from.id, s);
      await send(msg.chat.id, "When will you drop off the truck?");
      return new Response("ok");
    }

    if (s.step === 4) {
      if (!text) {
        await send(msg.chat.id, "Please write when you will drop off the truck");
        return new Response("ok");
      }

      s.data.drop = text;
      s.step = 5;
      await saveSession(msg.from.id, s);
      await send(msg.chat.id, "Send a photo or video of the issue");
      return new Response("ok");
    }

    // ================= MEDIA =================
    if (s.step === 5) {
      if (!msg.photo && !msg.video) {
        await send(msg.chat.id, "Please send a photo or video of the issue.");
        return new Response("ok");
      }

      const item: MediaItem = msg.photo
        ? { type: "photo", file_id: msg.photo.at(-1).file_id }
        : { type: "video", file_id: msg.video.file_id };

      s.data.media.push(item);
      await saveSession(msg.from.id, s);

      // Show confirmation only once, after the first media attachment
      if (s.data.media.length === 1) {
        await showConfirmation(msg.chat.id, s);
      }

      return new Response("ok");
    }

    await send(msg.chat.id, "Tap /start to create a new report");
    return new Response("ok");
  } catch (error) {
    console.error("Update handling failed", error);
    return new Response("error", { status: 500 });
  }
});
