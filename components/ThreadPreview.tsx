'use client';

import { useState } from 'react';
import { Card } from '@/components/ui/card';
import { Textarea } from '@/components/ui/textarea';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';

const MAX_TWEET_LEN = 270;

interface Props {
  tweets: string[];
  onChange: (tweets: string[]) => void;
}

export function ThreadPreview({ tweets, onChange }: Props) {
  const [editingIdx, setEditingIdx] = useState<number | null>(null);
  const [draft, setDraft] = useState('');

  function startEdit(i: number) {
    setEditingIdx(i);
    setDraft(tweets[i]);
  }

  function cancelEdit() {
    setEditingIdx(null);
    setDraft('');
  }

  function saveEdit() {
    if (editingIdx === null) return;
    const next = [...tweets];
    next[editingIdx] = draft.trim();
    onChange(next);
    setEditingIdx(null);
    setDraft('');
  }

  return (
    <div className="w-full max-w-md flex flex-col gap-2">
      {tweets.map((tw, i) => {
        const isEditing = editingIdx === i;
        const over = tw.length > MAX_TWEET_LEN;
        return (
          <Card key={i} className="p-3 flex flex-col gap-2">
            <div className="flex justify-between items-center">
              <Badge variant="outline" className="text-xs">
                {i + 1}/{tweets.length}
              </Badge>
              {!isEditing && (
                <button
                  onClick={() => startEdit(i)}
                  className="text-xs text-muted-foreground hover:text-primary"
                >
                  Edit
                </button>
              )}
            </div>
            {isEditing ? (
              <>
                <Textarea
                  value={draft}
                  onChange={(e) => setDraft(e.target.value)}
                  rows={4}
                  className="text-sm"
                />
                <div className="flex justify-between items-center">
                  <span
                    className={`text-xs font-mono ${draft.length > MAX_TWEET_LEN ? 'text-destructive' : 'text-muted-foreground'}`}
                  >
                    {draft.length}/{MAX_TWEET_LEN}
                  </span>
                  <div className="flex gap-2">
                    <Button size="sm" variant="ghost" onClick={cancelEdit}>
                      Cancel
                    </Button>
                    <Button size="sm" onClick={saveEdit}>
                      Save
                    </Button>
                  </div>
                </div>
              </>
            ) : (
              <p className="text-sm whitespace-pre-wrap">{tw}</p>
            )}
            {!isEditing && over && (
              <p className="text-xs text-destructive">
                {tw.length}/{MAX_TWEET_LEN} — X will split this tweet when posted.
              </p>
            )}
          </Card>
        );
      })}
    </div>
  );
}
