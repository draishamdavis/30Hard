import type { Config } from '@netlify/functions';
import { getStore, getDeployStore } from '@netlify/blobs';
import { createApi, type Stores } from '../lib/core.mts';

// Production uses global stores; previews and branch deploys stay isolated per deploy.
function store(name: string) {
  const production = Netlify.context?.deploy?.context === 'production';
  return production ? getStore({ name, consistency: 'strong' }) : getDeployStore(name);
}

export default async (req: Request) => {
  const stores = { users: store('users'), state: store('state'), attempts: store('attempts') } as unknown as Stores;
  return createApi(stores, Netlify.env.get('SESSION_SECRET'))(req);
};

export const config: Config = {
  path: '/api/*',
};
