import assert from 'node:assert/strict';
import {test} from 'node:test';
import {
  createWalletSession,
  walletErrorText,
  type Eip1193Provider,
  type WalletInfo,
  type WalletSnapshot,
} from '../src/wallet.ts';

const ACCOUNT_A = '0xabc0000000000000000000000000000000000001';
const ACCOUNT_B = '0xdef0000000000000000000000000000000000002';
const TX_HASH = `0x${'ab'.repeat(32)}`;

class MockProvider implements Eip1193Provider {
  accounts: string[] = [];
  chainId = '0x7bf';
  nextHash = TX_HASH;
  rejectNext: {code: number; message: string} | null = null;
  rejectMethod: string | null = null;
  chainGate: Promise<string> | null = null;
  requests: Array<{method: string; params?: unknown[]}> = [];
  handlers = new Map<string, (...args: any[]) => void>();

  async request(args: {method: string; params?: unknown[]}): Promise<unknown> {
    this.requests.push(args);
    if (this.rejectNext && (!this.rejectMethod || this.rejectMethod === args.method)) {
      const rejection = this.rejectNext;
      this.rejectNext = null;
      throw Object.assign(new Error(rejection.message), {code: rejection.code});
    }
    switch (args.method) {
      case 'eth_requestAccounts':
      case 'eth_accounts':
        return this.accounts;
      case 'eth_chainId':
        return this.chainGate ?? this.chainId;
      case 'eth_sendTransaction':
        return this.nextHash;
      default:
        throw new Error(`unexpected ${args.method}`);
    }
  }

  on(event: string, listener: (...args: any[]) => void): void {
    this.handlers.set(event, listener);
  }

  removeListener(event: string): void {
    this.handlers.delete(event);
  }

  emit(event: string, ...args: unknown[]): void {
    this.handlers.get(event)?.(...args);
  }

  count(method: string): number {
    return this.requests.filter((request) => request.method === method).length;
  }
}

function walletInfo(provider: Eip1193Provider): WalletInfo {
  return {
    uuid: 'test-wallet',
    name: 'QIE Wallet',
    rdns: 'me.qiewallet',
    provider,
  };
}

async function tick(): Promise<void> {
  await new Promise((resolve) => setTimeout(resolve, 0));
}

test('connect observes chain and account only after explicit connect', async () => {
  const provider = new MockProvider();
  provider.accounts = [ACCOUNT_A];
  const states: WalletSnapshot[] = [];
  const info = walletInfo(provider);
  const session = createWalletSession(info, 1983, (snapshot) => states.push(snapshot));

  assert.equal(session.snapshot().phase, 'disconnected');
  assert.equal(provider.count('eth_requestAccounts'), 0);

  await session.connect(info, 1983);
  assert.equal(session.snapshot().phase, 'ready');
  assert.equal(session.snapshot().account, ACCOUNT_A);
  assert.equal(session.snapshot().chainId, 1983);
  assert.equal(provider.count('eth_requestAccounts'), 1);
  assert.ok(states.length > 0);
  session.dispose();
});

test('user rejection stays disconnected and clears account state', async () => {
  const provider = new MockProvider();
  provider.accounts = [ACCOUNT_A];
  provider.rejectNext = {code: 4001, message: 'user rejected'};
  const info = walletInfo(provider);
  const session = createWalletSession(info, 1983, () => {});
  await session.connect(info, 1983);
  assert.equal(session.snapshot().phase, 'disconnected');
  assert.equal(session.snapshot().account, null);
  assert.equal(session.snapshot().error?.kind, 'USER_REJECTED');
  assert.match(walletErrorText(session.snapshot().error), /cancelled/i);
  session.dispose();
});

test('wrong chain at connect drops the account and never auto-switches', async () => {
  const provider = new MockProvider();
  provider.accounts = [ACCOUNT_A];
  provider.chainId = '0x1';
  const info = walletInfo(provider);
  const session = createWalletSession(info, 1983, () => {});
  await session.connect(info, 1983);
  assert.equal(session.snapshot().phase, 'wrong-chain');
  assert.equal(session.snapshot().account, null);
  assert.equal(session.snapshot().error?.kind, 'WRONG_CHAIN');
  assert.equal(provider.count('wallet_switchEthereumChain'), 0);
  assert.equal(provider.count('wallet_addEthereumChain'), 0);
  session.dispose();
});

test('4902 is surfaced as testnet not enabled, not as a silent add-chain', async () => {
  const provider = new MockProvider();
  provider.accounts = [ACCOUNT_A];
  provider.rejectNext = {code: 4902, message: 'chain not found'};
  const info = walletInfo(provider);
  const session = createWalletSession(info, 1983, () => {});
  await session.connect(info, 1983);
  assert.equal(session.snapshot().error?.kind, 'CHAIN_UNKNOWN');
  assert.match(walletErrorText(session.snapshot().error), /Testnet toggle/i);
  assert.equal(provider.count('wallet_addEthereumChain'), 0);
  session.dispose();
});

test('accountsChanged swaps account and empty accounts disconnect', async () => {
  const provider = new MockProvider();
  provider.accounts = [ACCOUNT_A];
  const info = walletInfo(provider);
  const session = createWalletSession(info, 1983, () => {});
  await session.connect(info, 1983);

  provider.emit('accountsChanged', [ACCOUNT_B]);
  assert.equal(session.snapshot().account, null);
  assert.equal(session.snapshot().phase, 'connecting');
  await tick();
  assert.equal(session.snapshot().phase, 'ready');
  assert.equal(session.snapshot().account, ACCOUNT_B);

  provider.emit('accountsChanged', []);
  assert.equal(session.snapshot().phase, 'disconnected');
  assert.equal(session.snapshot().account, null);
  session.dispose();
});

