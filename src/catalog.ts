import catalog from './plans.json' with { type: 'json' };
export const panel='https://ctrl.shinchancloud.xyz';
export const plans = Object.entries(catalog).map(([name, spec]) => ({
 name, ram: spec.ram_gib, disk: spec.disk_gib, cpu: spec.cpu,
 monthly: 'monthly_usd' in spec ? spec.monthly_usd : 0,
 lifetime: 'lifetime_usd' in spec ? spec.lifetime_usd : 0
}));
export const wallets={LTC:'La63Hxe6wVphm4GE7ywKvumCLDLi4b9jj4',SOL:'ETYh6UUpAa33J4qZ2koCZFuA9jaJamjBT9S1du6aBYtm'};
