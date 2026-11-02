import { configFromEnv, sha256 } from '../../server/firestore';
import { storeFromEnv } from '../../server/handlers';
import { handleVisit, type StatsStore } from '../../server/stats';

interface NetlifyContext {
  ip?: string;
  geo?: { city?: string; country?: { code?: string } };
}

export default async (req: Request, context: NetlifyContext): Promise<Response> => {
  const cfg = configFromEnv();
  // Secret salt for the visitor key: set STATS_SALT, or it comes from the Firebase key.
  const salt = process.env.STATS_SALT || (cfg ? sha256(`iamspacepilot-visitors|${cfg.privateKey}`) : '');
  return handleVisit(req, {
    store: storeFromEnv() as StatsStore | null,
    geo: { country: context?.geo?.country?.code, city: context?.geo?.city },
    ip: context?.ip ?? req.headers.get('x-nf-client-connection-ip') ?? undefined,
    salt,
  });
};

export const config = { path: '/api/visit' };
