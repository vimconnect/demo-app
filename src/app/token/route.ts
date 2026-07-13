import type { NextRequest } from 'next/server';
import { exchangeAuthCode } from '@/lib/token-exchange';

// POST /token — the default token-exchange path (see token-exchange.ts).
export function POST(request: NextRequest) {
  return exchangeAuthCode(request);
}
