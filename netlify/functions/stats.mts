import { storeFromEnv } from '../../server/handlers';
import { handleStats, type StatsStore } from '../../server/stats';

export default async (req: Request): Promise<Response> => handleStats(req, { store: storeFromEnv() as StatsStore | null });

export const config = { path: '/api/stats' };
