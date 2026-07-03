'use client';

import { useEffect, useState } from 'react';
import { Card } from '@/components/ui/card';

export interface UrlPreview {
  kind: 'tweet' | 'news' | 'unknown';
  host?: string;
  title?: string;
  description?: string;
  image?: string | null;
  tweetId?: string | null;
  error?: string;
}

interface Props {
  url: string;
  onResolved?: (preview: UrlPreview) => void;
}

export function UrlPreviewCard({ url, onResolved }: Props) {
  const [preview, setPreview] = useState<UrlPreview | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setPreview(null);

    fetch('/api/url-preview', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ url }),
    })
      .then(async (r) => (await r.json()) as UrlPreview)
      .then((j) => {
        if (cancelled) return;
        setPreview(j);
        onResolved?.(j);
      })
      .catch(() => {
        if (cancelled) return;
        setPreview({ kind: 'unknown', error: 'fetch failed' });
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });

    return () => {
      cancelled = true;
    };
  }, [url, onResolved]);

  if (loading) return <p className="text-xs text-muted-foreground">Loading preview…</p>;
  if (!preview || preview.error) {
    return (
      <p className="text-xs font-sans text-muted-foreground">
        Could not preview URL — thread will run on the URL text only.
      </p>
    );
  }

  return (
    <Card className="p-3 flex gap-3 items-start">
      {preview.image && (
        // eslint-disable-next-line @next/next/no-img-element
        <img src={preview.image} alt="" className="w-16 h-16 rounded object-cover flex-shrink-0" />
      )}
      <div className="flex flex-col gap-1 flex-1 min-w-0">
        <p className="text-xs text-muted-foreground">{preview.host}</p>
        <p className="text-sm font-sans font-medium truncate">{preview.title || '(no title)'}</p>
        {preview.description && (
          <p className="text-xs font-sans text-muted-foreground line-clamp-2">{preview.description}</p>
        )}
      </div>
    </Card>
  );
}
