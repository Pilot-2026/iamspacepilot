import { handleScore, storeFromEnv } from '../../server/handlers';

export default async (req: Request): Promise<Response> => handleScore(req, { store: storeFromEnv() });

export const config = { path: '/api/score' };
