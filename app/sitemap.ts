import type { MetadataRoute } from 'next';
import { shareAppUrl } from '@/lib/shareText';

export default function sitemap(): MetadataRoute.Sitemap {
  // One public page. /history is wallet-scoped and there is nothing behind it
  // for a crawler, so it is deliberately absent.
  return [
    {
      url: shareAppUrl(),
      lastModified: new Date(),
      changeFrequency: 'daily',
      priority: 1,
    },
  ];
}
