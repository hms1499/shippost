import type { MetadataRoute } from 'next';
import { shareAppUrl } from '@/lib/shareText';

export default function robots(): MetadataRoute.Robots {
  return {
    rules: {
      userAgent: '*',
      allow: '/',
      // Nothing under /api is a page, and /history is per-wallet: crawling it
      // gets a crawler an empty composer, never anyone's threads.
      disallow: ['/api/', '/history'],
    },
    sitemap: `${shareAppUrl()}/sitemap.xml`,
  };
}
