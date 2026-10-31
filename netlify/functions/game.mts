import { gameDepsFromEnv, handleGame } from '../../server/games';
import { storeFromEnv } from '../../server/handlers';

export default async (req: Request): Promise<Response> => handleGame(req, gameDepsFromEnv(storeFromEnv()));

export const config = { path: '/api/game' };
