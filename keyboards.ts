export function langKeyboard() {
  return {
    inline_keyboard: [
      [{ text: "Русский", callback_data: "lang_ru" }],
      [{ text: "English", callback_data: "lang_en" }]
    ]
  };
}

export function confirmKeyboard(lang: string) {
  const yes = lang === "ru" ? "Подтвердить" : "Confirm";
  const edit = lang === "ru" ? "Изменить" : "Edit";
  const cancel = lang === "ru" ? "Отменить" : "Cancel";
  return {
    inline_keyboard: [
      [{ text: yes, callback_data: "confirm" }],
      [{ text: edit, callback_data: "edit" }],
      [{ text: cancel, callback_data: "cancel" }]
    ]
  };
}

export function newReportKeyboard(lang: string) {
  const text = lang === "ru" ? "Создать новый репорт" : "Create new report";
  return {
    inline_keyboard: [
      [{ text, callback_data: "new" }]
    ]
  };
}
