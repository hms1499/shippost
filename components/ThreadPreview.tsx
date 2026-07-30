'use client';

import { useState, useMemo } from 'react';
import { Pencil, X as XIcon, ChevronUp, ChevronDown, Trash2 } from 'lucide-react';
import { Card } from '@/components/ui/card';
import { Textarea } from '@/components/ui/textarea';
import { Button } from '@/components/ui/button';
import { CopyNib } from '@/components/CopyNib';
import { RuleDivider } from '@/components/terminal/RuleDivider';
import { moveTweet, deleteTweet } from '@/lib/threadEdits';
import { detectBannedPhrases } from '@/lib/bannedPhrases';

function pad2(n: number): string {
  return String(n).padStart(2, '0');
}

interface Props {
  tweets: string[];
  onChange: (tweets: string[]) => void;
}

/**
 * Each tweet renders as a terminal card: a zero-padded index in the
 * upper-left, an edit control in the upper-right, and live inline
 * highlighting of banned slop phrases.
 */
export function ThreadPreview({ tweets, onChange }: Props) {
  const [editingIdx, setEditingIdx] = useState<number | null>(null);
  const [draft, setDraft] = useState('');

  function startEdit(i: number) {
    // Switching directly from another leaf's editor would silently drop the
    // in-progress draft. Commit it first (unless it was emptied — an empty
    // tweet is invalid, so we discard that edit instead of saving junk).
    if (editingIdx !== null && editingIdx !== i) {
      const trimmed = draft.trim();
      if (trimmed && trimmed !== tweets[editingIdx]) {
        const next = [...tweets];
        next[editingIdx] = trimmed;
        onChange(next);
      }
    }
    setEditingIdx(i);
    setDraft(tweets[i]);
  }
  function cancelEdit() {
    setEditingIdx(null);
    setDraft('');
  }
  function saveEdit() {
    if (editingIdx === null) return;
    // An empty tweet would post a blank segment to X. Keep the editor open.
    if (draft.trim() === '') return;
    const next = [...tweets];
    next[editingIdx] = draft.trim();
    onChange(next);
    setEditingIdx(null);
    setDraft('');
  }

  // Reorder/delete only fire while no editor is open (controls are hidden in
  // that case), so editingIdx can never drift out of sync with the array.
  function move(i: number, dir: -1 | 1) {
    onChange(moveTweet(tweets, i, dir));
  }
  function remove(i: number) {
    onChange(deleteTweet(tweets, i));
  }

  const anyEditing = editingIdx !== null;
  const total = tweets.length;

  return (
    <section className="w-full max-w-md flex flex-col gap-4">
      <div className="flex flex-col gap-1">
        <p className="heading-sub text-[10px]">
          {tweets.length} {tweets.length === 1 ? 'tweet' : 'tweets'} · ready to review
        </p>
        <h2 className="text-3xl leading-tight">Your thread is ready</h2>
      </div>

      <RuleDivider />

      <ol className="flex flex-col gap-3 list-none">
        {tweets.map((tw, i) => {
          const isEditing = editingIdx === i;
          return (
            <FolioLeaf
              key={i}
              numeral={pad2(i + 1)}
              total={pad2(total)}
              text={tw}
              isEditing={isEditing}
              draft={draft}
              onDraftChange={setDraft}
              onStartEdit={() => startEdit(i)}
              onCancel={cancelEdit}
              onSave={saveEdit}
              showControls={!anyEditing}
              canMoveUp={i > 0}
              canMoveDown={i < tweets.length - 1}
              canDelete={tweets.length > 1}
              onMoveUp={() => move(i, -1)}
              onMoveDown={() => move(i, 1)}
              onDelete={() => remove(i)}
              animationDelay={i * 0.08}
            />
          );
        })}
      </ol>

      <style jsx>{`
        @keyframes leaf-reveal {
          0% { opacity: 0; transform: translateY(10px); filter: blur(2px); }
          100% { opacity: 1; transform: translateY(0); filter: blur(0); }
        }
      `}</style>
    </section>
  );
}

interface LeafProps {
  numeral: string;
  total: string;
  text: string;
  isEditing: boolean;
  draft: string;
  onDraftChange: (v: string) => void;
  onStartEdit: () => void;
  onCancel: () => void;
  onSave: () => void;
  showControls: boolean;
  canMoveUp: boolean;
  canMoveDown: boolean;
  canDelete: boolean;
  onMoveUp: () => void;
  onMoveDown: () => void;
  onDelete: () => void;
  animationDelay: number;
}

