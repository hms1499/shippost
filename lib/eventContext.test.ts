import { describe, it, expect } from 'vitest';
import { composeEvent } from './eventContext';

describe('composeEvent', () => {
  it('builds event + query from title, description and host', () => {
    const r = composeEvent('https://example.com/a', {
      title: 'BTC ETF inflows hit record',
      description: 'Spot funds pulled $1.1B last week.',
      host: 'example.com',
    });
    expect(r.event).toBe(
      'BTC ETF inflows hit record — Spot funds pulled $1.1B last week. (source: example.com)',
    );
    expect(r.query).toBe('BTC ETF inflows hit record');
  });

  it('uses title alone when description/host are absent', () => {
    const r = composeEvent('https://x/y', { title: 'Solana outage' });
    expect(r.event).toBe('Solana outage');
    expect(r.query).toBe('Solana outage');
  });

  it('includes host without description', () => {
    const r = composeEvent('https://x/y', { title: 'Solana outage', host: 'theblock.co' });
    expect(r.event).toBe('Solana outage (source: theblock.co)');
    expect(r.query).toBe('Solana outage');
  });

  it('falls back to the raw event text when no context', () => {
    expect(composeEvent('token X depegged')).toEqual({
      event: 'token X depegged',
      query: 'token X depegged',
    });
    expect(composeEvent('token X depegged', null)).toEqual({
      event: 'token X depegged',
      query: 'token X depegged',
    });
  });

  it('treats a whitespace-only or missing title as no usable context', () => {
    const ws = composeEvent('https://x/y', { title: '   ', description: 'desc' });
    expect(ws).toEqual({ event: 'https://x/y', query: 'https://x/y' });
    const none = composeEvent('https://x/y', { description: 'desc only', host: 'h' });
    expect(none).toEqual({ event: 'https://x/y', query: 'https://x/y' });
  });

  it('trims stray whitespace in title/description', () => {
    const r = composeEvent('u', { title: '  Headline  ', description: '  body  ' });
    expect(r.event).toBe('Headline — body');
    expect(r.query).toBe('Headline');
  });
});
