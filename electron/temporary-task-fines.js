const TARGET_TASK_TITLE = "tach kien 5d unicare";

function isTemporarilyUnfinedTask(value) {
  const title = String(value || "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLocaleLowerCase("vi-VN")
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
  return title.includes(TARGET_TASK_TITLE);
}

function selectTemporarilyUnfinedPenaltyKeys(rows, taskIds) {
  return rows.flatMap((row) => {
    try {
      const fine = JSON.parse(row.value);
      return isTemporarilyUnfinedTask(`${fine?.taskTitle || ""} ${fine?.detail || ""}`)
        || taskIds.has(Number(fine?.taskId)) ? [row.key] : [];
    } catch {
      return [];
    }
  });
}

module.exports = { isTemporarilyUnfinedTask, selectTemporarilyUnfinedPenaltyKeys };
