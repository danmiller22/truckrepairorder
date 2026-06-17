export const sessions = new Map();

export function getSession(userId: number) {
  if (!sessions.has(userId)) {
    sessions.set(userId, {
      step: "lang",
      data: { photos: [] },
      lang: "en"
    });
  }
  return sessions.get(userId);
}
