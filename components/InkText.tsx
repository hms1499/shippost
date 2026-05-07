'use client';

import * as React from 'react';

interface InkTextProps {
  children: string;
  className?: string;
  /** Per-letter stagger delay in milliseconds. Default 35. */
  delay?: number;
  /** Offset before the first letter starts, in milliseconds. */
  startDelay?: number;
  /** HTML tag to render. Default span. */
  as?: 'span' | 'h1' | 'h2' | 'h3' | 'h4' | 'p' | 'div';
}

/**
 * Letter-by-letter ink-reveal: each glyph fades in from a slight downward
 * offset and a 2px blur, mimicking ink being absorbed into parchment as a
 * quill writes across the page. The whole text is announced once via
 * aria-label so assistive tech reads the word, not the per-letter spans.
 */
export function InkText({
  children,
  className,
  delay = 35,
  startDelay = 0,
  as = 'span',
}: InkTextProps) {
  const Tag = as as React.ElementType;
  const chars = Array.from(children);
  return (
    <Tag className={className} aria-label={children}>
      {chars.map((c, i) => (
        <span
          key={i}
          aria-hidden
          className="inline-block"
          style={{
            animation: `ink-reveal 600ms cubic-bezier(.4,.1,.2,1) ${
              startDelay + i * delay
            }ms both`,
          }}
        >
          {c === ' ' ? ' ' : c}
        </span>
      ))}
    </Tag>
  );
}
