import { storeFromEnv } from '../../server/handlers';
import { handleVisit, type StatsStore } from '../../server/stats';

interface NetlifyContext {
  geo?: { city?: string; country?: { code?: string } };
}

export default async (req: Request, context: NetlifyContext): Promise<Response> =>
  handleVisit(req, { store: storeFromEnv() as StatsStore | null, geo: { country: context?.geo?.country?.code, city: context?.geo?.city } });

export const config = { path: '/api/visit' };
