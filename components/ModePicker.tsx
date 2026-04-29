'use client';

import { Card } from '@/components/ui/card';

interface Props {
  onSelect: (mode: 'educational' | 'hot-take') => void;
}

export function ModePicker({ onSelect }: Props) {
  return (
    <div className="w-full max-w-md flex flex-col gap-3">
      <h2 className="text-lg font-semibold">What are you writing today?</h2>

      <Card
        onClick={() => onSelect('educational')}
        className="p-4 cursor-pointer hover:border-primary transition-colors"
      >
        <div className="flex items-start gap-3">
          <span className="text-2xl">🎓</span>
          <div>
            <h3 className="font-semibold">Educational Thread</h3>
            <p className="text-sm text-muted-foreground">
              Explain a concept. e.g. &quot;How ZK rollups work&quot;
            </p>
          </div>
        </div>
      </Card>

      <Card
        onClick={() => onSelect('hot-take')}
        className="p-4 cursor-pointer hover:border-primary transition-colors opacity-60"
      >
        <div className="flex items-start gap-3">
          <span className="text-2xl">🔥</span>
          <div>
            <h3 className="font-semibold">
              Hot Take{' '}
              <span className="text-xs text-muted-foreground">(Week 3)</span>
            </h3>
            <p className="text-sm text-muted-foreground">
              React to news with data. Not yet available.
            </p>
          </div>
        </div>
      </Card>
    </div>
  );
}
