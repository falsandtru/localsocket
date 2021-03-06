import { Infinity, Math, Date, setTimeout } from 'spica/global';
import { Listen, Config } from '../../../../infrastructure/indexeddb/api';
import { KeyValueStore } from '../../../../data/kvs/store';
import { ChannelStore } from '../channel';
import { Ownership } from '../../../ownership/channel';
import { Cancellee } from 'spica/cancellation';

const name = 'expiry';

const enum ExpiryStoreSchema {
  key = 'key',
  expiry = 'expiry',
}

export class ExpiryStore<K extends string> {
  public static configure(): Config {
    return {
      make(tx) {
        const store = tx.db.objectStoreNames.contains(name)
          ? tx.objectStore(name)
          : tx.db.createObjectStore(name, {
              keyPath: ExpiryStoreSchema.key,
              autoIncrement: false
            });
        if (!store.indexNames.contains(ExpiryStoreSchema.key)) {
          void store.createIndex(ExpiryStoreSchema.key, ExpiryStoreSchema.key, {
            unique: true
          });
        }
        if (!store.indexNames.contains(ExpiryStoreSchema.expiry)) {
          void store.createIndex(ExpiryStoreSchema.expiry, ExpiryStoreSchema.expiry);
        }
        return true;
      },
      verify(db) {
        return db.objectStoreNames.contains(name)
            && db.transaction(name).objectStore(name).indexNames.contains(ExpiryStoreSchema.key)
            && db.transaction(name).objectStore(name).indexNames.contains(ExpiryStoreSchema.expiry);
      },
      destroy() {
        return true;
      }
    };
  }
  constructor(
    private readonly chan: ChannelStore<K, any>,
    private readonly cancellation: Cancellee<void>,
    private readonly ownership: Ownership<string>,
    private readonly listen: Listen,
  ) {
    void this.schedule(10 * 1000);
    assert(Object.freeze(this));
  }
  private store = new class extends KeyValueStore<K, ExpiryRecord<K>> { }(name, ExpiryStoreSchema.key, this.listen);
  private schedule = (() => {
    let timer = 0;
    let delay = 10 * 1000;
    let schedule = Infinity;
    return (timeout: number): void => {
      if (Date.now() + timeout >= schedule) return;
      schedule = Date.now() + timeout;
      void clearTimeout(timer);
      timer = setTimeout(() => {
        if (!this.cancellation.alive) return;
        if (schedule === 0) return;
        if (!this.ownership.take('store', 10 * 1000)) return this.schedule(delay *= 2);
        delay = Math.max(Math.floor(delay / 1.5), delay);
        let retry = false;
        schedule = 0;
        return void this.store.cursor(null, ExpiryStoreSchema.expiry, 'next', 'readonly', (cursor, error) => {
          schedule = Infinity;
          if (!this.cancellation.alive) return;
          if (error) return void this.schedule(delay * 10);
          if (!cursor) return retry && void this.schedule(delay *= 2);
          const { key, expiry }: ExpiryRecord<K> = cursor.value;
          if (expiry > Date.now()) return void this.schedule(expiry - Date.now());
          if (!this.ownership.extend('store', 10 * 1000)) return void this.schedule(delay *= 2);
          schedule = 0;
          if (!this.ownership.take(`key:${key}`, 10 * 1000)) return retry = true, void cursor.continue();
          this.chan.has(key)
            ? void this.chan.delete(key)
            : void this.chan.clean(key);
          assert(!this.chan.has(key));
          return void cursor.continue();
        });
      }, timeout) as any;
    };
  })();
  public set(key: K, age: number): void {
    if (age === Infinity) return void this.delete(key);
    void this.schedule(age);
    void this.store.set(key, new ExpiryRecord(key, Date.now() + age));
  }
  public delete(key: K): void {
    void this.store.delete(key);
  }
  public close(): void {
    void this.store.close();
  }
}

class ExpiryRecord<K extends string> {
  constructor(
    public readonly key: K,
    public readonly expiry: number
  ) {
    assert(Number.isFinite(expiry));
    assert(Number.isSafeInteger(expiry));
    assert(expiry >= Date.now());
  }
}
