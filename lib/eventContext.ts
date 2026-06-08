// Shared shape + composition for grounding a Hot Take in a pasted URL. The
// client fetches Open Graph metadata for display (UrlPreviewCard → /api/url-
// preview); we forward that same {title, description, host} so the agent writes
// from the article's substance instead of the raw URL string. Pure + tested.

export interface EventContext {
  title?: string;
  description?: string;
  host?: string;
  kind?: string;
}

export interface ComposedEvent {
  /** Text handed to the LLM (and CoinGecko) as the event being reacted to. */
  event: string;
  /** Seed for the Serper search — the headline reads far better than a URL. */
  query: string;
}

/**
 * Ground the event text in URL metadata when a usable title is present;
 * otherwise fall back to the raw text the user typed/pasted (today's behaviour).
 * The title is the anchor — context without a title is ignored.
 */
export function composeEvent(eventDescription: string, ctx?: EventContext | null): ComposedEvent {
  const title = ctx?.title?.trim();
  if (!title) {
    return { event: eventDescription, query: eventDescription };
  }
  const description = ctx?.description?.trim();
  const host = ctx?.host?.trim();
  let event = title;
  if (description) event += ` — ${description}`;
  if (host) event += ` (source: ${host})`;
  return { event, query: title };
}
