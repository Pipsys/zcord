export const isStageChannelName = (name: string): boolean => {
  const normalized = name.trim().toLowerCase();
  if (normalized.length === 0) {
    return false;
  }

  return (
    normalized === "stage" ||
    normalized.startsWith("stage-") ||
    normalized.startsWith("stage_") ||
    normalized === "сцена" ||
    normalized.startsWith("сцена-") ||
    normalized.startsWith("сцена_")
  );
};
