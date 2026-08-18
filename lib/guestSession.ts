const TOPIC_KEY = 'coinop.guestTopic';

export function saveGuestTopic(topic: string): void {
  const trimmed = topic.trim();
  if (!trimmed) return;
  try {
    sessionStorage.setItem(TOPIC_KEY, trimmed.slice(0, 100));
  } catch {
    // storage blocked — connect still works, the form just starts empty
  }
}

export function peekGuestTopic(): string | null {
  try {
    const v = sessionStorage.getItem(TOPIC_KEY);
    return v && v.trim() ? v : null;
  } catch {
    return null;
  }
}

/** Read and clear so a later visit to Educational does not revive a stale topic. */
export function takeGuestTopic(): string | null {
  const v = peekGuestTopic();
  try {
    sessionStorage.removeItem(TOPIC_KEY);
  } catch {
    /* ignore */
  }
  return v;
}