function FolioLeaf({
  numeral,
  total,
  text,
  isEditing,
  draft,
  onDraftChange,
  onStartEdit,
  onCancel,
  onSave,
  showControls,
  canMoveUp,
  canMoveDown,
  canDelete,
  onMoveUp,
  onMoveDown,
  onDelete,
  animationDelay,
}: LeafProps) {
  return (
    <li
      style={{
        animation: `leaf-reveal 0.55s ${animationDelay}s cubic-bezier(.2,.6,.2,1) both`,
      }}
    >
      <Card className="relative p-5 pt-4 flex flex-col gap-3 transition-colors duration-200 hover:border-primary/50">
        {/* Tweet index marker — top-left */}
        <div className="flex items-center justify-between gap-2">
          {/* shrink-0: the nib cluster grew by one control, and without this the
              index block is the flex item that gives — wrapping "of 03". */}
          <div className="flex shrink-0 items-baseline gap-2 leading-none whitespace-nowrap">
            <span
              className="font-mono font-bold text-2xl text-muted-foreground"
              aria-hidden
            >
              {numeral}
            </span>
            <span className="font-mono text-[11px] text-muted-foreground">of {total}</span>
          </div>

          {/* Right cluster: reorder + delete nibs, then the edit/cancel nib.
              Reorder/delete hide while any leaf is being edited so the array
              index can't drift under the open editor. Icons stay small but
              each button keeps a ~36px tap area for thumbs. */}
          <div className="flex items-center gap-0.5 -mr-1.5">
            {showControls && !isEditing && (
              <>
                <LeafNib
                  label="Move tweet up"
                  onClick={onMoveUp}
                  disabled={!canMoveUp}
                >
                  <ChevronUp size={15} aria-hidden />
                </LeafNib>
                <LeafNib
                  label="Move tweet down"
                  onClick={onMoveDown}
                  disabled={!canMoveDown}
                >
                  <ChevronDown size={15} aria-hidden />
                </LeafNib>
                <LeafNib
                  label="Delete tweet"
                  onClick={onDelete}
                  disabled={!canDelete}
                  danger
                >
                  <Trash2 size={14} aria-hidden />
                </LeafNib>
              </>
            )}

            {/* Copy nib — X mobile can't post a thread in one shot, so the
                follow-ups are pasted one at a time (see ShareToX). Copying a
                single tweet is the actual last-mile action, not copy-all. */}
            {!isEditing && <CopyNib text={text} />}

            {/* Edit nib */}
            {!isEditing ? (
              <button
                type="button"
                onClick={onStartEdit}
                className="flex items-center gap-1 px-2 h-9 font-mono text-[11px] text-muted-foreground no-underline hover:text-primary transition-colors"
              >
                <Pencil size={11} aria-hidden />
                edit
              </button>
            ) : (
              <button
                type="button"
                onClick={onCancel}
                className="flex items-center gap-1 px-2 h-9 font-mono text-[11px] text-muted-foreground no-underline hover:text-destructive transition-colors"
              >
                <XIcon size={11} aria-hidden />
                cancel
              </button>
            )}
          </div>
        </div>

        {/* Body */}
        {isEditing ? (
          <Textarea
            value={draft}
            onChange={(e) => onDraftChange(e.target.value)}
            rows={5}
            autoFocus
            className="font-sans text-[15px] leading-normal"
          />
        ) : (
          <p className="font-sans text-[15px] leading-normal whitespace-pre-wrap">
            <HighlightedText text={text} />
          </p>
        )}

        {isEditing && (
          <div className="flex items-center gap-2 mt-1 justify-end">
            <Button size="sm" variant="ghost" onClick={onCancel}>
              Cancel
            </Button>
            <Button size="sm" onClick={onSave} disabled={draft.trim().length === 0}>
              Save
            </Button>
          </div>
        )}
      </Card>
    </li>
  );
}

/**
 * A small square button used for the per-tweet reorder/delete controls. The
 * glyph stays small, but the button holds a 36px (h-9 w-9) hit area so it's
 * comfortable under a thumb.
 */
function LeafNib({
  label,
  onClick,
  disabled,
  danger,
  children,
}: {
  label: string;
  onClick: () => void;
  disabled?: boolean;
  danger?: boolean;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      aria-label={label}
      title={label}
      className={
        'flex items-center justify-center h-9 w-9 rounded text-muted-foreground no-underline transition-colors disabled:opacity-30 disabled:cursor-not-allowed ' +
        (danger ? 'hover:text-destructive' : 'hover:text-primary')
      }
    >
      {children}
    </button>
  );
}

/**
 * Renders tweet text with banned phrases wrapped in an amber-highlighted
 * <mark>. Detection is live: it recomputes on every text change so a phrase
 * the creator deletes stops being flagged immediately.
 */
function HighlightedText({ text }: { text: string }) {
  const matches = useMemo(() => detectBannedPhrases(text), [text]);
  if (matches.length === 0) return <>{text}</>;

  const parts: React.ReactNode[] = [];
  let cursor = 0;
  matches.forEach((m, i) => {
    if (m.start < cursor) return; // overlapping match already inside a mark
    if (m.start > cursor) parts.push(text.slice(cursor, m.start));
    parts.push(
      <mark
        key={i}
        title={`${m.group.replace('-', ' ')} — cut or replace`}
        className="bg-money/20 text-money underline decoration-money/60"
      >
        {text.slice(m.start, m.end)}
      </mark>,
    );
    cursor = m.end;
  });
  if (cursor < text.length) parts.push(text.slice(cursor));
  return <>{parts}</>;
}
