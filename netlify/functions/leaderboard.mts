import { handleLeaderboard, storeFromEnv } from '../../server/handlers';

export default async (req: Request): Promise<Response> => handleLeaderboard(req, { store: storeFromEnv() });

export const config = { path: '/api/leaderboard' };
