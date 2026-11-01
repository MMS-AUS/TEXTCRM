import { healthResponseSchema } from '@mms/shared';
import { publicProcedure, router } from '../trpc.ts';

export const healthRouter = router({
  ping: publicProcedure.output(healthResponseSchema).query(() => ({ status: 'ok' as const })),
});
