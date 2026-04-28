'use client';

import { useEffect, useState } from 'react';

export function detectMiniPay(): boolean {
  if (typeof window === 'undefined') return false;
  const eth = (window as any).ethereum;
  return Boolean(eth?.isMiniPay);
}

export function useIsMiniPay(): boolean {
  const [isMiniPay, setIsMiniPay] = useState(false);

  useEffect(() => {
    setIsMiniPay(detectMiniPay());
  }, []);

  return isMiniPay;
}
