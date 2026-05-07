'use client';

import { GraduationCap, Flame } from 'lucide-react';
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
          <GraduationCap className="text-primary shrink-0" size={28} aria-hidden />
          <div>
            <h3 className="font-semibold">Educational Thread</h3>
            <p className="text-sm text-muted-foreground">
              Explain one concept, end-to-end. e.g. &quot;How EIP-712 typed signatures work&quot;
            </p>
          </div>
        </div>
      </Card>

      <Card
        onClick={() => onSelect('hot-take')}
        className="p-4 cursor-pointer hover:border-primary transition-colors"
      >
        <div className="flex items-start gap-3">
          <Flame className="text-primary shrink-0" size={28} aria-hidden />
          <div>
            <h3 className="font-semibold">Hot Take</h3>
            <p className="text-sm text-muted-foreground">
              React to news or a tweet with data. e.g. paste a Vitalik post or describe an event.
            </p>
          </div>
        </div>
      </Card>
    </div>
  );
}
