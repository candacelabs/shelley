export function shiftLocalDay(day: Date, offset: number): Date {
  return new Date(day.getFullYear(), day.getMonth(), day.getDate() + offset);
}

export function filterConversationsByDay<T extends { updated_at: string }>(
  conversations: T[],
  day: Date | null,
): T[] {
  if (!day) return conversations;
  const start = shiftLocalDay(day, 0).getTime();
  const end = shiftLocalDay(day, 1).getTime();
  return conversations.filter((conversation) => {
    const touched = Date.parse(conversation.updated_at);
    return touched >= start && touched < end;
  });
}
