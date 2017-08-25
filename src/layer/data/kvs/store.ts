import { Listen, Config } from '../../infrastructure/indexeddb/api';
import { noop } from '../../../lib/noop';

export abstract class KeyValueStore<K extends string, V extends IDBValidValue> {
  public static configure(): Config {
    return {
      make() {
        return true;
      },
      verify() {
        return true;
      },
      destroy() {
        return true;
      }
    };
  }
  constructor(
    protected readonly name: string,
    private readonly index: string,
    private readonly listen: Listen,
  ) {
    if (typeof index !== 'string') throw new TypeError();
  }
  private readonly cache = new Map<K, V>();
  public get(key: K, cb: (value: V | void, error: DOMException | DOMError | Error) => void = noop): V | undefined {
    void this.listen(db => {
      const tx = db.transaction(this.name, 'readonly');
      const req = this.index
        ? tx
          .objectStore(this.name)
          .index(this.index)
          .get(key)
        : tx
          .objectStore(this.name)
          .get(key);
      let result: V;
      req.onsuccess = () =>
        result = req.result !== void 0 && req.result !== null
          ? req.result
          : this.cache.get(key);
      tx.oncomplete = () => cb(result, tx.error);
      tx.onerror = tx.onabort = () => cb(void 0, tx.error);
    }, () => void cb(void 0, new Error('Access has failed.')));
    return this.cache.get(key);
  }
  public set(key: K, value: V, cb: (key: K, error: DOMException | DOMError) => void = noop): V {
    return this.put(value, key, cb);
  }
  private put(value: V, key: K, cb: (key: K, error: DOMException | DOMError | Error) => void = noop): V {
    void this.cache.set(key, value);
    void this.listen(db => {
      if (!this.cache.has(key)) return;
      const tx = db.transaction(this.name, 'readwrite');
      this.index
        ? tx
          .objectStore(this.name)
          .put(this.cache.get(key))
        : tx
          .objectStore(this.name)
          .put(this.cache.get(key), key);
      tx.oncomplete = tx.onerror = tx.onabort = () => void cb(key, tx.error);
    }, () => void cb(key, new Error('Access has failed.')));
    return value;
  }
  public delete(key: K, cb: (error: DOMException | DOMError | Error) => void = noop): void {
    void this.cache.delete(key);
    void this.listen(db => {
      const tx = db.transaction(this.name, 'readwrite');
      void tx
        .objectStore(this.name)
        .delete(key);
      tx.oncomplete = tx.onerror = tx.onabort = () => void cb(tx.error);
    }, () => void cb(new Error('Access has failed.')));
  }
  public cursor(query: any, index: string, direction: IDBCursorDirection, mode: IDBTransactionMode, cb: (cursor: IDBCursorWithValue | null, error: DOMException | DOMError | Error | null) => void): void {
    void this.listen(db => {
      const tx = db
        .transaction(this.name, mode);
      const req = index
        ? tx
          .objectStore(this.name)
          .index(index)
          .openCursor(query, direction)
        : tx
          .objectStore(this.name)
          .openCursor(query, direction);
      req.onsuccess = () => req.result && void cb(req.result, req.error);
      tx.oncomplete = () => void cb(null, tx.error);
      tx.onerror = tx.onabort = () => void cb(null, tx.error);
    }, () => void cb(null, new Error('Access has failed.')));
  }
}
export namespace KeyValueStore {
  export const EventType = {
    get: <'get'>'get',
    put: <'put'>'put',
    delete: <'delete'>'delete'
  };
  export type EventType
    = typeof EventType.get
    | typeof EventType.put
    | typeof EventType.delete;
}
