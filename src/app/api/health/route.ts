import { NextResponse } from 'next/server';
import { configService } from '@/lib/config';

/**
 * GET /api/health
 *
 * Health check endpoint for load balancers and monitoring.
 * Returns healthy status if configuration was initialized successfully at startup.
 */
export async function GET() {
  try {
    const config = configService.getConfig();

    return NextResponse.json(
      {
        status: 'healthy',
        initialized: true,
        environment: config.env,
        timestamp: new Date().toISOString(),
      },
      { status: 200 }
    );
  } catch (error) {
    console.error('Initialization failed', error);

    return NextResponse.json(
      {
        status: 'unhealthy',
        initialized: false,
        error: 'initialization_failed',
        timestamp: new Date().toISOString(),
      },
      { status: 503 }
    );
  }
}
