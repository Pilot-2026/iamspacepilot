import { handleHealth, storeFromEnv } from '../../server/handlers';

export default async (): Promise<Response> => handleHealth({ store: storeFromEnv() });

export const config = { path: '/api/health' };
