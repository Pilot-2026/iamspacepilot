import { gameDepsFromEnv, handleGames } from '../../server/games';

export default async (req: Request): Promise<Response> => handleGames(req, gameDepsFromEnv(null));

export const config = { path: '/api/games' };