test('chainChanged to another chain invalidates the session', async () => {
  const provider = new MockProvider();
  provider.accounts = [ACCOUNT_A];
  const info = walletInfo(provider);
  const session = createWalletSession(info, 1983, () => {});
  await session.connect(info, 1983);

  provider.chainId = '0x1';
  provider.emit('chainChanged', '0x1');
  assert.equal(session.snapshot().phase, 'wrong-chain');
  assert.equal(session.snapshot().account, null);

  provider.chainId = '0x7bf';
  provider.emit('chainChanged', '0x7bf');
  assert.equal(session.snapshot().phase, 'disconnected');
  assert.equal(session.snapshot().account, null);
  session.dispose();
});

test('sendTransaction supports contract creation without a to field', async () => {
  const provider = new MockProvider();
  provider.accounts = [ACCOUNT_A];
  const info = walletInfo(provider);
  const session = createWalletSession(info, 1983, () => {});
  await session.connect(info, 1983);

  const hash = await session.sendTransaction({data: '0x60006000'});
  assert.equal(hash, TX_HASH);
  const sent = provider.requests.find((request) => request.method === 'eth_sendTransaction');
  assert.ok(sent);
  const params = (sent.params as Array<Record<string, string>>)[0];
  assert.ok(params);
  assert.equal(params.from, ACCOUNT_A);
  assert.equal(params.data, '0x60006000');
  assert.equal(params.to, undefined);
  assert.equal(params.value, undefined);
  session.dispose();
});

test('sendTransaction encodes value as hex and includes a valid to address', async () => {
  const provider = new MockProvider();
  provider.accounts = [ACCOUNT_A];
  const info = walletInfo(provider);
  const session = createWalletSession(info, 1983, () => {});
  await session.connect(info, 1983);

  await session.sendTransaction({
    to: '0x9999000000000000000000000000000000000001',
    data: '0x',
    value: 1_000_000_000_000_000_000n,
  });
  const sent = provider.requests.filter((request) => request.method === 'eth_sendTransaction').at(-1);
  assert.ok(sent);
  const params = (sent.params as Array<Record<string, string>>)[0];
  assert.ok(params);
  assert.equal(params.value, '0xde0b6b3a7640000');
  assert.equal(params.to, '0x9999000000000000000000000000000000000001');
  session.dispose();
});

test('sendTransaction re-checks chain and refuses to send after a chain change', async () => {
  const provider = new MockProvider();
  provider.accounts = [ACCOUNT_A];
  const info = walletInfo(provider);
  const session = createWalletSession(info, 1983, () => {});
  await session.connect(info, 1983);
  provider.chainId = '0x1';

  await assert.rejects(() => session.sendTransaction({data: '0x1234'}), /Wallet chain changed/);
  assert.equal(session.snapshot().phase, 'wrong-chain');
  assert.equal(provider.count('eth_sendTransaction'), 0);
  session.dispose();
});

test('sendTransaction rejects malformed calldata and malformed tx hashes', async () => {
  const provider = new MockProvider();
  provider.accounts = [ACCOUNT_A];
  const info = walletInfo(provider);
  const session = createWalletSession(info, 1983, () => {});
  await session.connect(info, 1983);

  await assert.rejects(() => session.sendTransaction({data: '0xzz'}), /calldata/);
  provider.nextHash = 'not-a-hash';
  await assert.rejects(() => session.sendTransaction({data: '0x12'}), /invalid transaction hash/);
  session.dispose();
});

test('wallet errors do not auto-retry a write', async () => {
  const provider = new MockProvider();
  provider.accounts = [ACCOUNT_A];
  const info = walletInfo(provider);
  const session = createWalletSession(info, 1983, () => {});
  await session.connect(info, 1983);
  provider.rejectNext = {code: 4001, message: 'rejected in wallet'};
  provider.rejectMethod = 'eth_sendTransaction';

  await assert.rejects(() => session.sendTransaction({data: '0x12'}), /rejected in wallet/);
  assert.equal(provider.count('eth_sendTransaction'), 1);
  session.dispose();
});

for (const event of ['dispose', 'disconnect', 'accountsChanged', 'chainChanged'] as const) {
  test(`a ${event} during the final chain check cancels a write`, async () => {
    const provider = new MockProvider();
    provider.accounts = [ACCOUNT_A];
    const info = walletInfo(provider);
    const session = createWalletSession(info, 1983, () => {});
    await session.connect(info, 1983);
    let release!: (chain: string) => void;
    provider.chainGate = new Promise((resolve) => {release = resolve;});

    const sending = session.sendTransaction({to: ACCOUNT_B, data: '0x', value: 1n});
    if (event === 'dispose') session.dispose();
    else if (event === 'disconnect') provider.emit('disconnect');
    else if (event === 'accountsChanged') provider.emit('accountsChanged', [ACCOUNT_B]);
    else provider.emit('chainChanged', '0x1');
    release('0x7bf');

    await assert.rejects(sending, /wallet session changed/);
    assert.equal(provider.count('eth_sendTransaction'), 0);
    if (event === 'chainChanged') assert.equal(session.snapshot().phase, 'wrong-chain');
    if (event === 'dispose') {
      assert.equal(session.snapshot().phase, 'disconnected');
      await assert.rejects(() => session.request('eth_accounts'), /not ready/);
      await assert.rejects(() => session.sendTransaction({data: '0x'}), /not ready/);
    }
    await tick();
    session.dispose();
  });
}

test('requests are blocked while not ready', async () => {
  const provider = new MockProvider();
  const info = walletInfo(provider);
  const session = createWalletSession(info, 1983, () => {});
  await assert.rejects(() => session.request('eth_chainId'), /not ready/);
  session.dispose();
});
