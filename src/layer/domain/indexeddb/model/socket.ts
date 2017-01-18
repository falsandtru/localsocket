import { LocalSocketObject, LocalSocketObjectMetaData, LocalSocketEvent, LocalSocketEventType } from 'localsocket';
import { Observable } from 'spica';
import { open, close, destroy, event, IDBEventType, IDBTransactionMode, IDBCursorDirection } from '../../../infrastructure/indexeddb/api';
import { DataStore } from './socket/data';
import { AccessStore } from './socket/access';
import { ExpiryStore } from './socket/expiry';
import { noop } from '../../../../lib/noop';

const cache = new Map<string, SocketStore<string, SocketStore.Value<string>>>();

export class SocketStore<K extends string, V extends SocketStore.Value<K>> {
  constructor(
    public readonly name: string,
    destroy: (err: DOMException | DOMError, event: Event | null) => boolean,
    private readonly expiry: number
  ) {
    if (cache.has(name)) return <SocketStore<K, V>>cache.get(name)!;
    void cache.set(name, this);
    void open(name, {
      make(db) {
        return DataStore.configure().make(db)
            && AccessStore.configure().make(db)
            && ExpiryStore.configure().make(db);
      },
      verify(db) {
        return DataStore.configure().verify(db)
            && AccessStore.configure().verify(db)
            && ExpiryStore.configure().verify(db);
      },
      destroy(err, ev) {
        return DataStore.configure().destroy(err, ev)
            && AccessStore.configure().destroy(err, ev)
            && ExpiryStore.configure().destroy(err, ev)
            && destroy(err, ev);
      }
    });
    this.schema = new Schema<K, V>(this, this.expiries);
    void event.on([name, IDBEventType.destroy], () =>
      void this.schema.bind());
  }
  protected readonly schema: Schema<K, V>;
  public readonly events = {
    load: new Observable<never[] | [K] | [K, string] | [K, string, SocketStore.EventType], SocketStore.Event<K>, void>(),
    save: new Observable<never[] | [K] | [K, string] | [K, string, SocketStore.EventType], SocketStore.Event<K>, void>(),
    loss: new Observable<never[] | [K] | [K, string] | [K, string, SocketStore.EventType], SocketStore.Event<K>, void>()
  };
  public sync(keys: K[], cb: (errs: [K, DOMException | DOMError][]) => any = noop): void {
    return this.schema.data.sync(keys, cb);
  }
  public transaction(key: K, cb: () => any, done: () => any, fail: (err: DOMException | DOMError | Error) => any): void {
    return this.schema.data.transaction(key, cb, done, fail);
  }
  public meta(key: K): LocalSocketObjectMetaData<K> {
    return this.schema.data.meta(key);
  }
  public has(key: K): boolean {
    return this.schema.data.has(key);
  }
  public get(key: K): V {
    return this.schema.data.get(key);
  }
  public add(record: DataStore.Record<K, V>): void {
    return this.schema.data.add(record);
  }
  public delete(key: K): void {
    return this.schema.data.delete(key);
  }
  private readonly expiries = new Map<K, number>();
  public expire(key: K, expiry: number = this.expiry): void {
    assert(expiry > 0);
    if (expiry === Infinity) return;
    return void this.expiries.set(key, expiry);
  }
  public recent(limit: number, cb: (keys: K[], err: DOMException | DOMError | null) => any): void {
    const keys: K[] = [];
    return void this.schema.access.cursor(
      null,
      AccessStore.fields.date,
      IDBCursorDirection.prev,
      IDBTransactionMode.readonly,
      (cursor, err): void => {
        if (!cursor) return void cb(keys, err);
        if (--limit < 0) return;
        void keys.push(cursor.primaryKey);
        void cursor.continue();
      });
  }
  public close(): void {
    void cache.delete(this.name);
    return void close(this.name);
  }
  public destroy(): void {
    void event.off([this.name, IDBEventType.destroy]);
    void cache.delete(this.name);
    return void destroy(this.name);
  }
}
export namespace SocketStore {
  export type EventType = LocalSocketEventType;
  export const EventType = DataStore.EventType;
  export class Event<K extends string> extends DataStore.Event<K> implements LocalSocketEvent<K> { }
  export class Record<K extends string, V> extends DataStore.Record<K, V> { }
  export interface Value<K extends string> extends LocalSocketObject<K> { }
  export class Value<K extends string> extends DataStore.Value implements LocalSocketObject<K> {
  }
}

class Schema<K extends string, V extends SocketStore.Value<K>> {
  constructor(
    private readonly store_: SocketStore<K, V>,
    private readonly expiries_: Map<K, number>
  ) {
    void this.bind();
  }
  public bind(): void {
    const keys = this.data ? this.data.keys() : [];
    this.data = new DataStore<K, V>(this.store_.name);
    this.data.events.load.monitor([], ev => this.store_.events.load.emit([ev.key, ev.attr, ev.type], ev));
    this.data.events.save.monitor([], ev => this.store_.events.save.emit([ev.key, ev.attr, ev.type], ev));
    this.data.events.loss.monitor([], ev => this.store_.events.loss.emit([ev.key, ev.attr, ev.type], ev));
    this.access = new AccessStore<K>(this.store_.name, this.data.events_.access);
    this.expire = new ExpiryStore<K>(this.store_.name, this.store_, this.data.events_.access, this.expiries_);

    void this.data.sync(keys);
  }
  public data: DataStore<K, V>;
  public access: AccessStore<K>;
  public expire: ExpiryStore<K>;
}
