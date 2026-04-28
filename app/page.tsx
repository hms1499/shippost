import { Button } from '@/components/ui/button';

export default function Home() {
  return (
    <main className="min-h-screen flex flex-col items-center justify-center gap-4 p-8">
      <h1 className="text-4xl font-bold text-primary">ShipPost</h1>
      <p className="text-muted-foreground">Foundation in progress…</p>
      <Button>Sanity check</Button>
    </main>
  );
}
