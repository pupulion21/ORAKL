import type {TransactionReceipt} from 'viem';

export type TxStatus = 'pending' | 'success' | 'reverted' | 'unknown';

export interface TxRecord {
  hash: string;
  label: string;
  status: TxStatus;
  error: string | null;
  blockNumber: bigint | null;
  createdAt: number;
  notified: boolean;
  processing: boolean;
}

type OnMined = (receipt: TransactionReceipt) => Promise<void>;

interface Dependencies {
  waitForReceipt: (hash: string) => Promise<TransactionReceipt>;
  getReceipt: (hash: string) => Promise<TransactionReceipt>;
  errorText: (error: unknown) => string;
  onChange: () => void;
  onError: (message: string) => void;
}

/** Observe submitted hashes without signing, replacing or resubmitting writes.
 *  Receipt execution and the application's recovery callback are separate states. */
export function createTransactionTracker(deps: Dependencies) {
  let records: TxRecord[] = [];
  const callbacks = new Map<string, OnMined>();
  const watchers = new Map<string, Promise<TransactionReceipt | null>>();
  const processing = new Map<string, Promise<void>>();
  const key = (hash: string) => hash.toLowerCase();
  const get = (hash: string) => records.find((record) => key(record.hash) === key(hash));
  const needsRecovery = (record: TxRecord) =>
    record.status === 'pending' || record.status === 'unknown' ||
    (record.status === 'success' && !record.notified);

  async function applyReceipt(hash: string, receipt: TransactionReceipt): Promise<void> {
    const record = get(hash);
    if (!record) return;
    if (key(receipt.transactionHash) !== key(hash)) {
      throw new Error('Receipt transaction hash mismatch. The application result has not been verified.');
    }
    const running = processing.get(key(hash));
    if (running) return running;
    record.status = receipt.status === 'success' ? 'success' : 'reverted';
    record.blockNumber = receipt.blockNumber;
    record.error = receipt.status === 'success' ? null : 'Transactions reverted on-chain.';
    deps.onChange();
    if (receipt.status !== 'success' || record.notified) return;

    const onMined = callbacks.get(key(hash));
    if (!onMined) throw new Error('Transaction recovery is unavailable.');
    record.processing = true;
    const completion = Promise.resolve().then(async () => {
      try {
        await onMined(receipt);
        record.notified = true;
        record.error = null;
      } catch (error) {
        record.error = `Transaction succeeded; result recovery is incomplete: ${deps.errorText(error)}`;
        deps.onError(record.error);
      } finally {
        record.processing = false;
        processing.delete(key(hash));
        deps.onChange();
      }
    });
    processing.set(key(hash), completion);
    deps.onChange();
    return completion;
  }

  function watch(hash: string): Promise<TransactionReceipt | null> {
    const existing = watchers.get(key(hash));
    if (existing) return existing;
    const promise = Promise.resolve().then(async () => {
      try {
        const receipt = await deps.waitForReceipt(hash);
        await applyReceipt(hash, receipt);
        return receipt;
      } catch (error) {
        const record = get(hash);
        if (record?.status === 'pending') {
          record.status = 'unknown';
          record.error = deps.errorText(error);
          deps.onChange();
        }
        return null;
      } finally {
        watchers.delete(key(hash));
      }
    });
    watchers.set(key(hash), promise);
    return promise;
  }

  return {
    get records(): readonly TxRecord[] { return records; },
    get,
    add(hash: string, label: string, onMined: OnMined): void {
      if (get(hash)) return;
      callbacks.set(key(hash), onMined);
      records.unshift({hash, label, status: 'pending', error: null, blockNumber: null,
        createdAt: Date.now(), notified: false, processing: false});
      deps.onChange();
    },
    watch,
    async check(hash: string): Promise<TransactionReceipt> {
      const receipt = await deps.getReceipt(hash);
      await applyReceipt(hash, receipt);
      return receipt;
    },
    remove(hash: string): boolean {
      const record = get(hash);
      if (!record || needsRecovery(record)) return false;
      records = records.filter((item) => item !== record);
      callbacks.delete(key(hash));
      deps.onChange();
      return true;
    },
    clear(): void {
      for (const record of records) {
        if (!needsRecovery(record)) callbacks.delete(key(record.hash));
      }
      records = records.filter(needsRecovery);
      deps.onChange();
    },
  };
}
