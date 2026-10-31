import { handleHealth, storeFromEnv } from '../../server/handlers';
import { RoomService, liveKitFromEnv } from '../../server/livekit';

export default async (): Promise<Response> => {
  const lk = liveKitFromEnv();
  return handleHealth({ store: storeFromEnv() }, lk ? new RoomService(lk) : null);
};

export const config = { path: '/api/health' };
