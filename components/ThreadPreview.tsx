'use client';

import { useState } from 'react';
import { Pencil, X as XIcon, ChevronUp, ChevronDown, Trash2 } from 'lucide-react';
import { Card } from '@/components/ui/card';
import { Textarea } from '@/components/ui/textarea';
import { Button } from '@/components/ui/button';
import { InkDivider } from './InkDivider';
import { InkText } from './InkText';
import { moveTweet, deleteTweet } from '@/lib/threadEdits';

const MAX_TWEET_LEN = 270;

const ROMAN_PAIRS: [number, string][] = [
  [10, 'X'],
  [9, 'IX'],
  [5, 'V'],
  [4, 'IV'],
  [1, 'I'],
];
function toRoman(n: number): string {
  let out = '';
  let rem = n;
  for (const [num, sym] of ROMAN_PAIRS) {
    while (rem >= num) {
      out += sym;
      rem -= num;
    }
  }
  return out || String(n);
}

interface Props {
  tweets: string[];
  onChange: (tweets: string[]) => void;
}

/**
 * Each tweet is rendered as a "folio leaf" of a manuscript: a Roman-numeral
 * page mark in the upper-left, an edit nib in the upper-right, drop-cap on
 * the opening leaf, and a 10-dot ink-meter that warms from sepia → vermillion
 * as the character count nears X's split limit.
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
  const totalRoman = toRoman(tweets.length);

  return (
    <section className="w-full max-w-md flex flex-col gap-4">
      <div className="flex flex-col gap-1">
        <p className="heading-sub text-[10px]">
          Calligraphed · {totalRoman} {tweets.length === 1 ? 'leaf' : 'leaves'}
        </p>
        <InkText
          as="h2"
          className="font-display italic text-3xl leading-tight"
          delay={55}
        >
          Your thread is ready
        </InkText>
      </div>

      <InkDivider />

      <ol className="flex flex-col gap-3 list-none">
        {tweets.map((tw, i) => {
          const isEditing = editingIdx === i;
          const text = isEditing ? draft : tw;
          const len = text.length;
          const over = len > MAX_TWEET_LEN;
          const ratio = len / MAX_TWEET_LEN;
          return (
            <FolioLeaf
              key={i}
              numeral={toRoman(i + 1)}
              total={totalRoman}
              text={tw}
              isFirst={i === 0}
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
              len={len}
              ratio={ratio}
              over={over}
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
  isFirst: boolean;
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
  len: number;
  ratio: number;
  over: boolean;
  animationDelay: number;
}

function FolioLeaf({
  numeral,
  total,
  text,
  isFirst,
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
  len,
  ratio,
  over,
  animationDelay,
}: LeafProps) {
  return (
    <li
      style={{
        animation: `leaf-reveal 0.55s ${animationDelay}s cubic-bezier(.2,.6,.2,1) both`,
      }}
    >
      <Card className="relative p-5 pt-4 flex flex-col gap-3 transition-colors duration-200 hover:border-[hsl(var(--ink-deep))]">
        {/* Folio numeral marker — top-left */}
        <div className="flex items-center justify-between gap-2">
          <div className="flex items-baseline gap-2 leading-none">
            <span
              className="font-display italic text-[2rem] text-[hsl(var(--ink-faded))]"
              aria-hidden
            >
              {numeral}
            </span>
            <span className="heading-sub text-[10px]">of {total}</span>
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

            {/* Edit nib */}
            {!isEditing ? (
              <button
                type="button"
                onClick={onStartEdit}
                className="flex items-center gap-1 px-2 h-9 heading-sub text-[10px] no-underline hover:text-primary transition-colors"
              >
                <Pencil size={11} aria-hidden />
                edit
              </button>
            ) : (
              <button
                type="button"
                onClick={onCancel}
                className="flex items-center gap-1 px-2 h-9 heading-sub text-[10px] no-underline hover:text-destructive transition-colors"
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
            className="text-sm leading-relaxed"
          />
        ) : (
          <p
            className={
              'text-sm leading-relaxed whitespace-pre-wrap ' +
              (isFirst ? 'drop-cap' : '')
            }
          >
            {text}
          </p>
        )}

        {/* Footer: ink-meter + (save when editing) + (over warning) */}
        <div className="flex items-center gap-3 mt-1">
          <InkMeter ratio={ratio} over={over} />
          <span
            className={
              'font-mono text-[11px] tabular-nums ' +
              (over
                ? 'text-[hsl(var(--vermillion))]'
                : 'text-[hsl(var(--ink-faded))]')
            }
          >
            {len}/{MAX_TWEET_LEN}
          </span>
          {isEditing && (
            <div className="ml-auto flex gap-2">
              <Button size="sm" variant="ghost" onClick={onCancel}>
                Cancel
              </Button>
              <Button
                size="sm"
                onClick={onSave}
                disabled={draft.trim().length === 0}
              >
                Save
              </Button>
            </div>
          )}
        </div>

        {!isEditing && over && (
          <p className="text-xs italic text-[hsl(var(--vermillion))] leading-snug">
            X will split this leaf into multiple tweets when posted.
          </p>
        )}
      </Card>
    </li>
  );
}

/**
 * A small square nib button used for the per-leaf reorder/delete controls. The
 * glyph stays small to match the codex line work, but the button holds a 36px
 * (h-9 w-9) hit area so it's comfortable under a thumb.
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
        'flex items-center justify-center h-9 w-9 rounded text-[hsl(var(--ink-faded))] no-underline transition-colors disabled:opacity-30 disabled:cursor-not-allowed ' +
        (danger ? 'hover:text-destructive' : 'hover:text-primary')
      }
    >
      {children}
    </button>
  );
}

/**
 * Ten-dot ink-meter. Fills left-to-right; the trailing dots warm into primary
 * when crossing 85% of the limit, then jump to vermillion the moment the
 * paragraph exceeds X's natural break length.
 */
function InkMeter({ ratio, over }: { ratio: number; over: boolean }) {
  const segments = 10;
  const filled = Math.min(Math.ceil(ratio * segments), segments);
  const warning = !over && ratio > 0.85;
  return (
    <div className="flex items-center gap-[3px]" aria-hidden>
      {Array.from({ length: segments }).map((_, i) => {
        const isFilled = i < filled;
        let cls = 'bg-[hsl(var(--ink-faded)/0.18)]';
        if (isFilled) {
          if (over) cls = 'bg-[hsl(var(--vermillion))]';
          else if (warning && i >= segments - 3) cls = 'bg-primary';
          else cls = 'bg-[hsl(var(--ink-faded))]';
        }
        return (
          <span
            key={i}
            className={`block w-[5px] h-[5px] rounded-full transition-colors ${cls}`}
          />
        );
      })}
    </div>
  );
}
